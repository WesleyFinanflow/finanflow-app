import mongoose from "mongoose";
import { InputError } from "./validation.js";

export async function redeemCoupon(models, actor, code) {
  const { User, Coupon, CouponUsage, Subscription, AdminAudit, couponStatus } = models;
  return mongoose.connection.transaction(async (session) => {
    // All redemptions contend on the same document. A concurrent transaction
    // retries with a fresh snapshot before checking global/user/day limits.
    const coupon = await Coupon.findOneAndUpdate({ code }, { $inc: { redemptionVersion: 1 } }, { new: true, session });
    if (!coupon) throw new InputError("Cupom não encontrado.");
    const user = await User.findById(actor._id).session(session);
    if (!user) throw new InputError("Usuário não encontrado.");
    const status = couponStatus(coupon);
    if (status !== "ACTIVE") throw new InputError({ SCHEDULED: "Este cupom ainda não começou.", EXHAUSTED: "Este cupom está esgotado.", EXPIRED: "Este cupom expirou.", DISABLED: "Este cupom está desativado." }[status]);
    const admin = ["ADMIN", "SUPER_ADMIN"].includes(actor.role);
    if (coupon.allowedPlan !== "ALL" && coupon.allowedPlan !== (user.planCode || "FREE")) throw new InputError("Este cupom não está disponível para o seu plano.");
    if (coupon.allowedAudience === "ADMINS" && !admin || coupon.allowedAudience === "USERS" && admin) throw new InputError("Este cupom não está disponível para seu perfil.");
    if (coupon.newUsersOnly && Date.now() - new Date(user.createdAt).getTime() > 7 * 86400000) throw new InputError("Este cupom é exclusivo para novos usuários.");
    if (coupon.trialUsersOnly && user.trialStatus !== "ACTIVE") throw new InputError("Este cupom é exclusivo para usuários em teste.");
    if ((user.trialStatus === "EXPIRED" || user.accessStatus === "trial" && user.trialEndsAt <= new Date()) && !coupon.allowAfterTrialExpired) throw new InputError("Este cupom não pode ser usado após o teste expirar.");
    const prior = await CouponUsage.countDocuments({ couponId: coupon._id, userId: user._id, status: "SUCCESS" }).session(session);
    if (coupon.maxUsesPerUser > 0 && prior >= coupon.maxUsesPerUser) throw new InputError("Você já atingiu o limite de uso deste cupom.");
    // Daily limits use the application's time zone, independent of host zone.
    const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza" }).format(new Date());
    const today = new Date(`${localDay}T00:00:00-03:00`);
    if (coupon.dailyLimit > 0 && await CouponUsage.countDocuments({ couponId: coupon._id, status: "SUCCESS", usedAt: { $gte: today } }).session(session) >= coupon.dailyLimit) throw new InputError("O limite diário deste cupom foi atingido.");
    const days = Math.max(1, Math.round(coupon.benefitValue));
    let applied;
    if (coupon.benefitType === "EXTRA_TRIAL_DAYS") {
      const base = user.trialEndsAt && user.trialEndsAt > new Date() ? new Date(user.trialEndsAt) : new Date();
      base.setDate(base.getDate() + days);
      Object.assign(user, { trialEndsAt: base, trialStartedAt: user.trialStartedAt || new Date(), trialStatus: "ACTIVE", accessStatus: "trial" });
      applied = `${days} dias extras de teste`;
    } else if (["PLUS_DAYS", "PREMIUM_DAYS"].includes(coupon.benefitType)) {
      const planCode = coupon.benefitType === "PLUS_DAYS" ? "PLUS" : "PREMIUM";
      await Subscription.create([{ userId: user._id, planCode, startsAt: new Date(), endsAt: new Date(Date.now() + days * 86400000), status: "MANUAL", origin: "ADMIN" }], { session });
      user.planCode = planCode;
      user.accessStatus = "active";
      applied = `${planCode} por ${days} dias`;
    } else applied = coupon.benefitType === "PERCENT_DISCOUNT" ? `${coupon.benefitValue}% de desconto registrado` : `${Number(coupon.benefitValue).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} de desconto registrado`;
    await user.save({ session });
    coupon.usageCount += 1;
    const limit = Number(coupon.maxUses || coupon.usageLimit || 0);
    if (coupon.autoExpireAtLimit && limit > 0 && coupon.usageCount >= limit) { coupon.active = false; coupon.disabledAt = new Date(); }
    await coupon.save({ session });
    const [usage] = await CouponUsage.create([{ couponId: coupon._id, code, userId: user._id, userName: user.name, userEmail: user.email, benefitType: coupon.benefitType, benefitValue: coupon.benefitValue, benefitApplied: applied, status: "SUCCESS" }], { session });
    await AdminAudit.create([{ adminId: user._id, adminName: user.name, targetUserId: user._id, targetName: user.name, action: "coupon_redeemed", details: { couponId: coupon._id, code, benefitApplied: applied } }], { session });
    return { message: "Cupom aplicado com sucesso.", benefitApplied: applied, usage };
  }, { readPreference: "primary" });
}
