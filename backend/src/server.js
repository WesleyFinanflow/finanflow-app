import { updatePendingSeries } from "./pending-series.js";
import { registerMfaRoutes } from "./mfa.js";
import express from "express";
import { reconcileSubscription, extendTrial, grantManualPlan } from "./access-management.js";
import { deleteUserData } from "./user-lifecycle.js";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import helmet from "helmet";
import { OAuth2Client } from "google-auth-library";
import { emailAddress, InputError, isoDate, moneyValue, oneOf, optionalText, requiredText } from "./validation.js";
import { addMonthsToIsoDate, repeatInstallmentAmount } from "./recurrence.js";
import { ensureTransactionRequestIndex, requestIndexKey, requestIndexOptions } from "./transaction-index.js";
import { FeatureFlag, AdminAudit, AdminNote, AppConfig, CouponUsage, Subscription, SupportTicket, registerAdminRoutes, seedAdminDefaults } from "./admin.js";
import { accessDenied as policyAccessDenied, canManageUser, canAccessAdmin, canAccessSuperAdmin, effectiveRole } from "./admin-policy.js";
import { DebtPlan, registerDebtPlanRoutes } from "./debt-plan.js";
import { MULTI_ACCOUNT_FLAG, featureEnabledForUser, parseAccountInput, assertCanCreate, assertCanUpdate, assertCanDelete, chooseAccountForTransaction, accountDeleteAudit } from "./accounts.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const configuredEmailFrom = String(process.env.EMAIL_FROM || "").trim();
// The Resend onboarding address only sends to the account owner.  Production
// recovery links must always use our verified domain so every user can reset
// their password.
const EMAIL_FROM = configuredEmailFrom && !configuredEmailFrom.includes("@resend.dev")
  ? configuredEmailFrom
  : "FinanFlow <nao-responda@vitalflow.ia.br>";
const FRONTEND_URL = String(process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
const GOOGLE_REDIRECT_URI = String(process.env.GOOGLE_REDIRECT_URI || "").trim();
const googleOAuthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI) : null;
const googleOAuthConfigured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);
const LEGAL_VERSION = "2026-09-03";
const ADMIN_EMAILS = new Set(String(process.env.ADMIN_EMAILS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
const CORS_ORIGINS = String(process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Resource-Policy": "same-site",
  });
  next();
});

