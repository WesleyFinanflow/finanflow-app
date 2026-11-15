import { InputError, oneOf, isoDate } from "./validation.js";

export function extendTrial(user, { days, endsAt, planCode }, now = new Date()) {
  const extra = days === undefined ? 7 : Number(days);
  if (!Number.isInteger(extra) || extra < 1 || extra > 365) throw new InputError("Escolha de 1 a 365 dias.");
  const end = endsAt ? new Date(`${isoDate(String(endsAt).slice(0, 10), "Fim do teste")}T23:59:59.999-03:00`) : new Date(Math.max(+now, +new Date(user.trialEndsAt || 0)) + extra * 86400000);
  if (!Number.isFinite(+end) || end <= now) throw new InputError("Escolha uma data futura para o teste.");
  Object.assign(user, { trialStartedAt: user.trialStartedAt || now, trialEndsAt: end, trialStatus: "ACTIVE", accessStatus: "trial", accessOrigin: "TRIAL", planCode: oneOf(planCode || "PREMIUM", ["FREE", "PLUS", "PREMIUM"], "Plano") });
}

export function grantManualPlan(user, planCode) {
  Object.assign(user, { planCode: oneOf(planCode, ["FREE", "PLUS", "PREMIUM"], "Plano"), accessStatus: "active", accessOrigin: "COURTESY", trialStatus: "CONVERTED", trialEndsAt: undefined, blockedAt: undefined });
}

export async function reconcileSubscription(user, Subscription) {
  // Legacy manual plans have no subscription origin and remain untouched.
  if (user.accessOrigin !== "SUBSCRIPTION") return;
  const now = new Date();
  const valid = await Subscription.findOne({ userId: user._id, status: { $in: ["ACTIVE", "MANUAL"] }, startsAt: { $lte: now }, $or: [{ endsAt: null }, { endsAt: { $gt: now } }] }).sort({ createdAt: -1 }).lean();
  const plan = valid?.planCode || "FREE";
  if (user.planCode !== plan || !valid) {
    user.planCode = plan;
    if (!valid) user.accessOrigin = "FREE";
    await user.save();
  }
}

export function subscriptionPayload(body, current = {}, now = new Date()) {
  const planCode = oneOf(body.planCode || current.planCode, ["FREE", "PLUS", "PREMIUM"], "Plano");
  const status = oneOf(body.status || current.status || "MANUAL", ["ACTIVE", "MANUAL", "EXPIRED", "CANCELLED"], "Status");
  const startsAt = new Date(body.startsAt || current.startsAt || now);
  const endsAt = body.endsAt === null ? null : body.endsAt || current.endsAt ? new Date(body.endsAt || current.endsAt) : null;
  if (!Number.isFinite(+startsAt) || endsAt && (!Number.isFinite(+endsAt) || endsAt <= startsAt || ["ACTIVE","MANUAL"].includes(status) && endsAt <= now)) throw new InputError("A validade da assinatura deve terminar no futuro e após seu início.");
  return { userId: body.userId || current.userId, planCode, startsAt, endsAt, status, origin: "ADMIN" };
}
