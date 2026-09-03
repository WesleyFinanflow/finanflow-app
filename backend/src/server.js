import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { emailAddress, InputError, isoDate, moneyValue, oneOf, optionalText, requiredText } from "./validation.js";
import { addMonthsToIsoDate, repeatInstallmentAmount } from "./recurrence.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;
const FRONTEND_URL = String(process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
const CORS_ORIGINS = String(process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.set("trust proxy", 1);
app.disable("x-powered-by");
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
    return callback(new Error("Origem não permitida pelo CORS."));
  },
  credentials: true,
}));
app.use(express.json({ limit: "200kb" }));

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    profilePhoto: { type: String, default: "", maxlength: 120000 },
    passwordHash: { type: String, required: true },
    passwordChangedAt: { type: Date },
    passwordVersion: { type: Number, default: 0 },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    loginLockedUntil: { type: Date, select: false },
  },
  { timestamps: true }
);

const spaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, enum: ["individual", "couple"], required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reserve: { type: Number, default: 300, min: 0, max: 1000000000000 },
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
    status: { type: String, enum: ["pendente", "pago"], default: "pendente" },
    category: { type: String, default: "Outro", maxlength: 50 },
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
transactionSchema.index({ spaceId: 1, requestId: 1 }, { unique: true, sparse: true });

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
const Invite = mongoose.model("Invite", inviteSchema);
const AuditLog = mongoose.model("AuditLog", auditLogSchema);
const BackupSnapshot = mongoose.model("BackupSnapshot", backupSnapshotSchema);

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function createToken(user) {
  return jwt.sign({ userId: user._id.toString(), email: user.email, passwordVersion: Number(user.passwordVersion || 0) }, JWT_SECRET, { expiresIn: "7d" });
}

function validatePassword(value, label = "A senha") {
  if (typeof value !== "string" || !value) throw new InputError(`${label} é obrigatória.`);
  if (value.length < 6) throw new InputError(`${label} precisa ter pelo menos 6 caracteres.`);
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

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Token não informado." });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select("-passwordHash");
    if (!user) return res.status(401).json({ message: "Usuário não encontrado." });
    if (Number(decoded.passwordVersion || 0) !== Number(user.passwordVersion || 0)) {
      return res.status(401).json({ message: "Sua senha foi alterada. Entre novamente." });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: "Sessão inválida." });
  }
}

async function userCanAccessSpace(userId, spaceId) {
  return Boolean(await Member.findOne({ userId, spaceId }));
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
  const accounts = await Account.find({ spaceId }).sort({ createdAt: 1 });
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

async function normalizeAccountIdForSpace(accountId, spaceId, ownerName) {
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
    status: oneOf(body?.status ?? "pendente", ["pendente", "pago"], "Status"),
    category: optionalText(body?.category, "Outro", 50),
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
        spaceId: last.spaceId, accountId: last.accountId, type: last.type, description: last.description,
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

app.post("/api/auth/register", registerLimiter, async (req, res) => {
  try {
    const { name: rawName, email: rawEmail, password } = req.body || {};
    const name = requiredText(rawName, "Nome", 80);
    const email = emailAddress(rawEmail);
    validatePassword(password);
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: "Este e-mail já está cadastrado." });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });
    await createIndividualSpaceForUser(user);
    res.status(201).json({ token: createToken(user), user: { id: user._id, name: user.name, email: user.email, profilePhoto: user.profilePhoto || "" } });
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

app.post("/api/auth/login", authLimiter, async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body || {};
    const email = emailAddress(rawEmail);
    const user = await User.findOne({ email }).select("+failedLoginAttempts +loginLockedUntil");
    if (!user) return res.status(401).json({ message: "E-mail ou senha inválidos." });
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
    user.failedLoginAttempts = 0;
    user.loginLockedUntil = undefined;
    await user.save();
    res.json({ token: createToken(user), user: { id: user._id, name: user.name, email: user.email, profilePhoto: user.profilePhoto || "" } });
  } catch (error) {
    if (error instanceof InputError) return res.status(401).json({ message: "E-mail ou senha inválidos." });
    res.status(500).json({ message: "Erro ao fazer login." });
  }
});

app.get("/api/me", auth, asyncHandler(async (req, res) => res.json({ user: req.user })));

app.patch("/api/me/profile", auth, async (req, res) => {
  try {
    const name = requiredText(req.body?.name ?? req.user.name, "Nome", 80);
    const profilePhoto = String(req.body?.profilePhoto || "");
    if (profilePhoto && (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(profilePhoto) || profilePhoto.length > 120000)) {
      return res.status(400).json({ message: "A foto de perfil não é válida ou ficou muito grande." });
    }
    const user = await User.findByIdAndUpdate(req.user._id, { name, profilePhoto }, { new: true, runValidators: true }).select("name email profilePhoto");
    await Transaction.updateMany({ createdBy: user._id }, { responsibleName: name.split(/\s+/)[0] });
    res.json({ user: { id: user._id, name: user.name, email: user.email, profilePhoto: user.profilePhoto || "" }, message: "Perfil atualizado." });
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

app.delete("/api/me", auth, async (req, res) => {
  try {
    const memberships = await Member.find({ userId: req.user._id }).populate("spaceId");
    for (const membership of memberships) {
      if (!membership.spaceId) continue;
      const space = membership.spaceId;
      const memberCount = await Member.countDocuments({ spaceId: space._id });
      if (space.type === "individual" || memberCount <= 1) {
        await Transaction.deleteMany({ spaceId: space._id });
        await Account.deleteMany({ spaceId: space._id });
        await Invite.deleteMany({ spaceId: space._id });
        await Member.deleteMany({ spaceId: space._id });
        await Space.deleteOne({ _id: space._id });
        continue;
      }

      await Member.deleteOne({ _id: membership._id });
      if (String(space.ownerId) === String(req.user._id)) {
        const nextOwner = await Member.findOne({ spaceId: space._id });
        if (nextOwner) await Space.updateOne({ _id: space._id }, { ownerId: nextOwner.userId });
      }
    }
    await User.deleteOne({ _id: req.user._id });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: "Erro ao apagar conta." });
  }
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
    const before = await Space.findById(req.params.spaceId);
    const space = await Space.findByIdAndUpdate(req.params.spaceId, { reserve }, { new: true, runValidators: true });
    if (!space) return res.status(404).json({ message: "Espaço não encontrado." });
    await recordAudit({ spaceId: space._id, user: req.user, action: "settings", entityType: "space", entityId: space._id, summary: "Proteção financeira atualizada", before, after: space });
    const membership = await Member.findOne({ userId: req.user._id, spaceId: space._id });
    res.json({ space: await serializeSpaceForUser({ spaceId: space, role: membership.role }) });
  } catch (error) {
    res.status(500).json({ message: "Erro ao salvar configurações." });
  }
});