const requestBuckets = new Map();
function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${req.ip}:${req.path}`;
    const bucket = requestBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) requestBuckets.set(key, { count: 1, resetAt: now + windowMs });
    else {
      bucket.count += 1;
      if (bucket.count > max) {
        res.set("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
        return res.status(429).json({ message: "Muitas tentativas. Aguarde alguns minutos e tente novamente." });
      }
    }
    if (requestBuckets.size > 5000) for (const [bucketKey, value] of requestBuckets) if (value.resetAt <= now) requestBuckets.delete(bucketKey);
    next();
  };
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });

app.use(cors({
  origin(origin, callback) {
    if (!origin || CORS_ORIGINS.includes(origin)) return callback(null, true);
    return callback(Object.assign(new Error("Origem não permitida pelo CORS."), { status: 403 }));
  },
  credentials: true,
}));
app.use(express.json({ limit: "200kb" }));

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    profilePhoto: { type: String, default: "", maxlength: 120000 },
    passwordHash: { type: String, required: function passwordRequired() { return !this.googleId; } },
    googleId: { type: String, unique: true, sparse: true, trim: true },
    passwordChangedAt: { type: Date },
    oauthExchangeHash: { type: String, select: false },
    oauthExchangeExpiresAt: { type: Date, select: false },
    passwordVersion: { type: Number, default: 0 },
    mfaEnabled: { type: Boolean, default: false },
    mfaVersion: { type: Number, default: 0 },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
    emailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, select: false },
    emailVerificationExpiresAt: { type: Date, select: false },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    loginLockedUntil: { type: Date, select: false },
    termsAcceptedAt: { type: Date },
    privacyAcceptedAt: { type: Date },
    legalVersion: { type: String, maxlength: 20 },
    accessStatus: { type: String, enum: ["active", "trial", "blocked"], default: "active" },
    trialEndsAt: { type: Date },
    blockedAt: { type: Date },
    role: { type: String, enum: ["USER", "ADMIN", "SUPER_ADMIN"], default: "USER" },
    lastLoginAt: { type: Date },
    trialStartedAt: { type: Date },
    trialStatus: { type: String, enum: ["NOT_STARTED", "ACTIVE", "EXPIRED", "CONVERTED", "CANCELLED"], default: "NOT_STARTED" },
    planCode: { type: String, default: "FREE", maxlength: 30 },
    accessOrigin: { type: String, enum: ["TRIAL", "COURTESY", "SUBSCRIPTION", "FREE"] },
  },
  { timestamps: true }
);

const spaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, enum: ["individual", "couple"], required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reserve: { type: Number, default: 0, min: 0, max: 1000000000000 },
    reserveConfigured: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const memberSchema = new mongoose.Schema(
  {
    spaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Space", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["owner", "member"], default: "member" },
  },
  { timestamps: true }
);
memberSchema.index({ spaceId: 1, userId: 1 }, { unique: true });

const accountSchema = new mongoose.Schema(
  {
    spaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Space", required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    ownerName: { type: String, default: "Individual", maxlength: 80 },
    balance: { type: Number, default: 0 },
    archived: { type: Boolean, default: false },
    // Contas criadas pelo recurso Multiconta: o modo antigo nunca as junta nem as apaga.
    userCreated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const transactionSchema = new mongoose.Schema(
  {
    spaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Space", required: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account" },
    type: { type: String, enum: ["receita", "despesa", "divida", "meta"], required: true },
    description: { type: String, required: true, trim: true, maxlength: 160 },
    amount: { type: Number, required: true, min: 0.01, max: 1000000000000 },
    date: { type: String, required: true },
    time: { type: String, default: "", maxlength: 5 },
    status: { type: String, enum: ["pendente", "pago"], default: "pendente" },
    fundingSource: { type: String, enum: ["cash", "meal"], default: "cash" },
    category: { type: String, default: "Outro", maxlength: 50 },
    paymentMethod: { type: String, default: "Não informado", maxlength: 50 },
    notes: { type: String, default: "", maxlength: 300 },
    seriesId: { type: String, index: true },
    recurrence: { type: String, enum: ["none", "monthly"], default: "none" },
    installmentNumber: { type: Number, min: 1, max: 120 },
    installmentCount: { type: Number, min: 1, max: 120 },
    totalAmount: { type: Number, min: 0.01, max: 1000000000000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    responsibleName: { type: String, default: "Individual", maxlength: 80 },
    requestId: { type: String, maxlength: 80 },
    reminderDate: { type: String },
  },
  { timestamps: true }
);
transactionSchema.index(requestIndexKey, requestIndexOptions);

const merchantCategoryMapSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  normalizedName: { type: String, required: true, maxlength: 160 },
  displayName: { type: String, required: true, maxlength: 160 },
  category: { type: String, required: true, maxlength: 50 },
  usageCount: { type: Number, default: 1, min: 1 },
}, { timestamps: true });
merchantCategoryMapSchema.index({ userId: 1, normalizedName: 1 }, { unique: true });
const MerchantCategoryMap = mongoose.model("MerchantCategoryMap", merchantCategoryMapSchema);

const purchasePlanSchema = new mongoose.Schema(
  {
    spaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Space", required: true, index: true },
    item: { type: String, required: true, trim: true, maxlength: 120 },
    total: { type: Number, required: true, min: 0.01, max: 1000000000000 },
    monthlyLimit: { type: Number, required: true, min: 0.01, max: 1000000000000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    responsibleName: { type: String, default: "Individual", maxlength: 80 },
  },
  { timestamps: true }
);

const inviteSchema = new mongoose.Schema(
  {
    spaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Space", required: true },
    code: { type: String, required: true, unique: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
  },
  { timestamps: true }
);

const auditLogSchema = new mongoose.Schema(
  {
    spaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Space", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userName: { type: String, required: true, maxlength: 80 },
    action: { type: String, enum: ["create", "update", "delete", "restore", "reset", "settings"], required: true },
    entityType: { type: String, enum: ["transaction", "account", "space"], required: true },
    entityId: { type: String, default: "", maxlength: 80 },
    summary: { type: String, required: true, maxlength: 180 },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
    restoredAt: { type: Date },
  },
  { timestamps: true }
);
auditLogSchema.index({ spaceId: 1, createdAt: -1 });

const backupSnapshotSchema = new mongoose.Schema(
  {
    spaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Space", required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, required: true, maxlength: 80 },
    space: { type: mongoose.Schema.Types.Mixed },
    accounts: [{ type: mongoose.Schema.Types.Mixed }],
    transactions: [{ type: mongoose.Schema.Types.Mixed }],
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
const Space = mongoose.model("Space", spaceSchema);
const Member = mongoose.model("Member", memberSchema);
const Account = mongoose.model("Account", accountSchema);
const Transaction = mongoose.model("Transaction", transactionSchema);
const PurchasePlan = mongoose.model("PurchasePlan", purchasePlanSchema);
const Invite = mongoose.model("Invite", inviteSchema);
const AuditLog = mongoose.model("AuditLog", auditLogSchema);
const BackupSnapshot = mongoose.model("BackupSnapshot", backupSnapshotSchema);

const Session = mongoose.model("Session", new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, index: true }, tokenHash: { type: String, unique: true }, mfaVerified: { type: Boolean, default: false }, mfaVersion: { type: Number, default: 0 }, expiresAt: { type: Date, expires: 0 } }, { timestamps: true }));

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function createToken(user) {
  return jwt.sign({ userId: user._id.toString(), email: user.email, passwordVersion: Number(user.passwordVersion || 0), jti: crypto.randomUUID() }, JWT_SECRET, { expiresIn: effectiveRole(user, ADMIN_EMAILS) === "USER" ? "8h" : "1h", issuer: "finanflow" });
}

const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-finanflow_session" : "finanflow_session";
const sessionOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" };
async function setSession(res, user, mfaVerified = false) {
  const token = createToken(user);
  await Session.create({ userId: user._id, mfaVerified, mfaVersion: Number(user.mfaVersion || 0), tokenHash: hashResetToken(token), expiresAt: new Date(jwt.decode(token).exp * 1000) });
  res.cookie(SESSION_COOKIE, token, { ...sessionOptions, maxAge: (effectiveRole(user, ADMIN_EMAILS) === "USER" ? 8 : 1) * 3600000 });
  res.set("Cache-Control", "no-store");
}

function googleAuthRedirect(res, params = {}) {
  return res.redirect(FRONTEND_URL + "/#" + new URLSearchParams(params).toString());
}

function readCookie(req, name) {
  const prefix = name + "=";
  const value = String(req.headers.cookie || "").split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : "";
}

function clearGoogleAuthCookies(res) {
  const options = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth/google" };
  res.clearCookie("finanflow_google_state", options);
  res.clearCookie("finanflow_google_intent", options);
}

function googleAuthCookieOptions() {
  return { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth/google", maxAge: 10 * 60 * 1000 };
}

function safeStateEquals(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validatePassword(value, label = "A senha") {
  if (typeof value !== "string" || !value) throw new InputError(`${label} é obrigatória.`);
  if (value.length < 12) throw new InputError(`${label} precisa ter pelo menos 12 caracteres.`);
  if (value.length > 128) throw new InputError(`${label} deve ter até 128 caracteres.`);
  return value;
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function sendPasswordResetEmail(email, token) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [email],
      subject: "Redefina sua senha do FinanFlow",
      html: `<p>Recebemos uma solicitação para redefinir sua senha.</p><p><a href="${FRONTEND_URL}/recuperar-senha?token=${encodeURIComponent(token)}">Criar uma nova senha</a></p><p>Este link expira em 30 minutos. Se você não fez a solicitação, ignore este e-mail.</p>`,
    }),
  });
  if (!response.ok) throw new Error("Falha ao enviar e-mail de recuperação.");
}

async function sendEmailVerificationEmail(email, token) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to: [email], subject: "Confirme seu e-mail no FinanFlow", html: `<p>Confirme que este e-mail é seu para reforçar a segurança da sua conta.</p><p><a href="${FRONTEND_URL}/verificar-email?token=${encodeURIComponent(token)}">Confirmar meu e-mail</a></p><p>Este link expira em 24 horas. Se você não criou uma conta no FinanFlow, ignore este e-mail.</p>` }),
  });
  if (!response.ok) throw new Error("Falha ao enviar e-mail de confirmação.");
}

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
    const token = bearer || readCookie(req, SESSION_COOKIE);
    if (!bearer && token && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !CORS_ORIGINS.includes(req.headers.origin)) return res.status(403).json({ message: "Origem da solicitação inválida." });
    if (!token) return res.status(401).json({ message: "Token não informado." });
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"], issuer: "finanflow" });
    res.set("Cache-Control", "no-store");
    const currentSession = await Session.findOne({ userId: decoded.userId, tokenHash: hashResetToken(token), expiresAt: { $gt: new Date() } });
    if (!currentSession) return res.status(401).json({ message: "Sessão encerrada. Entre novamente." });
    const user = await User.findById(decoded.userId).select("-passwordHash");
    if (!user) return res.status(401).json({ message: "Usuário não encontrado." });
    if (Number(currentSession.mfaVersion || 0) !== Number(user.mfaVersion || 0)) return res.status(401).json({ message: "A proteção da conta mudou. Entre novamente." });
    const config=await AppConfig.findOne({key:"global"}).select("maintenanceMode maintenanceMessage").lean();
    await reconcileSubscription(user, Subscription);
    user.role = effectiveRole(user, ADMIN_EMAILS);
    const currentRole = user.role;
    if(config?.maintenanceMode&&currentRole==="USER")return res.status(503).json({message:config.maintenanceMessage||"FinanFlow está em manutenção. Voltaremos em breve."});
    const deniedMessage = accessDenied(user);
    if (deniedMessage) return res.status(403).json({ message: deniedMessage });
    if (Number(decoded.passwordVersion || 0) !== Number(user.passwordVersion || 0)) {
      return res.status(401).json({ message: "Sua senha foi alterada. Entre novamente." });
    }
    req.user = user;
    req.authSession = currentSession;
    if (user.mfaEnabled && !currentSession.mfaVerified && req.path !== "/api/me" && !req.path.startsWith("/api/auth/mfa/")) return res.status(403).json({ message: "Confirme o segundo fator para continuar.", code: "MFA_REQUIRED" });
    next();
  } catch {
    return res.status(401).json({ message: "Sessão inválida." });
  }
}

async function userCanAccessSpace(userId, spaceId) {
  return Boolean(await Member.findOne({ userId, spaceId }));
}

function publicUser(user, mfaVerified = true) {
  const role = effectiveRole(user,ADMIN_EMAILS);
  return { mfaEnabled: Boolean(user.mfaEnabled), mfaRequired: Boolean(user.mfaEnabled && !mfaVerified), id: user._id, name: user.name, email: user.email, profilePhoto: user.profilePhoto || "", emailVerified: Boolean(user.emailVerified), role, isAdmin: role !== "USER", accessStatus: user.accessStatus || "active", trialEndsAt: user.trialEndsAt || null, trialStatus:user.trialStatus||"NOT_STARTED",planCode:user.planCode||"FREE",accessOrigin:user.accessOrigin||null };
}

function accessDenied(user) {
  return policyAccessDenied(user, ADMIN_EMAILS);
}

function adminOnly(req, res, next) {
  const role=effectiveRole(req.user,ADMIN_EMAILS);
  req.user.role=role;
  if (!canAccessAdmin(role)) return res.status(403).json({ message: "Acesso administrativo não autorizado." });
  next();
}

function superAdminOnly(req,res,next){adminOnly(req,res,()=>canAccessSuperAdmin(req.user.role)?next():res.status(403).json({message:"Ação exclusiva de SUPER_ADMIN."}));}

async function sendRecoveryForUser(user){
  if(!RESEND_API_KEY||!EMAIL_FROM) throw new InputError("Envio de e-mail ainda não configurado.");
  const token=crypto.randomBytes(32).toString("base64url");user.passwordResetTokenHash=hashResetToken(token);user.passwordResetExpiresAt=new Date(Date.now()+30*60*1000);await user.save();await sendPasswordResetEmail(user.email,token);
}

async function sendVerificationForUser(user) {
  if (!RESEND_API_KEY || !EMAIL_FROM) throw new InputError("Envio de e-mail ainda não configurado.");
  if (user.emailVerified) return false;
  const token = crypto.randomBytes(32).toString("base64url");
  user.emailVerificationTokenHash = hashResetToken(token);
  user.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await user.save();
  try { await sendEmailVerificationEmail(user.email, token); } catch (error) {
    user.emailVerificationTokenHash = undefined;
    user.emailVerificationExpiresAt = undefined;
    await user.save();
    throw error;
  }
  return true;
}

async function spaceViewIds(spaceId) {
  const space = await Space.findById(spaceId).lean();
  if (!space || space.type !== "couple") return [new mongoose.Types.ObjectId(spaceId)];
  const members = await Member.find({ spaceId }).select("userId").lean();
  const individualSpaces = await Space.find({ type: "individual", ownerId: { $in: members.map((item) => item.userId) } }).select("_id ownerId").lean();
  return individualSpaces.map((item) => item._id);
}

async function userWriteSpaceId(requestedSpaceId, userId) {
  const requestedSpace = await Space.findById(requestedSpaceId).select("type").lean();
  if (!requestedSpace || requestedSpace.type !== "couple") return requestedSpaceId;
  const individual = await Space.findOne({ type: "individual", ownerId: userId }).select("_id").lean();
  if (!individual) throw new InputError("Seu espaço individual não foi encontrado.");
  return individual._id;
}

async function serializeSpaceForUser(member) {
  const space = member.spaceId.toObject();
  const memberships = await Member.find({ spaceId: space._id }).populate("userId", "name profilePhoto").sort({ createdAt: 1 });
  const members = memberships.filter((item) => item.userId).map((item) => ({
    id: item.userId._id,
    name: item.userId.name,
    firstName: String(item.userId.name || "Pessoa").trim().split(/\s+/)[0],
    profilePhoto: item.userId.profilePhoto || "",
    role: item.role,
  }));
  if (space.type === "couple" && members.length) {
    const individualSpaces = await Space.find({ type: "individual", ownerId: { $in: members.map((item) => item.id) } }).select("reserve").lean();
    space.reserve = individualSpaces.reduce((total, item) => total + Number(item.reserve || 0), 0);
  }
  return { ...space, role: member.role, memberCount: members.length, members };
}

function plainDocument(value) {
  if (!value) return value;
  return typeof value.toObject === "function" ? value.toObject() : value;
}

async function recordAudit({ spaceId, user, action, entityType, entityId = "", summary, before, after }) {
  return AuditLog.create({
    spaceId,
    userId: user._id,
    userName: String(user.name || "Usuário").split(/\s+/)[0],
    action,
    entityType,
    entityId: String(entityId || ""),
    summary,
    before: before ? plainDocument(before) : undefined,
    after: after ? plainDocument(after) : undefined,
  });
}

async function createSpaceSnapshot(spaceId, user, reason) {
  const [space, accounts, transactions] = await Promise.all([
    Space.findById(spaceId).lean(),
    Account.find({ spaceId }).lean(),
    Transaction.find({ spaceId }).lean(),
  ]);
  return BackupSnapshot.create({
    spaceId,
    createdBy: user._id,
    reason,
    space,
    accounts,
    transactions,
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
  });
}

async function createInviteForSpace(spaceId, userId) {
  await Invite.updateMany({ spaceId, usedAt: { $exists: false } }, { $set: { usedAt: new Date() } });
  const code = `FF-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  return Invite.create({ spaceId, code, createdBy: userId, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
}

async function ensurePrimaryAccount(spaceId, ownerName = "Individual") {
  const space = await Space.findById(spaceId);
  if (!space) {
    const error = new Error("Espaço não encontrado.");
    error.status = 404;
    throw error;
  }
  // Contas do recurso Multiconta (userCreated) ficam fora da junção automática do modo antigo.
  // Sem o recurso, nenhuma conta tem esse campo e o comportamento é exatamente o de sempre.
  const accounts = (await Account.find({ spaceId }).sort({ createdAt: 1 })).filter((account) => !account.userCreated);
  const preferredName = space.type === "couple" ? "Conta conjunta" : "Conta principal";
  let primary = accounts.find((account) => account.name === preferredName) || accounts[0];
  if (!primary) {
    primary = await Account.create({ spaceId, name: preferredName, ownerName: space.type === "couple" ? "Casal" : ownerName, balance: 0 });
  }
  const duplicateIds = accounts.filter((account) => String(account._id) !== String(primary._id)).map((account) => account._id);
  if (duplicateIds.length) {
    const consolidatedBalance = accounts.reduce((total, account) => total + Number(account.balance || 0), 0);
    primary = await Account.findByIdAndUpdate(primary._id, { name: preferredName, balance: consolidatedBalance }, { new: true, runValidators: true });
    await Transaction.updateMany({ spaceId, $or: [{ accountId: { $in: duplicateIds } }, { accountId: null }] }, { $set: { accountId: primary._id } });
    await Account.deleteMany({ _id: { $in: duplicateIds }, spaceId });
  } else {
    if (primary.name !== preferredName) primary = await Account.findByIdAndUpdate(primary._id, { name: preferredName }, { new: true, runValidators: true });
    await Transaction.updateMany({ spaceId, accountId: null }, { $set: { accountId: primary._id } });
  }
  return primary;
}

// Multiconta: ligada só se a chave existir e estiver ativa para este usuário (padrão: desligada).
async function multiAccountOn(user) {
  const flag = await FeatureFlag.findOne({ key: MULTI_ACCOUNT_FLAG }).lean();
  return featureEnabledForUser(flag, user, effectiveRole(user, ADMIN_EMAILS));
}

// Com a Multiconta ligada: garante ao menos uma conta, completa lançamentos sem conta e NUNCA junta nem apaga contas.
async function ensureBaseAccounts(spaceId, ownerName = "Individual") {
  const space = await Space.findById(spaceId);
  if (!space) {
    const error = new Error("Espaço não encontrado.");
    error.status = 404;
    throw error;
  }
  let accounts = await Account.find({ spaceId }).sort({ createdAt: 1 });
  if (!accounts.length) {
    accounts = [await Account.create({ spaceId, name: space.type === "couple" ? "Conta conjunta" : "Conta principal", ownerName: space.type === "couple" ? "Casal" : ownerName, balance: 0 })];
  }
  let target;
  try { target = chooseAccountForTransaction({ accounts }); } catch { target = accounts[0]; }
  await Transaction.updateMany({ spaceId, accountId: null }, { $set: { accountId: target._id } });
  return accounts;
}

async function normalizeAccountIdForSpace(accountId, spaceId, ownerName, { multi = false, currentAccountId } = {}) {
  if (multi) {
    const accounts = await ensureBaseAccounts(spaceId, ownerName);
    return chooseAccountForTransaction({ requestedId: accountId, currentAccountId, accounts })._id;
  }
  const primary = await ensurePrimaryAccount(spaceId, ownerName);
  return primary._id;
}

function transactionInput(body, accountId, user) {
  return {
    accountId,
    type: oneOf(body?.type, ["receita", "despesa", "divida", "meta"], "Tipo"),
    description: requiredText(body?.description, "Descrição", 160),
    amount: moneyValue(body?.amount, { label: "Valor", min: 0.01 }),
    date: isoDate(body?.date, "Data"),
    time: optionalText(body?.time, "", 5),
    status: oneOf(body?.status ?? "pendente", ["pendente", "pago"], "Status"),
    fundingSource: oneOf(body?.fundingSource ?? "cash", ["cash", "meal"], "Origem do saldo"),
    category: optionalText(body?.category, "Outro", 50),
    paymentMethod: optionalText(body?.paymentMethod, "Não informado", 50),
    notes: optionalText(body?.notes, "", 300),
    createdBy: user._id,
    responsibleName: optionalText(body?.responsibleName, user.name, 80),
  };
}

async function extendRecurringTransactions(spaceId) {
  const recurring = await Transaction.find({ spaceId, recurrence: "monthly", seriesId: { $exists: true } }).sort({ date: 1 });
  const groups = new Map();
  recurring.forEach((item) => groups.set(item.seriesId, item));
  const horizon = addMonthsToIsoDate(new Date().toISOString().slice(0, 10), 12);
  for (const last of groups.values()) {
    const additions = [];
    let nextDate = addMonthsToIsoDate(last.date, 1);
    while (nextDate <= horizon && additions.length < 24) {
      additions.push({
        spaceId: last.spaceId, accountId: last.accountId, type: last.type, description: last.description, fundingSource: last.fundingSource || "cash",
        amount: last.amount, date: nextDate, status: "pendente", category: last.category,
        createdBy: last.createdBy, responsibleName: last.responsibleName, seriesId: last.seriesId, recurrence: "monthly",
      });
      nextDate = addMonthsToIsoDate(nextDate, 1);
    }
    if (additions.length) await Transaction.insertMany(additions);
  }
}

async function createIndividualSpaceForUser(user) {
  const space = await Space.create({ name: `Individual de ${user.name}`, type: "individual", ownerId: user._id });
  await Member.create({ spaceId: space._id, userId: user._id, role: "owner" });
  await Account.create({ spaceId: space._id, name: "Conta principal", ownerName: user.name, balance: 0 });
  return space;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "FinanFlow API", database: mongoose.connection.readyState === 1 ? "connected" : "disconnected" });
});

