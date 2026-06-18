import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || "trocar_em_producao";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);

const spaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ["individual", "couple"], required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
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
    name: { type: String, required: true, trim: true },
    ownerName: { type: String, default: "Individual" },
    balance: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const transactionSchema = new mongoose.Schema(
  {
    spaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Space", required: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account" },
    type: { type: String, enum: ["receita", "despesa", "divida", "meta"], required: true },
    description: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    date: { type: String, required: true },
    status: { type: String, enum: ["pendente", "pago"], default: "pendente" },
    category: { type: String, default: "Outro" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    responsibleName: { type: String, default: "Individual" },
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

function createToken(user) {
  return jwt.sign({ userId: user._id.toString(), email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Token não informado." });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select("-passwordHash");
    if (!user) return res.status(401).json({ message: "Usuário não encontrado." });
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
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: "Nome, e-mail e senha são obrigatórios." });
    if (String(password).length < 6) return res.status(400).json({ message: "A senha precisa ter pelo menos 6 caracteres." });
    const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (existing) return res.status(409).json({ message: "Este e-mail já está cadastrado." });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });
    await createIndividualSpaceForUser(user);
    res.status(201).json({ token: createToken(user), user: { id: user._id, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ message: "Erro ao criar cadastro.", error: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: String(email || "").toLowerCase().trim() });
    if (!user) return res.status(401).json({ message: "E-mail ou senha inválidos." });
    const valid = await bcrypt.compare(password || "", user.passwordHash);
    if (!valid) return res.status(401).json({ message: "E-mail ou senha inválidos." });
    res.json({ token: createToken(user), user: { id: user._id, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ message: "Erro ao fazer login.", error: error.message });
  }
});

app.get("/api/me", auth, async (req, res) => res.json({ user: req.user }));

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
    res.status(500).json({ message: "Erro ao apagar conta.", error: error.message });
  }
});

app.get("/api/spaces", auth, async (req, res) => {
  const memberships = await Member.find({ userId: req.user._id }).populate("spaceId");
  res.json({ spaces: await Promise.all(memberships.filter((item) => item.spaceId).map(serializeSpaceForUser)) });
});

app.post("/api/spaces/couple", auth, async (req, res) => {
  try {
    const partnerName = String(req.body.partnerName || "Parceira").trim();
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
    res.status(500).json({ message: "Erro ao criar espaço casal.", error: error.message });
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
    res.status(500).json({ message: "Erro ao consultar convite.", error: error.message });
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
    await Member.updateOne({ spaceId: invite.spaceId._id, userId: req.user._id }, { role: "member" }, { upsert: true });
    invite.usedAt = new Date();
    await invite.save();
    res.json({ space: invite.spaceId });
  } catch (error) {
    res.status(500).json({ message: "Erro ao aceitar convite.", error: error.message });
  }
});

app.get("/api/spaces/:spaceId/accounts", auth, async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  res.json({ accounts: await Account.find({ spaceId: req.params.spaceId }).sort({ createdAt: 1 }) });
});

app.post("/api/spaces/:spaceId/accounts", auth, async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const account = await Account.create({ spaceId: req.params.spaceId, name: req.body.name, ownerName: req.body.ownerName || req.user.name, balance: Number(req.body.balance || 0) });
  res.status(201).json({ account });
});

app.put("/api/spaces/:spaceId/accounts/:accountId", auth, async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const account = await Account.findOneAndUpdate(
    { _id: req.params.accountId, spaceId: req.params.spaceId },
    {
      name: req.body.name,
      ownerName: req.body.ownerName || req.user.name,
      balance: Number(req.body.balance || 0),
    },
    { new: true, runValidators: true }
  );
  if (!account) return res.status(404).json({ message: "Conta não encontrada." });
  res.json({ account });
});

app.delete("/api/spaces/:spaceId/accounts/:accountId", auth, async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const account = await Account.findOneAndDelete({ _id: req.params.accountId, spaceId: req.params.spaceId });
  if (!account) return res.status(404).json({ message: "Conta não encontrada." });
  await Transaction.updateMany({ spaceId: req.params.spaceId, accountId: req.params.accountId }, { $set: { accountId: null } });
  res.json({ ok: true });
});

app.get("/api/spaces/:spaceId/transactions", auth, async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  res.json({ transactions: await Transaction.find({ spaceId: req.params.spaceId }).sort({ date: -1, createdAt: -1 }) });
});

app.post("/api/spaces/:spaceId/transactions", auth, async (req, res) => {
  try {
    if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
    const accountId = await normalizeAccountIdForSpace(req.body.accountId, req.params.spaceId);
    const transaction = await Transaction.create({
      spaceId: req.params.spaceId,
      accountId,
      type: req.body.type,
      description: req.body.description,
      amount: Number(req.body.amount || 0),
      date: req.body.date,
      status: req.body.status || "pendente",
      category: req.body.category || "Outro",
      createdBy: req.user._id,
      responsibleName: req.body.responsibleName || req.user.name,
    });
    res.status(201).json({ transaction });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || "Erro ao criar lançamento." });
  }
});

app.put("/api/spaces/:spaceId/transactions/:transactionId", auth, async (req, res) => {
  try {
    if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
    const accountId = await normalizeAccountIdForSpace(req.body.accountId, req.params.spaceId);
    const transaction = await Transaction.findOneAndUpdate(
      { _id: req.params.transactionId, spaceId: req.params.spaceId },
      {
        accountId,
        type: req.body.type,
        description: req.body.description,
        amount: Number(req.body.amount || 0),
        date: req.body.date,
        status: req.body.status || "pendente",
        category: req.body.category || "Outro",
        responsibleName: req.body.responsibleName || req.user.name,
      },
      { new: true, runValidators: true }
    );
    if (!transaction) return res.status(404).json({ message: "Lançamento não encontrado." });
    res.json({ transaction });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || "Erro ao atualizar lançamento." });
  }
});

app.delete("/api/spaces/:spaceId/transactions/:transactionId", auth, async (req, res) => {
  if (!(await userCanAccessSpace(req.user._id, req.params.spaceId))) return res.status(403).json({ message: "Sem acesso ao espaço." });
  const transaction = await Transaction.findOneAndDelete({ _id: req.params.transactionId, spaceId: req.params.spaceId });
  if (!transaction) return res.status(404).json({ message: "Lançamento não encontrado." });
  res.json({ ok: true });
});

app.delete("/api/spaces/:spaceId/reset", auth, async (req, res) => {
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
});

app.use((_req, res) => res.status(404).json({ message: "Rota não encontrada." }));

async function start() {
  if (!MONGODB_URI) {
    console.error("MONGODB_URI não configurado.");
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