app.post("/api/spaces/couple", auth, async (req, res) => {
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
      Space.deleteOne({ _id: space._id }),
    ]);
  }
  res.json({ ok: true });
}));

app.get("/api/spaces/:spaceId/accounts", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const viewIds = await spaceViewIds(req.params.spaceId);
  if (viewIds.length === 1 && String(viewIds[0]) === String(req.params.spaceId)) return res.json({ accounts: [await ensurePrimaryAccount(req.params.spaceId, req.user.name)] });
  const individualSpaces = await Space.find({ _id: { $in: viewIds } }).select("_id ownerId").lean();
  const accounts = await Account.find({ spaceId: { $in: viewIds } }).lean();
  const ownerBySpace = new Map(individualSpaces.map((space) => [String(space._id), String(space.ownerId)]));
  accounts.sort((a, b) => Number(ownerBySpace.get(String(b.spaceId)) === String(req.user._id)) - Number(ownerBySpace.get(String(a.spaceId)) === String(req.user._id)));
  res.json({ accounts });
}));

app.post("/api/spaces/:spaceId/accounts", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const account = await ensurePrimaryAccount(req.params.spaceId, req.user.name);
  res.status(409).json({ message: "Este espaço já possui uma conta principal automática.", account });
}));

app.put("/api/spaces/:spaceId/accounts/:accountId", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const writeSpaceId = await userWriteSpaceId(req.params.spaceId, req.user._id);
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

app.post("/api/spaces/:spaceId/transactions", auth, async (req, res) => {
  try {
    if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
    const writeSpaceId = await userWriteSpaceId(req.params.spaceId, req.user._id);
    const requestId = optionalText(req.body?.requestId, "", 80);
    if (requestId) {
      const duplicate = await Transaction.findOne({ spaceId: writeSpaceId, requestId });
      if (duplicate) return res.json({ transaction: duplicate, transactions: [duplicate], duplicate: true });
    }
    const accountId = await normalizeAccountIdForSpace(req.body?.accountId, writeSpaceId, req.user.name);
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

app.put("/api/spaces/:spaceId/transactions/:transactionId", auth, async (req, res) => {
  try {
    if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
    const viewIds = await spaceViewIds(req.params.spaceId);
    const existing = await Transaction.findOne({ _id: req.params.transactionId, spaceId: { $in: viewIds } });
    if (!existing) return res.status(404).json({ message: "Lançamento não encontrado." });
    if (String(existing.createdBy) !== String(req.user._id)) return res.status(403).json({ message: "Somente quem criou o lançamento pode editá-lo." });
    const accountId = await normalizeAccountIdForSpace(req.body?.accountId, existing.spaceId, req.user.name);
    const input = transactionInput(req.body, accountId, req.user);
    const recurrence = req.body?.recurrence === "monthly" ? "monthly" : "none";
    const installmentCount = Math.max(1, Math.min(120, Math.trunc(Number(req.body?.installmentCount || 1))));
    if (recurrence === "monthly" && installmentCount > 1) return res.status(400).json({ message: "Escolha conta fixa mensal ou parcelamento, não os dois." });
    const previous = existing.seriesId
      ? await Transaction.find({ spaceId: existing.spaceId, seriesId: existing.seriesId }).sort({ date: 1 })
      : [existing];
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
  await Account.deleteMany({ spaceId: req.params.spaceId });
  if (space?.type === "couple") {
    await Account.create({ spaceId: req.params.spaceId, name: "Conta conjunta", ownerName: "Casal", balance: 0 });
  } else {
    await Account.create({ spaceId: req.params.spaceId, name: "Conta principal", ownerName: req.user.name, balance: 0 });
  }
  await recordAudit({ spaceId: req.params.spaceId, user: req.user, action: "reset", entityType: "space", entityId: req.params.spaceId, summary: "Dados financeiros zerados com cópia de segurança", after: { backupId: snapshot._id } });
  res.json({ ok: true });
}));

app.use((_req, res) => res.status(404).json({ message: "Rota não encontrada." }));

app.use((error, _req, res, _next) => {
  console.error("Erro na API:", error);
  const invalidInput = error.status === 400 || error.name === "ValidationError" || error.name === "CastError";
  res.status(invalidInput ? 400 : 500).json({ message: invalidInput ? error.message || "Dados inválidos." : "Erro interno da API." });
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
  console.log("MongoDB conectado.");
  app.listen(PORT, () => console.log(`FinanFlow API rodando na porta ${PORT}`));
}

start().catch((error) => {
  console.error("Erro ao iniciar API:", error);
  process.exit(1);
});