app.get("/api/ready", (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ ok: ready, database: ready ? "connected" : "unavailable", email: RESEND_API_KEY && EMAIL_FROM ? "configured" : "not_configured", timestamp: new Date().toISOString(),environment:process.env.RAILWAY_ENVIRONMENT_NAME||process.env.NODE_ENV||"local",version:process.env.RENDER_GIT_COMMIT||process.env.RAILWAY_GIT_COMMIT_SHA||process.env.APP_VERSION||"local" });
});

app.get("/api/status", (_req, res) => {
  const databaseOnline = mongoose.connection.readyState === 1;
  res.status(databaseOnline ? 200 : 503).json({ ok: databaseOnline, services: { api: "operational", database: databaseOnline ? "operational" : "unavailable", email: RESEND_API_KEY && EMAIL_FROM ? "operational" : "not_configured" }, checkedAt: new Date().toISOString() });
});

app.get("/api/auth/providers", (_req, res) => {
  res.json({ google: googleOAuthConfigured });
});

app.get("/api/auth/google", authLimiter, (req, res) => {
  if (!googleOAuthConfigured) return res.status(503).json({ message: "O login com Google ainda não está configurado." });
  const intent = req.query?.intent === "register" ? "register" : "login";
  const state = crypto.randomBytes(32).toString("base64url");
  const cookieOptions = googleAuthCookieOptions();
  res.cookie("finanflow_google_state", state, cookieOptions);
  res.cookie("finanflow_google_intent", intent, cookieOptions);
  const query = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: GOOGLE_REDIRECT_URI, response_type: "code", scope: "openid email profile", state, prompt: "select_account" });
  return res.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + query);
});

