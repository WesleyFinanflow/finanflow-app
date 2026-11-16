import crypto from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { base32, verifyTotp, seal, unseal, recoveryHash, recoveryCodes } from "./mfa-crypto.js";
export const MfaCredential = mongoose.model("MfaCredential", new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, unique: true }, secret: String,
  enabled: { type: Boolean, default: false }, pendingSession: String, pendingUntil: Date, pendingSecret: String,
  lastStep: { type: Number, default: -1 }, recoveryHashes: [String],
  attempts: { type: Number, default: 0 }, attemptsResetAt: Date,
}, { timestamps: true }));
export function registerMfaRoutes(app, { User, Session, auth, adminOnly, authLimiter, setSession, publicUser, JWT_SECRET }) {
  const route = handler => async (req, res, next) => { try { res.set("Cache-Control", "no-store"); await handler(req, res); } catch (e) { next(e); } };
  async function consumeAttempt(userId) {
    const now = new Date();
    await MfaCredential.updateOne({ userId, $or: [{ attemptsResetAt: { $lte: now } }, { attemptsResetAt: null }] }, { $set: { attempts: 0, attemptsResetAt: new Date(Date.now() + 900000) } });
    return MfaCredential.findOneAndUpdate({ userId, attempts: { $lt: 5 } }, { $inc: { attempts: 1 } }, { new: true });
  }
  app.get("/api/auth/mfa/status", auth, route(async (req, res) => {
    const credential = await MfaCredential.findOne({ userId: req.user._id }).select("recoveryHashes").lean();
    res.json({ enabled: Boolean(req.user.mfaEnabled), verified: Boolean(req.authSession.mfaVerified), recoveryRemaining: credential?.recoveryHashes?.length || 0, hasPassword: Boolean((await User.findById(req.user._id).select("passwordHash")).passwordHash) });
  }));
  app.post("/api/auth/mfa/setup", authLimiter, auth, adminOnly, route(async (req, res) => {
    if (req.user.mfaEnabled && (!req.authSession.mfaVerified || Date.now() - req.authSession.createdAt.getTime() > 300000)) return res.status(403).json({ message: "Confirme novamente o segundo fator antes de trocar o autenticador." });
    const user = await User.findById(req.user._id).select("passwordHash");
    if (user.passwordHash) {
      if (typeof req.body?.password !== "string" || !await bcrypt.compare(req.body.password, user.passwordHash)) return res.status(400).json({ message: "Confirme sua senha atual para configurar." });
    } else if (Date.now() - req.authSession.createdAt.getTime() > 300000) return res.status(403).json({ message: "Entre novamente com Google e configure em até cinco minutos." });
    const secret = base32(crypto.randomBytes(20));
    const credential = await MfaCredential.findOneAndUpdate({ userId: user._id }, { $set: { pendingSecret: seal(secret, JWT_SECRET), pendingSession: req.authSession.tokenHash, pendingUntil: new Date(Date.now() + 600000) }, $setOnInsert: { userId: user._id } }, { upsert: true, new: true });
    res.json({ secret, uri: `otpauth://totp/${encodeURIComponent("FinanFlow:" + user.email)}?secret=${secret}&issuer=FinanFlow&algorithm=SHA1&digits=6&period=30`, expiresAt: credential.pendingUntil });
  }));
  app.post("/api/auth/mfa/confirm", authLimiter, auth, adminOnly, route(async (req, res) => {
    if (req.user.mfaEnabled && !req.authSession.mfaVerified) return res.status(403).json({ message: "Confirme o segundo fator antes de trocar o autenticador." });
    if (!await MfaCredential.exists({ userId: req.user._id, pendingSession: req.authSession.tokenHash, pendingUntil: { $gt: new Date() } })) return res.status(400).json({ message: "Configuração expirada. Comece novamente." });
    const credential = await consumeAttempt(req.user._id);
    if (!credential) return res.status(429).json({ message: "Muitas tentativas. Aguarde 15 minutos." });
    if (credential.pendingSession !== req.authSession.tokenHash || !(credential.pendingUntil > new Date())) return res.status(400).json({ message: "Configuração expirada. Comece novamente." });
    const step = verifyTotp(unseal(credential.pendingSecret, JWT_SECRET), req.body?.code);
    if (step === null) return res.status(400).json({ message: "Código inválido. Confira o horário do celular e tente novamente." });
    const codes = recoveryCodes();
    let nextVersion;
    await mongoose.connection.transaction(async session => {
      const changed = await MfaCredential.updateOne({ _id: credential._id, pendingSecret: credential.pendingSecret, pendingSession: req.authSession.tokenHash, pendingUntil: { $gt: new Date() } }, { $set: { enabled: true, secret: credential.pendingSecret, lastStep: step, recoveryHashes: codes.map(recoveryHash), attempts: 0 }, $unset: { pendingSecret: 1, pendingSession: 1, pendingUntil: 1 } }, { session });
      if (changed.modifiedCount !== 1) throw new Error("Configuração alterada. Tente novamente.");
      const updated = await User.findOneAndUpdate({ _id: req.user._id, $or: [{ mfaVersion: Number(req.user.mfaVersion || 0) }, { mfaVersion: { $exists: false } }] }, { $set: { mfaEnabled: true }, $inc: { mfaVersion: 1 } }, { session, new: true });
      if (!updated) throw new Error("A proteção da conta mudou. Entre novamente.");
      nextVersion = updated.mfaVersion;
      await Session.deleteMany({ userId: req.user._id }, { session });
    });
    req.user.mfaVersion = nextVersion;
    req.user.mfaEnabled = true;
    await setSession(res, req.user, true);
    res.json({ user: publicUser(req.user, true), recoveryCodes: codes });
  }));
  app.post("/api/auth/mfa/verify", authLimiter, auth, route(async (req, res) => {
    if (!req.user.mfaEnabled) return res.status(400).json({ message: "O segundo fator não está configurado." });
    if (Date.now() - req.authSession.createdAt.getTime() > 300000 && !req.authSession.mfaVerified) return res.status(401).json({ message: "Confirmação expirada. Entre novamente." });
    const credential = await consumeAttempt(req.user._id);
    if (!credential) return res.status(429).json({ message: "Muitas tentativas. Aguarde 15 minutos." });
    let changed;
    if (typeof req.body?.recoveryCode === "string" && /^[A-Fa-f0-9-]{20,23}$/.test(req.body.recoveryCode)) {
      changed = await MfaCredential.updateOne({ _id: credential._id, enabled: true, recoveryHashes: recoveryHash(req.body.recoveryCode) }, { $pull: { recoveryHashes: recoveryHash(req.body.recoveryCode) }, $set: { attempts: 0 } });
    } else {
      const step = verifyTotp(unseal(credential.secret, JWT_SECRET), req.body?.code, credential.lastStep);
      if (step !== null) changed = await MfaCredential.updateOne({ _id: credential._id, enabled: true, secret: credential.secret, lastStep: credential.lastStep }, { $set: { lastStep: step, attempts: 0 } });
    }
    if (!changed?.modifiedCount) return res.status(400).json({ message: "Código inválido ou já utilizado." });
    await Session.deleteOne({ _id: req.authSession._id });
    await setSession(res, req.user, true);
    res.json({ user: publicUser(req.user, true) });
  }));
}
