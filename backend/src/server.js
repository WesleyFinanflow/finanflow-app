import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { emailAddress, InputError, isoDate, moneyValue, oneOf, optionalText, requiredText } from "./validation.js";

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

app.use(cors({
  origin(origin, callback) {
    if (!origin || CORS_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error("Origem não permitida pelo CORS."));
  },
  credentials: true,
}));
app.use(express.json({ limit: "100kb" }));

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true },
    passwordChangedAt: { type: Date },
    passwordVersion: { type: Number, default: 0 },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
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

const User = mongoose.model("User", userSchema);
const Space = mongoose.model("Space", spaceSchema);
const Member = mongoose.model("Member", memberSchema);
const Account = mongoose.model("Account", accountSchema);
const Transaction = mongoose.model("Transaction", transactionSchema);
const Invite = mongoose.model("Invite", inviteSchema);

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

async function serializeSpaceForUser(member) {
  const space = member.spaceId.toObject();
  const memberCount = await Member.countDocuments({ spaceId: space._id });
  return { ...space, role: member.role, memberCount };
}

async function createInviteForSpace(spaceId, userId) {
  await Invite.updateMany({ spaceId, usedAt: { $exists: false } }, { $set: { usedAt: new Date() } });
  const code = `FF-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  return Invite.create({ spaceId, code, createdBy: userId, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
}

async function normalizeAccountIdForSpace(accountId, spaceId) {
  if (!accountId) return null;
  const account = await Account.findOne({ _id: accountId, spaceId });
  if (!account) {
    const error = new Error("Conta inválida para este espaço.");
    error.status = 400;
    throw error;
  }
  return account._id;
}

async function createIndividualSpaceForUser(user) {
  const space = await Space.create({ name: `Individual de ${user.name}`, type: "individual", ownerId: user._id });
  await Member.create({ spaceId: space._id, userId: user._id, role: "owner" });
  await Account.create({ spaceId: space._id, name: "Conta principal", ownerName: user.name, balance: 0 });
  await Account.create({ spaceId: space._id, name: "Dinheiro", ownerName: user.name, balance: 0 });
  return space;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "FinanFlow API", database: mongoose.connection.readyState === 1 ? "connected" : "disconnected" });
});

app.post("/api/auth/register", async (req, res) => {
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
    res.status(201).json({ token: createToken(user), user: { id: user._id, name: user.name, email: user.email } });
  } catch (error) {
    if (error instanceof InputError) return res.status(400).json({ message: error.message });
    if (error?.code === 11000) return res.status(409).json({ message: "Este e-mail já está cadastrado." });
    res.status(500).json({ message: "Erro ao criar cadastro." });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
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

app.post("/api/auth/reset-password", async (req, res) => {
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

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body || {};
    const email = emailAddress(rawEmail);
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "E-mail ou senha inválidos." });
    const valid = await bcrypt.compare(password || "", user.passwordHash);
    if (!valid) return res.status(401).json({ message: "E-mail ou senha inválidos." });
    res.json({ token: createToken(user), user: { id: user._id, name: user.name, email: user.email } });
  } catch (error) {
    if (error instanceof InputError) return res.status(401).json({ message: "E-mail ou senha inválidos." });
    res.status(500).json({ message: "Erro ao fazer login." });
  }
});

app.get("/api/me", auth, asyncHandler(async (req, res) => res.json({ user: req.user })));

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
    const space = await Space.findByIdAndUpdate(req.params.spaceId, { reserve }, { new: true, runValidators: true });
    if (!space) return res.status(404).json({ message: "Espaço não encontrado." });
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

app.get("/api/spaces/:spaceId/accounts", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  res.json({ accounts: await Account.find({ spaceId: req.params.spaceId }).sort({ createdAt: 1 }) });
}));

app.post("/api/spaces/:spaceId/accounts", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const account = await Account.create({
    spaceId: req.params.spaceId,
    name: requiredText(req.body?.name, "Conta", 80),
    ownerName: optionalText(req.body?.ownerName, req.user.name, 80),
    balance: moneyValue(req.body?.balance ?? 0, { label: "Saldo" }),
  });
  res.status(201).json({ account });
}));

app.put("/api/spaces/:spaceId/accounts/:accountId", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const account = await Account.findOneAndUpdate(
    { _id: req.params.accountId, spaceId: req.params.spaceId },
    {
      name: requiredText(req.body?.name, "Conta", 80),
      ownerName: optionalText(req.body?.ownerName, req.user.name, 80),
      balance: moneyValue(req.body?.balance ?? 0, { label: "Saldo" }),
    },
    { new: true, runValidators: true }
  );
  if (!account) return res.status(404).json({ message: "Conta não encontrada." });
  res.json({ account });
}));

app.delete("/api/spaces/:spaceId/accounts/:accountId", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const account = await Account.findOneAndDelete({ _id: req.params.accountId, spaceId: req.params.spaceId });
  if (!account) return res.status(404).json({ message: "Conta não encontrada." });
  await Transaction.updateMany({ spaceId: req.params.spaceId, accountId: req.params.accountId }, { $set: { accountId: null } });
  res.json({ ok: true });
}));

app.get("/api/spaces/:spaceId/transactions", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  res.json({ transactions: await Transaction.find({ spaceId: req.params.spaceId }).sort({ date: -1, createdAt: -1 }) });
}));

app.post("/api/spaces/:spaceId/transactions", auth, async (req, res) => {
  try {
    if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
    const accountId = await normalizeAccountIdForSpace(req.body?.accountId, req.params.spaceId);
    const transaction = await Transaction.create({
      spaceId: req.params.spaceId,
      accountId,
      type: oneOf(req.body?.type, ["receita", "despesa", "divida", "meta"], "Tipo"),
      description: requiredText(req.body?.description, "Descrição", 160),
      amount: moneyValue(req.body?.amount, { min: 0.01 }),
      date: isoDate(req.body?.date),
      status: oneOf(req.body?.status || "pendente", ["pendente", "pago"], "Status"),
      category: optionalText(req.body?.category, "Outro", 50),
      createdBy: req.user._id,
      responsibleName: optionalText(req.body?.responsibleName, req.user.name, 80),
    });
    res.status(201).json({ transaction });
  } catch (error) {
    const invalidInput = error.status === 400 || error.name === "ValidationError";
    res.status(invalidInput ? 400 : 500).json({ message: invalidInput ? error.message : "Erro ao criar lançamento." });
  }
});

app.put("/api/spaces/:spaceId/transactions/:transactionId", auth, async (req, res) => {
  try {
    if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
    const accountId = await normalizeAccountIdForSpace(req.body?.accountId, req.params.spaceId);
    const transaction = await Transaction.findOneAndUpdate(
      { _id: req.params.transactionId, spaceId: req.params.spaceId },
      {
        accountId,
        type: oneOf(req.body?.type, ["receita", "despesa", "divida", "meta"], "Tipo"),
        description: requiredText(req.body?.description, "Descrição", 160),
        amount: moneyValue(req.body?.amount, { min: 0.01 }),
        date: isoDate(req.body?.date),
        status: oneOf(req.body?.status || "pendente", ["pendente", "pago"], "Status"),
        category: optionalText(req.body?.category, "Outro", 50),
        responsibleName: optionalText(req.body?.responsibleName, req.user.name, 80),
      },
      { new: true, runValidators: true }
    );
    if (!transaction) return res.status(404).json({ message: "Lançamento não encontrado." });
    res.json({ transaction });
  } catch (error) {
    const invalidInput = error.status === 400 || error.name === "ValidationError";
    res.status(invalidInput ? 400 : 500).json({ message: invalidInput ? error.message : "Erro ao atualizar lançamento." });
  }
});

app.delete("/api/spaces/:spaceId/transactions/:transactionId", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const transaction = await Transaction.findOneAndDelete({ _id: req.params.transactionId, spaceId: req.params.spaceId });
  if (!transaction) return res.status(404).json({ message: "Lançamento não encontrado." });
  res.json({ ok: true });
}));

app.delete("/api/spaces/:spaceId/reset", auth, asyncHandler(async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const space = await Space.findById(req.params.spaceId);
  await Transaction.deleteMany({ spaceId: req.params.spaceId });
  await Account.deleteMany({ spaceId: req.params.spaceId });
  if (space?.type === "couple") {
    await Account.create({ spaceId: req.params.spaceId, name: "Conta conjunta", ownerName: "Casal", balance: 0 });
  } else {
    await Account.create({ spaceId: req.params.spaceId, name: "Conta principal", ownerName: req.user.name, balance: 0 });
    await Account.create({ spaceId: req.params.spaceId, name: "Dinheiro", ownerName: req.user.name, balance: 0 });
  }
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