app.get("/api/auth/google/callback", authLimiter, async (req, res) => {
  const savedState = readCookie(req, "finanflow_google_state");
  const intent = readCookie(req, "finanflow_google_intent");
  clearGoogleAuthCookies(res);
  try {
    if (!googleOAuthConfigured || !googleOAuthClient) throw new InputError("O login com Google ainda não está configurado.");
    if (!req.query?.code || !safeStateEquals(req.query?.state, savedState)) throw new InputError("A confirmação do login com Google expirou. Tente novamente.");
    const tokens = await googleOAuthClient.getToken({ code: req.query.code, redirect_uri: GOOGLE_REDIRECT_URI });
    if (!tokens.tokens.id_token) throw new InputError("Não foi possível confirmar sua conta Google.");
    const ticket = await googleOAuthClient.verifyIdToken({ idToken: tokens.tokens.id_token, audience: GOOGLE_CLIENT_ID });
    const profile = ticket.getPayload();
    const email = emailAddress(profile?.email);
    if (!profile?.sub || profile.email_verified !== true) throw new InputError("Confirme seu e-mail no Google antes de continuar.");
    let user = await User.findOne({ googleId: profile.sub });
    if (!user) user = await User.findOne({ email });
    if (!user) {
      if (intent !== "register") throw new InputError("Não encontramos uma conta com este Google. Escolha Criar conta para começar.");
      const platformConfig = await AppConfig.findOne({ key: "global" }).lean();
      if (platformConfig?.registrationsOpen === false) throw new InputError("Novos cadastros estão temporariamente fechados.");
      const acceptedAt = new Date();
      const trialEnabled = platformConfig?.trialEnabled !== false;
      const trialEndsAt = trialEnabled ? new Date(Date.now() + Number(platformConfig?.defaultTrialDays || 30) * 86400000) : undefined;
      user = await User.create({ name: requiredText(profile.name || email.split("@")[0], "Nome", 80), email, googleId: profile.sub, emailVerified: true, termsAcceptedAt: acceptedAt, privacyAcceptedAt: acceptedAt, legalVersion: LEGAL_VERSION, accessStatus: trialEnabled ? "trial" : "active", trialStartedAt: trialEnabled ? acceptedAt : undefined, trialEndsAt, trialStatus: trialEnabled ? "ACTIVE" : "NOT_STARTED", planCode: trialEnabled ? (platformConfig?.trialPlanCode || "PREMIUM") : (platformConfig?.defaultPlanCode || "FREE") });
      await createIndividualSpaceForUser(user);
      if (trialEnabled) await Subscription.create({ userId: user._id, planCode: user.planCode, startsAt: acceptedAt, endsAt: trialEndsAt, status: "TRIAL", origin: "TRIAL" });
    } else {
      const deniedMessage = accessDenied(user);
      if (deniedMessage) throw new InputError(deniedMessage);
      if (user.googleId && user.googleId !== profile.sub) throw new InputError("Este e-mail já está vinculado a outra conta Google.");
      if (!user.googleId) user.googleId = profile.sub;
      user.emailVerified = true;
      user.lastLoginAt = new Date();
      await user.save();
    }
    const exchange = crypto.randomBytes(32).toString("base64url");
    user.oauthExchangeHash = hashResetToken(exchange);
    user.oauthExchangeExpiresAt = new Date(Date.now() + 60000);
    await user.save();
    return googleAuthRedirect(res, { google_auth_code: exchange });
  } catch (error) {
    return googleAuthRedirect(res, { google_auth_error: error instanceof InputError ? error.message : "Não foi possível entrar com Google. Tente novamente." });
  }
});

app.post("/api/auth/register", registerLimiter, async (req, res) => {
  try {
    const platformConfig=await AppConfig.findOne({key:"global"}).lean();
    if(platformConfig?.registrationsOpen===false)return res.status(403).json({message:"Novos cadastros estão temporariamente fechados."});
    const { name: rawName, email: rawEmail, password, acceptLegal } = req.body || {};
    const name = requiredText(rawName, "Nome", 80);
    const email = emailAddress(rawEmail);
    validatePassword(password);
    if (acceptLegal !== true) throw new InputError("Aceite os Termos de Uso e a Política de Privacidade para criar a conta.");
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: "Este e-mail já está cadastrado." });
    const passwordHash = await bcrypt.hash(password, 10);
    const acceptedAt = new Date();
    const trialEnabled=platformConfig?.trialEnabled!==false;
    const trialEndsAt=trialEnabled?new Date(Date.now()+Number(platformConfig?.defaultTrialDays||30)*86400000):undefined;
    const user = await User.create({ name, email, passwordHash, termsAcceptedAt: acceptedAt, privacyAcceptedAt: acceptedAt, legalVersion: LEGAL_VERSION,accessStatus:trialEnabled?"trial":"active",trialStartedAt:trialEnabled?acceptedAt:undefined,trialEndsAt,trialStatus:trialEnabled?"ACTIVE":"NOT_STARTED",planCode:trialEnabled?(platformConfig?.trialPlanCode||"PREMIUM"):(platformConfig?.defaultPlanCode||"FREE") });
    await createIndividualSpaceForUser(user);
    if(trialEnabled)await Subscription.create({userId:user._id,planCode:user.planCode,startsAt:acceptedAt,endsAt:trialEndsAt,status:"TRIAL",origin:"TRIAL"});
    try { await sendVerificationForUser(user); } catch { /* The account remains available; the user can resend from Settings. */ }
    await setSession(res, user);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error instanceof InputError) return res.status(400).json({ message: error.message });
    if (error?.code === 11000) return res.status(409).json({ message: "Este e-mail já está cadastrado." });
    res.status(500).json({ message: "Erro ao criar cadastro." });
  }
});

app.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
  const genericMessage = "Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.";
  try {
    if (!RESEND_API_KEY || !EMAIL_FROM) {
      return res.status(503).json({ message: "A recuperação por e-mail ainda não está configurada." });
    }
    const email = emailAddress(req.body?.email);
    const user = await User.findOne({ email });
    if (user) {
      const token = crypto.randomBytes(32).toString("base64url");
      user.passwordResetTokenHash = hashResetToken(token);
      user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await user.save();
      try {
        await sendPasswordResetEmail(user.email, token);
      } catch (error) {
        user.passwordResetTokenHash = undefined;
        user.passwordResetExpiresAt = undefined;
        await user.save();
        throw error;
      }
    }
    res.json({ ok: true, message: genericMessage });
  } catch (error) {
    if (error instanceof InputError) return res.status(400).json({ message: error.message });
    res.status(502).json({ message: "Não foi possível enviar o e-mail agora. Tente novamente." });
  }
});

app.post("/api/auth/reset-password", authLimiter, async (req, res) => {
  try {
    const token = requiredText(req.body?.token, "Token", 100);
    const password = validatePassword(req.body?.password, "A nova senha");
    const user = await User.findOne({
      passwordResetTokenHash: hashResetToken(token),
      passwordResetExpiresAt: { $gt: new Date() },
    }).select("+passwordResetTokenHash +passwordResetExpiresAt");
    if (!user) return res.status(400).json({ message: "Este link é inválido ou expirou." });
    user.passwordHash = await bcrypt.hash(password, 10);
    user.passwordChangedAt = new Date();
    user.passwordVersion = Number(user.passwordVersion || 0) + 1;
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpiresAt = undefined;
    await user.save();
    res.json({ ok: true, message: "Senha redefinida. Entre novamente." });
  } catch (error) {
    if (error instanceof InputError) return res.status(400).json({ message: error.message });
    res.status(500).json({ message: "Erro ao redefinir senha." });
  }
});

app.post("/api/auth/verify-email", authLimiter, async (req, res) => {
  try {
    const token = requiredText(req.body?.token, "Token", 100);
    const user = await User.findOne({ emailVerificationTokenHash: hashResetToken(token), emailVerificationExpiresAt: { $gt: new Date() } }).select("+emailVerificationTokenHash +emailVerificationExpiresAt");
    if (!user) return res.status(400).json({ message: "Este link é inválido ou expirou. Solicite um novo link nas Configurações." });
    user.emailVerified = true;
    user.emailVerificationTokenHash = undefined;
    user.emailVerificationExpiresAt = undefined;
    await user.save();
    res.json({ ok: true, message: "E-mail confirmado com sucesso." });
  } catch (error) {
    if (error instanceof InputError) return res.status(400).json({ message: error.message });
    res.status(500).json({ message: "Não foi possível confirmar seu e-mail agora." });
  }
});

app.post("/api/auth/resend-verification", authLimiter, auth, async (req, res) => {
  try {
    if (req.user.emailVerified) return res.json({ ok: true, alreadyVerified: true, message: "Seu e-mail já está confirmado." });
    await sendVerificationForUser(req.user);
    res.json({ ok: true, message: "Enviamos um novo link de confirmação para seu e-mail." });
  } catch (error) {
    if (error instanceof InputError) return res.status(503).json({ message: error.message });
    res.status(502).json({ message: "Não foi possível enviar o e-mail agora. Tente novamente." });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body || {};
    const email = emailAddress(rawEmail);
    const user = await User.findOne({ email }).select("+failedLoginAttempts +loginLockedUntil");
    if (!user) return res.status(401).json({ message: "E-mail ou senha inválidos." });
    if (!user.passwordHash) return res.status(401).json({ message: "E-mail ou senha inválidos." });
    if (user.loginLockedUntil && user.loginLockedUntil > new Date()) return res.status(429).json({ message: "Acesso temporariamente bloqueado. Tente novamente em 15 minutos." });
    const valid = await bcrypt.compare(password || "", user.passwordHash);
    if (!valid) {
      user.failedLoginAttempts = Number(user.failedLoginAttempts || 0) + 1;
      if (user.failedLoginAttempts >= 5) {
        user.loginLockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        user.failedLoginAttempts = 0;
      }
      await user.save();
      return res.status(401).json({ message: "E-mail ou senha inválidos." });
    }
    const deniedMessage = accessDenied(user);
    if (deniedMessage) return res.status(403).json({ message: deniedMessage });
    user.failedLoginAttempts = 0;
    user.loginLockedUntil = undefined;
    user.lastLoginAt = new Date();
    await user.save();
    await setSession(res, user);
    res.json({ user: publicUser(user, false) });
  } catch (error) {
    if (error instanceof InputError) return res.status(401).json({ message: "E-mail ou senha inválidos." });
    res.status(500).json({ message: "Erro ao fazer login." });
  }
});

app.post("/api/auth/session", authLimiter, async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  if (!code || code.length > 100) return res.status(401).json({ message: "Confirmação de login inválida." });
  const user = await User.findOneAndUpdate({ oauthExchangeHash: hashResetToken(code), oauthExchangeExpiresAt: { $gt: new Date() } }, { $unset: { oauthExchangeHash: 1, oauthExchangeExpiresAt: 1 } }, { new: true });
  if (!user || accessDenied(user)) return res.status(401).json({ message: "Confirmação de login expirada." });
  await setSession(res, user);
  res.json({ user: publicUser(user, false) });
});
app.post("/api/auth/logout", async (req, res) => { if (!CORS_ORIGINS.includes(req.headers.origin)) return res.status(403).json({message:"Origem inválida."}); const token=readCookie(req,SESSION_COOKIE); if(token)await Session.deleteOne({tokenHash:hashResetToken(token)}); res.clearCookie(SESSION_COOKIE, sessionOptions); res.set("Cache-Control","no-store"); res.json({ ok: true }); });

registerMfaRoutes(app, { User, Session, auth, adminOnly, authLimiter, setSession, publicUser, JWT_SECRET });

app.get("/api/me", auth, asyncHandler(async (req, res) => res.json({ user: publicUser(req.user, req.authSession?.mfaVerified) })));

app.patch("/api/me/profile", auth, async (req, res) => {
  try {
    const name = requiredText(req.body?.name ?? req.user.name, "Nome", 80);
    const profilePhoto = String(req.body?.profilePhoto || "");
    if (profilePhoto && (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(profilePhoto) || profilePhoto.length > 120000)) {
      return res.status(400).json({ message: "A foto de perfil não é válida ou ficou muito grande." });
    }
    const user = await User.findByIdAndUpdate(req.user._id, { name, profilePhoto }, { new: true, runValidators: true }).select("name email profilePhoto");
    await Transaction.updateMany({ createdBy: user._id }, { responsibleName: name.split(/\s+/)[0] });
    res.json({ user: publicUser(user), message: "Perfil atualizado." });
  } catch {
    res.status(500).json({ message: "Erro ao salvar o perfil." });
  }
});

app.patch("/api/me/password", auth, async (req, res) => {
  try {
    const currentPassword = validatePassword(req.body?.currentPassword, "A senha atual");
    const newPassword = validatePassword(req.body?.newPassword, "A nova senha");
    if (currentPassword === newPassword) return res.status(400).json({ message: "A nova senha deve ser diferente da atual." });
    const user = await User.findById(req.user._id);
    if (user && !user.passwordHash) return res.status(400).json({ message: "Sua conta usa Google e ainda não possui senha. Use a recuperação de senha para criar uma." });
    const valid = user && await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(400).json({ message: "A senha atual está incorreta." });
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.passwordChangedAt = new Date();
    user.passwordVersion = Number(user.passwordVersion || 0) + 1;
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpiresAt = undefined;
    await user.save();
    res.json({ ok: true, message: "Senha alterada. Entre novamente." });
  } catch (error) {
    if (error instanceof InputError) return res.status(400).json({ message: error.message });
    res.status(500).json({ message: "Erro ao alterar senha." });
  }
});

const deleteAccount = userId => deleteUserData({User,Space,Member,Account,Transaction,PurchasePlan,Invite,DebtPlan,AuditLog,BackupSnapshot,MerchantCategoryMap,Subscription,CouponUsage,SupportTicket,AdminNote,AdminAudit,Session},userId);
app.delete("/api/me", auth, async (req,res) => {
  if(ADMIN_EMAILS.has(String(req.user.email).toLowerCase()))return res.status(403).json({message:"O administrador principal não pode excluir a própria conta."});
  await deleteAccount(req.user._id);
  res.clearCookie(SESSION_COOKIE,sessionOptions);
  res.json({ok:true});
});

app.get("/api/spaces", auth, asyncHandler(async (req, res) => {
  const memberships = await Member.find({ userId: req.user._id }).populate("spaceId");
  res.json({ spaces: await Promise.all(memberships.filter((item) => item.spaceId).map(serializeSpaceForUser)) });
}));

app.patch("/api/spaces/:spaceId/settings", auth, async (req, res) => {
  try {
    if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
    const reserve = Number(req.body.reserve);
    if (!Number.isFinite(reserve) || reserve < 0 || reserve > 1000000000000) {
      return res.status(400).json({ message: "Informe uma reserva válida." });
    }
    const requested = await Space.findById(req.params.spaceId);
    if (!requested) return res.status(404).json({ message: "Espaço não encontrado." });
    const target = requested.type === "couple" ? await Space.findOne({ type: "individual", ownerId: req.user._id }) : requested;
    if (!target) return res.status(404).json({ message: "Espaço individual não encontrado." });
    const before = target.toObject();
    target.reserve = reserve;
    target.reserveConfigured = true;
    await target.save();
    await recordAudit({ spaceId: target._id, user: req.user, action: "settings", entityType: "space", entityId: target._id, summary: "Proteção financeira individual atualizada", before, after: target });
    const membership = await Member.findOne({ userId: req.user._id, spaceId: requested._id });
    res.json({ space: await serializeSpaceForUser({ spaceId: requested, role: membership.role }) });
  } catch (error) {
    res.status(500).json({ message: "Erro ao salvar configurações." });
  }
});

const featureAvailable = key => async (req,res,next) => {
  const flag=await FeatureFlag.findOne({key}).lean();
  if(flag && (!flag.active || flag.audience === "ADMINS" && req.user.role === "USER" || flag.audience === "PREMIUM" && req.user.planCode !== "PREMIUM" || flag.audience === "TEST_GROUP" && req.user.trialStatus !== "ACTIVE"))return res.status(403).json({message:"Este recurso está desativado ou indisponível para sua conta."});
  next();
};
app.use("/api/spaces/:spaceId/purchase-plans",auth,featureAvailable("planejamento"));
app.use(["/api/spaces/:spaceId/debt-plan","/api/spaces/:spaceId/debts"],auth,featureAvailable("planejamento"));
app.post("/api/spaces/couple", auth, featureAvailable("modo_casal"), async (req, res) => {
  try {
    const partnerName = optionalText(req.body?.partnerName, "Parceiro(a)", 80);
    const existingOwnedCouple = await Space.findOne({ ownerId: req.user._id, type: "couple" }).sort({ createdAt: 1 });
    if (existingOwnedCouple) {
      const memberCount = await Member.countDocuments({ spaceId: existingOwnedCouple._id });
      const invite = memberCount > 1 ? null : await createInviteForSpace(existingOwnedCouple._id, req.user._id);
      return res.json({ space: { ...existingOwnedCouple.toObject(), memberCount }, invite });
    }

    const memberships = await Member.find({ userId: req.user._id }).populate("spaceId");
    if (memberships.some((item) => item.spaceId?.type === "couple")) {
      return res.status(409).json({ message: "Você já participa de um espaço de casal." });
    }

    const space = await Space.create({ name: `${req.user.name} & ${partnerName}`, type: "couple", ownerId: req.user._id });
    await Member.create({ spaceId: space._id, userId: req.user._id, role: "owner" });
    await Account.create({ spaceId: space._id, name: "Conta conjunta", ownerName: "Casal", balance: 0 });
    const invite = await createInviteForSpace(space._id, req.user._id);
    res.status(201).json({ space: { ...space.toObject(), memberCount: 1 }, invite });
  } catch (error) {
    if (error instanceof InputError) return res.status(400).json({ message: error.message });
    res.status(500).json({ message: "Erro ao criar espaço casal." });
  }
});

app.get("/api/invites/:code", async (req, res) => {
  try {
    const invite = await Invite.findOne({ code: req.params.code }).populate("spaceId").populate("createdBy", "name");
    if (!invite) return res.status(404).json({ message: "Convite não encontrado." });
    const memberCount = await Member.countDocuments({ spaceId: invite.spaceId._id });
    res.json({
      invite: {
        code: invite.code,
        used: Boolean(invite.usedAt),
        expired: invite.expiresAt < new Date(),
        expiresAt: invite.expiresAt,
        spaceName: invite.spaceId.name,
        ownerName: invite.createdBy?.name || "FinanFlow",
        memberCount,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Erro ao consultar convite." });
  }
});

app.post("/api/invites/:code/accept", auth, async (req, res) => {
  try {
    const invite = await Invite.findOne({ code: req.params.code }).populate("spaceId");
    if (!invite) return res.status(404).json({ message: "Convite não encontrado." });
    if (invite.usedAt) return res.status(410).json({ message: "Convite já utilizado." });
    if (invite.expiresAt < new Date()) return res.status(410).json({ message: "Convite expirado." });
    if (String(invite.createdBy) === String(req.user._id)) return res.status(400).json({ message: "Este convite deve ser aceito pela outra pessoa." });
    const currentMember = await Member.findOne({ spaceId: invite.spaceId._id, userId: req.user._id });
    if (!currentMember) {
      const memberships = await Member.find({ userId: req.user._id }).populate("spaceId");
      if (memberships.some((item) => item.spaceId?.type === "couple" && String(item.spaceId._id) !== String(invite.spaceId._id))) {
        return res.status(409).json({ message: "Você já participa de outro espaço de casal." });
      }
      const memberCount = await Member.countDocuments({ spaceId: invite.spaceId._id });
      if (memberCount >= 2) return res.status(409).json({ message: "Este espaço de casal já tem duas pessoas." });
    }
    const claimedInvite = await Invite.findOneAndUpdate(
      { _id: invite._id, usedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { new: true }
    );
    if (!claimedInvite) return res.status(410).json({ message: "Convite expirado ou já utilizado." });
    try {
      await Member.updateOne({ spaceId: invite.spaceId._id, userId: req.user._id }, { role: "member" }, { upsert: true });
    } catch (error) {
      await Invite.updateOne({ _id: claimedInvite._id }, { $unset: { usedAt: 1 } });
      throw error;
    }
    res.json({ space: invite.spaceId });
  } catch (error) {
    res.status(500).json({ message: "Erro ao aceitar convite." });
  }
});

app.delete("/api/spaces/:spaceId/members/me", auth, asyncHandler(async (req, res) => {
  const membership = await Member.findOne({ userId: req.user._id, spaceId: req.params.spaceId }).populate("spaceId");
  if (!membership?.spaceId || membership.spaceId.type !== "couple") return res.status(404).json({ message: "Espaço do casal não encontrado." });
  const space = membership.spaceId;
  const otherMember = await Member.findOne({ spaceId: space._id, userId: { $ne: req.user._id } });
  await recordAudit({ spaceId: space._id, user: req.user, action: "settings", entityType: "space", entityId: space._id, summary: `${req.user.name.split(/\s+/)[0]} saiu do espaço do casal`, before: membership });
  await Member.deleteOne({ _id: membership._id });
  if (otherMember) {
    if (String(space.ownerId) === String(req.user._id)) {
      await Space.updateOne({ _id: space._id }, { ownerId: otherMember.userId });
      await Member.updateOne({ _id: otherMember._id }, { role: "owner" });
    }
  } else {
    await Promise.all([
      Invite.deleteMany({ spaceId: space._id }),
      Transaction.deleteMany({ spaceId: space._id }),
      Account.deleteMany({ spaceId: space._id }),
      PurchasePlan.deleteMany({ spaceId: space._id }),
      Space.deleteOne({ _id: space._id }),
    ]);
  }
  res.json({ ok: true });
}));

app.get("/api/spaces/:spaceId/accounts", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const viewIds = await spaceViewIds(req.params.spaceId);
  if (viewIds.length === 1 && String(viewIds[0]) === String(req.params.spaceId)) {
    if (await multiAccountOn(req.user)) return res.json({ accounts: await ensureBaseAccounts(req.params.spaceId, req.user.name) });
    return res.json({ accounts: [await ensurePrimaryAccount(req.params.spaceId, req.user.name)] });
  }
  const individualSpaces = await Space.find({ _id: { $in: viewIds } }).select("_id ownerId").lean();
  const accounts = await Account.find({ spaceId: { $in: viewIds } }).lean();
  const ownerBySpace = new Map(individualSpaces.map((space) => [String(space._id), String(space.ownerId)]));
  accounts.sort((a, b) => Number(ownerBySpace.get(String(b.spaceId)) === String(req.user._id)) - Number(ownerBySpace.get(String(a.spaceId)) === String(req.user._id)));
  res.json({ accounts });
}));

app.post("/api/spaces/:spaceId/accounts", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  if (await multiAccountOn(req.user)) {
    const writeSpaceId = await userWriteSpaceId(req.params.spaceId, req.user._id);
    const accounts = await ensureBaseAccounts(writeSpaceId, req.user.name);
    const input = parseAccountInput(req.body, req.user);
    assertCanCreate(accounts, input.name);
    const created = await Account.create({ ...input, spaceId: writeSpaceId, userCreated: true });
    await recordAudit({ spaceId: writeSpaceId, user: req.user, action: "create", entityType: "account", entityId: created._id, summary: `Conta criada: ${created.name}`, after: created });
    return res.status(201).json({ account: created });
  }
  const account = await ensurePrimaryAccount(req.params.spaceId, req.user.name);
  res.status(409).json({ message: "Este espaço já possui uma conta principal automática.", account });
}));

app.put("/api/spaces/:spaceId/accounts/:accountId", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const writeSpaceId = await userWriteSpaceId(req.params.spaceId, req.user._id);
  if (await multiAccountOn(req.user)) {
    const accounts = await ensureBaseAccounts(writeSpaceId, req.user.name);
    const current = accounts.find((item) => String(item._id) === String(req.params.accountId));
    if (!current) return res.status(404).json({ message: "Conta não encontrada." });
    const patch = parseAccountInput(req.body, req.user, { partial: true });
    assertCanUpdate({ account: current, patch, accounts });
    const before = current.toObject();
    const updated = await Account.findOneAndUpdate({ _id: current._id, spaceId: writeSpaceId }, { $set: patch }, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ message: "Conta não encontrada." });
    const verb = patch.archived === true ? "arquivada" : patch.archived === false ? "reativada" : "atualizada";
    await recordAudit({ spaceId: writeSpaceId, user: req.user, action: "update", entityType: "account", entityId: updated._id, summary: `Conta ${verb}: ${updated.name}`, before, after: updated });
    return res.json({ account: updated });
  }
  const primary = await ensurePrimaryAccount(writeSpaceId, req.user.name);
  if (String(primary._id) !== String(req.params.accountId)) return res.status(404).json({ message: "Conta principal não encontrada." });
  const space = await Space.findById(writeSpaceId);
  const account = await Account.findOneAndUpdate(
    { _id: primary._id, spaceId: writeSpaceId },
    {
      name: space?.type === "couple" ? "Conta conjunta" : "Conta principal",
      ownerName: optionalText(req.body?.ownerName, req.user.name, 80),
      balance: moneyValue(req.body?.balance ?? 0, { label: "Saldo" }),
    },
    { new: true, runValidators: true }
  );
  if (!account) return res.status(404).json({ message: "Conta não encontrada." });
  await recordAudit({ spaceId: writeSpaceId, user: req.user, action: "update", entityType: "account", entityId: account._id, summary: "Saldo inicial atualizado", before: primary, after: account });
  res.json({ account });
}));

app.delete("/api/spaces/:spaceId/accounts/:accountId", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  if (await multiAccountOn(req.user)) {
    const writeSpaceId = await userWriteSpaceId(req.params.spaceId, req.user._id);
    const accounts = await ensureBaseAccounts(writeSpaceId, req.user.name);
    const target = accounts.find((item) => String(item._id) === String(req.params.accountId));
    if (!target) return res.status(404).json({ message: "Conta não encontrada." });
    assertCanDelete({ account: target, accounts, confirmName: req.body?.confirmName });
    const transactions = await Transaction.find({ spaceId: writeSpaceId, accountId: target._id }).lean();
    const { summary, before } = accountDeleteAudit({ account: target.toObject(), transactions });
    // A cópia vai para a auditoria ANTES de apagar qualquer coisa.
    await recordAudit({ spaceId: writeSpaceId, user: req.user, action: "delete", entityType: "account", entityId: target._id, summary, before });
    await Transaction.deleteMany({ spaceId: writeSpaceId, accountId: target._id });
    await Account.deleteOne({ _id: target._id, spaceId: writeSpaceId });
    return res.json({ ok: true, removedTransactions: transactions.length });
  }
  const account = await ensurePrimaryAccount(req.params.spaceId, req.user.name);
  if (String(account._id) !== String(req.params.accountId)) return res.status(404).json({ message: "Conta não encontrada." });
  res.status(409).json({ message: "A conta principal automática não pode ser excluída." });
}));

app.get("/api/spaces/:spaceId/transactions", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const viewIds = await spaceViewIds(req.params.spaceId);
  await Promise.all(viewIds.map((spaceId) => extendRecurringTransactions(spaceId)));
  res.json({ transactions: await Transaction.find({ spaceId: { $in: viewIds } }).sort({ date: -1, createdAt: -1 }) });
}));

app.get("/api/spaces/:spaceId/purchase-plans", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const viewIds = await spaceViewIds(req.params.spaceId);
  res.json({ plans: await PurchasePlan.find({ spaceId: { $in: viewIds } }).sort({ createdAt: 1 }) });
}));

app.post("/api/spaces/:spaceId/purchase-plans", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const item = String(req.body?.item || "").trim();
  const total = Number(req.body?.total);
  const monthlyLimit = Number(req.body?.monthlyLimit);
  if (!item || item.length > 120) return res.status(400).json({ message: "Informe o produto com até 120 caracteres." });
  if (!Number.isFinite(total) || total <= 0 || total > 1000000000000) return res.status(400).json({ message: "Informe um valor total válido." });
  if (!Number.isFinite(monthlyLimit) || monthlyLimit <= 0 || monthlyLimit > 1000000000000) return res.status(400).json({ message: "Informe quanto pode guardar por mês." });
  const writeSpaceId = await userWriteSpaceId(req.params.spaceId, req.user._id);
  const plan = await PurchasePlan.create({ spaceId: writeSpaceId, item, total, monthlyLimit, createdBy: req.user._id, responsibleName: req.user.name });
  res.status(201).json({ plan });
}));

app.delete("/api/spaces/:spaceId/purchase-plans/:planId", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const viewIds = await spaceViewIds(req.params.spaceId);
  const plan = await PurchasePlan.findOne({ _id: req.params.planId, spaceId: { $in: viewIds } });
  if (!plan) return res.status(404).json({ message: "Planejamento não encontrado." });
  if (String(plan.createdBy) !== String(req.user._id)) return res.status(403).json({ message: "Somente quem criou este planejamento pode excluí-lo." });
  await plan.deleteOne();
  res.json({ ok: true });
}));

function normalizeMerchantName(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

app.get("/api/merchant-category-map", auth, asyncHandler(async (req, res) => {
  const items = await MerchantCategoryMap.find({ userId: req.user._id }).sort({ usageCount: -1 }).limit(300).lean();
  res.json({ items: items.map((item) => ({ normalizedName: item.normalizedName, category: item.category })) });
}));

app.post("/api/merchant-category-map", auth, asyncHandler(async (req, res) => {
  const displayName = requiredText(req.body?.displayName, "Estabelecimento", 160);
  const normalizedName = normalizeMerchantName(displayName);
  const category = requiredText(req.body?.category, "Categoria", 50);
  if (normalizedName.length < 2) return res.status(400).json({ message: "Estabelecimento inválido." });
  const item = await MerchantCategoryMap.findOneAndUpdate(
    { userId: req.user._id, normalizedName },
    { $set: { displayName, category }, $inc: { usageCount: 1 } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
  res.json({ item });
}));

app.post("/api/spaces/:spaceId/transactions", auth, async (req, res) => {
  try {
    if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
    const writeSpaceId = await userWriteSpaceId(req.params.spaceId, req.user._id);
    const requestId = optionalText(req.body?.requestId, "", 80);
    if (requestId) {
      const duplicate = await Transaction.findOne({ spaceId: writeSpaceId, requestId });
      if (duplicate) return res.json({ transaction: duplicate, transactions: [duplicate], duplicate: true });
    }
    const accountId = await normalizeAccountIdForSpace(req.body?.accountId, writeSpaceId, req.user.name, { multi: await multiAccountOn(req.user) });
    const input = transactionInput(req.body, accountId, req.user);
    const recurrence = req.body?.recurrence === "monthly" ? "monthly" : "none";
    const installmentCount = Math.max(1, Math.min(120, Math.trunc(Number(req.body?.installmentCount || 1))));
    if (recurrence === "monthly" && installmentCount > 1) return res.status(400).json({ message: "Escolha conta fixa mensal ou parcelamento, não os dois." });
    const seriesId = recurrence === "monthly" || installmentCount > 1 ? crypto.randomUUID() : undefined;
    const documents = [];
    if (recurrence === "monthly") {
      for (let index = 0; index < 24; index += 1) {
        documents.push({ ...input, spaceId: writeSpaceId, date: addMonthsToIsoDate(input.date, index), status: index === 0 ? input.status : "pendente", seriesId, recurrence });
      }
    } else if (installmentCount > 1) {
      const totalAmount = Number((input.amount * installmentCount).toFixed(2));
      if (totalAmount > 1000000000000) return res.status(400).json({ message: "O valor total do parcelamento ultrapassa o limite permitido." });
      const installmentAmounts = repeatInstallmentAmount(input.amount, installmentCount);
      for (let index = 0; index < installmentCount; index += 1) {
        documents.push({ ...input, spaceId: writeSpaceId, amount: installmentAmounts[index], date: addMonthsToIsoDate(input.date, index), status: index === 0 ? input.status : "pendente", seriesId, recurrence: "none", installmentNumber: index + 1, installmentCount, totalAmount });
      }
    } else {
      documents.push({ ...input, spaceId: writeSpaceId, recurrence: "none", installmentNumber: 1, installmentCount: 1, totalAmount: input.amount });
    }
    if (requestId) documents[0].requestId = requestId;
    const transactions = await Transaction.insertMany(documents);
    await recordAudit({ spaceId: writeSpaceId, user: req.user, action: "create", entityType: "transaction", entityId: transactions[0]._id, summary: `Lançamento criado: ${input.description}`, after: transactions });
    res.status(201).json({ transaction: transactions[0], transactions });
  } catch (error) {
    if (error?.code === 11000 && req.body?.requestId) {
      const viewIds = await spaceViewIds(req.params.spaceId);
      const duplicate = await Transaction.findOne({ spaceId: { $in: viewIds }, requestId: req.body.requestId, createdBy: req.user._id });
      if (duplicate) return res.json({ transaction: duplicate, transactions: [duplicate], duplicate: true });
    }
    const invalidInput = error.status === 400 || error.name === "ValidationError";
    res.status(invalidInput ? 400 : 500).json({ message: invalidInput ? error.message : "Erro ao criar lançamento." });
  }
});

app.patch("/api/spaces/:spaceId/transactions/:transactionId/status", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const viewIds = await spaceViewIds(req.params.spaceId);
  const existing = await Transaction.findOne({ _id: req.params.transactionId, spaceId: { $in: viewIds } });
  if (!existing) return res.status(404).json({ message: "Lançamento não encontrado." });
  if (String(existing.createdBy) !== String(req.user._id)) return res.status(403).json({ message: "Somente quem criou o lançamento pode confirmar o pagamento." });
  const status = oneOf(req.body?.status, ["pendente", "pago"], "Status");
  const transaction = await Transaction.findByIdAndUpdate(existing._id, { $set: { status }, ...(status === "pago" ? { $unset: { reminderDate: 1 } } : {}) }, { new: true, runValidators: true });
  await recordAudit({ spaceId: existing.spaceId, user: req.user, action: "update", entityType: "transaction", entityId: transaction._id, summary: `${transaction.description}: ${status === "pago" ? transaction.type === "receita" ? "recebido" : "pago" : "pendente"}`, before: existing, after: transaction });
  res.json({ transaction });
}));

app.patch("/api/spaces/:spaceId/transactions/:transactionId/reminder", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const viewIds = await spaceViewIds(req.params.spaceId);
  const existing = await Transaction.findOne({ _id: req.params.transactionId, spaceId: { $in: viewIds } });
  if (!existing) return res.status(404).json({ message: "Lançamento não encontrado." });
  if (String(existing.createdBy) !== String(req.user._id)) return res.status(403).json({ message: "Somente quem criou o lançamento pode reagendar o lembrete." });
  if (existing.status !== "pendente") return res.status(409).json({ message: "Este lançamento já foi concluído." });
  const reminderDate = isoDate(req.body?.reminderDate, "Nova data do lembrete");
  const transaction = await Transaction.findByIdAndUpdate(existing._id, { reminderDate }, { new: true, runValidators: true });
  await recordAudit({ spaceId: existing.spaceId, user: req.user, action: "update", entityType: "transaction", entityId: transaction._id, summary: `Lembrete reagendado: ${transaction.description}`, before: existing, after: transaction });
  res.json({ transaction });
}));

app.patch("/api/spaces/:spaceId/transactions/:transactionId/pending-series", auth, asyncHandler(async (req,res)=>{
  if(!await userCanAccessSpace(req.user._id,req.params.spaceId))return res.status(403).json({message:"Sem acesso ao espaço."});
  const viewIds=await spaceViewIds(req.params.spaceId);
  const selected=await Transaction.findOne({_id:req.params.transactionId,spaceId:{$in:viewIds}}).lean();
  if(!selected)return res.status(404).json({message:"Lançamento não encontrado."});
  if(String(selected.createdBy)!==String(req.user._id))return res.status(403).json({message:"Somente quem criou a série pode editá-la."});
  const requestedAccount=req.body?.accountId||selected.accountId;
  const account=requestedAccount ? await Account.findOne({_id:requestedAccount,spaceId:selected.spaceId}).lean() : await Account.findOne({spaceId:selected.spaceId}).sort({createdAt:1}).lean();
  if(!account)throw new InputError("Conta principal não encontrada. Atualize as contas antes de editar.");
  const accountId=account._id;
  const input=transactionInput(req.body,accountId,req.user);
  const result=await updatePendingSeries({Transaction,AuditLog,selectedId:selected._id,viewIds,user:req.user,input,snapshot:req.body?.seriesSnapshot,structure:{recurrence:req.body?.recurrence||"none",installmentCount:Number(req.body?.installmentCount||1)}});
  res.json(result);
}));

app.put("/api/spaces/:spaceId/transactions/:transactionId", auth, async (req, res) => {
  try {
    if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
    const viewIds = await spaceViewIds(req.params.spaceId);
    const existing = await Transaction.findOne({ _id: req.params.transactionId, spaceId: { $in: viewIds } });
    if (!existing) return res.status(404).json({ message: "Lançamento não encontrado." });
    if (String(existing.createdBy) !== String(req.user._id)) return res.status(403).json({ message: "Somente quem criou o lançamento pode editá-lo." });
    const accountId = await normalizeAccountIdForSpace(req.body?.accountId ?? existing.accountId, existing.spaceId, req.user.name, { multi: await multiAccountOn(req.user), currentAccountId: existing.accountId });
    const input = transactionInput(req.body, accountId, req.user);
    const recurrence = req.body?.recurrence === "monthly" ? "monthly" : "none";
    const installmentCount = Math.max(1, Math.min(120, Math.trunc(Number(req.body?.installmentCount || 1))));
    if (recurrence === "monthly" && installmentCount > 1) return res.status(400).json({ message: "Escolha conta fixa mensal ou parcelamento, não os dois." });
    const previous = existing.seriesId
      ? await Transaction.find({ spaceId: existing.spaceId, seriesId: existing.seriesId }).sort({ date: 1 })
      : [existing];
    if (previous.some(item => String(item._id) !== String(existing._id) && item.status === "pago")) {
      return res.status(409).json({ message: "Esta série possui outros pagamentos concluídos. A edição completa foi bloqueada para preservar o histórico." });
    }
    const grouped = recurrence === "monthly" || installmentCount > 1;
    const seriesId = grouped ? (existing.seriesId || crypto.randomUUID()) : undefined;
    const documents = [];
    if (recurrence === "monthly") {
      for (let index = 0; index < 24; index += 1) {
        documents.push({ ...input, spaceId: existing.spaceId, date: addMonthsToIsoDate(input.date, index), status: index === 0 ? input.status : "pendente", seriesId, recurrence: "monthly" });
      }
    } else if (installmentCount > 1) {
      const totalAmount = Number((input.amount * installmentCount).toFixed(2));
      if (totalAmount > 1000000000000) return res.status(400).json({ message: "O valor total do parcelamento ultrapassa o limite permitido." });
      const amounts = repeatInstallmentAmount(input.amount, installmentCount);
      for (let index = 0; index < installmentCount; index += 1) {
        documents.push({ ...input, spaceId: existing.spaceId, amount: amounts[index], date: addMonthsToIsoDate(input.date, index), status: index === 0 ? input.status : "pendente", seriesId, recurrence: "none", installmentNumber: index + 1, installmentCount, totalAmount });
      }
    } else {
      documents.push({ ...input, spaceId: existing.spaceId, recurrence: "none", installmentNumber: 1, installmentCount: 1, totalAmount: input.amount });
    }
    if (existing.seriesId) await Transaction.deleteMany({ spaceId: existing.spaceId, seriesId: existing.seriesId, _id: { $ne: existing._id } });
    const first = documents.shift();
    const obsoleteFields = recurrence === "monthly"
      ? { installmentNumber: 1, installmentCount: 1, totalAmount: 1, reminderDate: 1 }
      : grouped ? { reminderDate: 1 } : { seriesId: 1, reminderDate: 1 };
    const transaction = await Transaction.findByIdAndUpdate(existing._id, { $set: first, $unset: obsoleteFields }, { new: true, runValidators: true });
    if (documents.length) await Transaction.insertMany(documents);
    await recordAudit({ spaceId: existing.spaceId, user: req.user, action: "update", entityType: "transaction", entityId: transaction._id, summary: `Lançamento atualizado: ${transaction.description}`, before: previous, after: [transaction, ...documents] });
    res.json({ transaction });
  } catch (error) {
    const invalidInput = error.status === 400 || error.name === "ValidationError";
    res.status(invalidInput ? 400 : 500).json({ message: invalidInput ? error.message : "Erro ao atualizar lançamento." });
  }
});

app.delete("/api/spaces/:spaceId/transactions/:transactionId", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const viewIds = await spaceViewIds(req.params.spaceId);
  const transaction = await Transaction.findOne({ _id: req.params.transactionId, spaceId: { $in: viewIds } });
  if (!transaction) return res.status(404).json({ message: "Lançamento não encontrado." });
  if (String(transaction.createdBy) !== String(req.user._id)) return res.status(403).json({ message: "Somente quem criou o lançamento pode excluí-lo." });
  const removed = transaction.seriesId
    ? await Transaction.find({ spaceId: transaction.spaceId, seriesId: transaction.seriesId })
    : [transaction];
  if (transaction.seriesId) await Transaction.deleteMany({ spaceId: transaction.spaceId, seriesId: transaction.seriesId });
  else await Transaction.deleteOne({ _id: transaction._id });
  await recordAudit({ spaceId: transaction.spaceId, user: req.user, action: "delete", entityType: "transaction", entityId: transaction._id, summary: `Lançamento excluído: ${transaction.description}`, before: removed });
  res.json({ ok: true });
}));

app.get("/api/spaces/:spaceId/history", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const viewIds = await spaceViewIds(req.params.spaceId);
  const history = await AuditLog.find({ spaceId: { $in: [...viewIds, req.params.spaceId] } }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ history: history.map(({ before, after, ...item }) => ({ ...item, canRestore: item.action === "delete" && item.entityType === "transaction" && !item.restoredAt })) });
}));

app.post("/api/spaces/:spaceId/history/:auditId/restore", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const viewIds = await spaceViewIds(req.params.spaceId);
  const audit = await AuditLog.findOne({ _id: req.params.auditId, spaceId: { $in: [...viewIds, req.params.spaceId] }, userId: req.user._id, action: "delete", entityType: "transaction", restoredAt: { $exists: false } });
  if (!audit) return res.status(404).json({ message: "Este lançamento não está mais disponível para restauração." });
  const snapshots = Array.isArray(audit.before) ? audit.before : [audit.before];
  const restored = [];
  for (const snapshot of snapshots.filter(Boolean)) {
    const document = plainDocument(snapshot);
    const exists = document?._id && await Transaction.exists({ _id: document._id });
    if (!exists) restored.push(await Transaction.create(document));
  }
  audit.restoredAt = new Date();
  await audit.save();
  await recordAudit({ spaceId: audit.spaceId, user: req.user, action: "restore", entityType: "transaction", entityId: audit.entityId, summary: `Lançamento restaurado: ${audit.summary.replace("Lançamento excluído: ", "")}`, after: restored });
  res.json({ restored });
}));

app.delete("/api/spaces/:spaceId/reset", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const space = await Space.findById(req.params.spaceId);
  const snapshot = await createSpaceSnapshot(req.params.spaceId, req.user, "before_reset");
  await Transaction.deleteMany({ spaceId: req.params.spaceId });
  await PurchasePlan.deleteMany({ spaceId: req.params.spaceId });
  await Account.deleteMany({ spaceId: req.params.spaceId });
  if (space?.type === "couple") {
    await Account.create({ spaceId: req.params.spaceId, name: "Conta conjunta", ownerName: "Casal", balance: 0 });
  } else {
    await Account.create({ spaceId: req.params.spaceId, name: "Conta principal", ownerName: req.user.name, balance: 0 });
  }
  await recordAudit({ spaceId: req.params.spaceId, user: req.user, action: "reset", entityType: "space", entityId: req.params.spaceId, summary: "Dados financeiros zerados com cópia de segurança", after: { backupId: snapshot._id } });
  res.json({ ok: true });
}));

app.get("/api/admin/overview", auth, adminOnly, asyncHandler(async (_req, res) => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [users, spaces, transactions, newUsers, pendingInvites] = await Promise.all([
    User.countDocuments(), Space.countDocuments(), Transaction.countDocuments(), User.countDocuments({ createdAt: { $gte: since } }), Invite.countDocuments({ usedAt: { $exists: false }, expiresAt: { $gt: new Date() } }),
  ]);
  res.json({ users, spaces, transactions, newUsers, pendingInvites, database: mongoose.connection.readyState === 1 ? "online" : "offline", emailConfigured: Boolean(RESEND_API_KEY && EMAIL_FROM), generatedAt: new Date().toISOString() });
}));

app.get("/api/admin/users", auth, adminOnly, asyncHandler(async (_req, res) => {
  const users = await User.find().select("name email createdAt legalVersion termsAcceptedAt accessStatus trialEndsAt blockedAt").sort({ createdAt: -1 }).limit(200).lean();
  const memberships = await Member.aggregate([{ $match: { userId: { $in: users.map((user) => user._id) } } }, { $group: { _id: "$userId", spaces: { $sum: 1 } } }]);
  const spaceCounts = new Map(memberships.map((item) => [String(item._id), item.spaces]));
  res.json({ users: users.map((user) => ({ ...user, accessStatus: user.accessStatus || "active", spaces: spaceCounts.get(String(user._id)) || 0, isAdmin: ADMIN_EMAILS.has(String(user.email).toLowerCase()) })) });
}));

app.patch("/api/admin/users/:userId/access", auth, adminOnly, asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.userId);
  if (!target) return res.status(404).json({ message: "Usuário não encontrado." });
  const action = oneOf(req.body?.action, ["trial", "activate", "block", "unblock"], "Ação");
  if (!canManageUser(req.user, target, ADMIN_EMAILS)) return res.status(403).json({ message: "Esta conta administrativa está protegida." });
  if (action === "trial") {
    const months = Number(req.body?.months);
    if (![1, 2, 3].includes(months)) throw new InputError("Escolha um teste de 1, 2 ou 3 meses.");
    const trialEndsAt = new Date(Math.max(Date.now(), +new Date(target.trialEndsAt || 0)));
    trialEndsAt.setUTCMonth(trialEndsAt.getUTCMonth() + months);
    extendTrial(target,{endsAt:trialEndsAt.toISOString().slice(0,10),planCode:target.planCode});
    target.blockedAt = undefined;
  } else if (action === "block") {
    target.accessStatus = "blocked"; target.blockedAt = new Date(); target.passwordVersion = Number(target.passwordVersion || 0) + 1;
  } else {
    grantManualPlan(target,target.planCode || "FREE");
  }
  await target.save();
  res.json({ message: action === "trial" ? "Período de teste aplicado." : action === "block" ? "Usuário bloqueado e sessões encerradas." : "Acesso liberado." });
}));

registerAdminRoutes(app,{auth,adminOnly,superAdminOnly,User,Space,Member,Account,Transaction,PurchasePlan,Invite,publicUser,canManageUser:(actor,target)=>canManageUser(actor,target,ADMIN_EMAILS),deleteAccount,sendRecovery:sendRecoveryForUser});
registerDebtPlanRoutes(app, { auth, Space, Member, Account, Transaction });

app.use((_req, res) => res.status(404).json({ message: "Rota não encontrada." }));

app.use((error, _req, res, _next) => {
  if (!error.status || error.status >= 500) console.error("Erro na API:", error.name, error.message);
  const invalidInput = error.status === 400 || error.name === "ValidationError" || error.name === "CastError";
  const status = invalidInput ? 400 : error.status >= 400 && error.status < 500 ? error.status : 500;
  res.status(status).json({ message: status < 500 ? error.message || "Dados inválidos." : "Erro interno da API." });
});

async function start() {
  if (!MONGODB_URI) {
    console.error("MONGODB_URI não configurado.");
    process.exit(1);
  }
  if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET.includes("COLE_AQUI")) {
    console.error("JWT_SECRET não configurado ou muito curto. Use pelo menos 32 caracteres.");
    process.exit(1);
  }
  await mongoose.connect(MONGODB_URI);
  await ensureTransactionRequestIndex(Transaction.collection);
  console.log("MongoDB conectado.");
  const automaticReserveCutoff = new Date("2026-09-04T20:00:00.000Z");
  await Space.updateMany(
    { reserveConfigured: { $exists: false }, createdAt: { $lt: automaticReserveCutoff } },
    { $set: { reserveConfigured: true } },
  );
  await Space.updateMany(
    { reserveConfigured: { $exists: false }, createdAt: { $gte: automaticReserveCutoff }, reserve: 300 },
    { $set: { reserve: 0, reserveConfigured: false } },
  );
  await seedAdminDefaults();
  app.listen(PORT, () => console.log(`FinanFlow API rodando na porta ${PORT}`));
}

start().catch((error) => {
  console.error("Erro ao iniciar API:", error);
  process.exit(1);
});
