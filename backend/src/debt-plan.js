import mongoose from "mongoose";
import crypto from "node:crypto";
import { InputError, isoDate, oneOf, optionalText, requiredText } from "./validation.js";
import { STRATEGIES, buildPlan, capacity, effectiveDebts, sourceDebts } from "./debt-engine.js";
import { DEBT_TYPES, DEBT_STATUSES, PRIORITY_WEIGHTS, TRI_STATE } from "./debt-config.js";

const situationFields = {
  debtType: { type: String, enum: Object.keys(DEBT_TYPES), default: "OTHER" },
  originalDueDate: String, firstOverdueDate: String, oldDebtReferenceDate: String, amountOverdue: Number,
  negativeListingActive: { type: String, enum: TRI_STATE, default: "UNKNOWN" }, negativeListingDate: String, negativeListingEndDate: String,
  negativeListingSource: { type: String, enum: ["SERASA", "SPC", "BOA_VISTA", "OTHER", "UNSPECIFIED"], default: "UNSPECIFIED" },
  collectionActive: { type: String, enum: TRI_STATE, default: "UNKNOWN" },
  activeDebtRegistered: { type: String, enum: TRI_STATE, default: "UNKNOWN" },
  activeDebtLevel: { type: String, enum: ["MUNICIPAL", "STATE", "FEDERAL", "OTHER"], default: "OTHER" },
  creditorAgency: String, registrationNumber: String, processNumber: String, activeDebtRegistrationDate: String, originTax: String,
  hasInstallmentAgreement: { type: String, enum: TRI_STATE, default: "UNKNOWN" },
  protestActive: { type: String, enum: TRI_STATE, default: "UNKNOWN" }, protestDate: String,
  notaryName: String, notaryCity: String, notaryState: String, titleNumber: String, protocolNumber: String, protestedAmount: Number,
};
const situationSnapshotSchema = new mongoose.Schema({ ...situationFields, status: String }, { _id: false });

const integerMoney = { type: Number, min: 0, max: 100000000000000, validate: Number.isSafeInteger, required: true };
const negotiationSchema = new mongoose.Schema({
  previousBalance: integerMoney, negotiatedBalance: integerMoney,
  previousInstallment: integerMoney, newInstallment: integerMoney,
  previousInterestRate: Number, newInterestRate: Number, discountAmount: integerMoney,
  previousDueDate: String, newDueDate: String, previousInstallments: Number, newInstallments: Number,
  negotiatedAt: String, notes: String, createdBy: mongoose.Schema.Types.ObjectId,
  previousSituation: situationSnapshotSchema, newSituation: situationSnapshotSchema,
}, { timestamps: true });
const itemSchema = new mongoose.Schema({
  ...situationFields,
  id: { type: String, required: true }, sourceKey: String, balanceOverride: Boolean,
  name: { type: String, required: true, maxlength: 160 }, description: { type: String, maxlength: 300 },
  originalBalance: integerMoney, currentBalance: integerMoney, minimumPayment: integerMoney,
  interestRateMonthly: { type: Number, default: null }, interestRateAnnual: { type: Number, default: null },
  dueDate: String, totalInstallments: Number, remainingInstallments: Number,
  status: { type: String, enum: Object.keys(DEBT_STATUSES) },
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, required: true }, shared: { type: Boolean, default: false },
  creditor: String, category: String, startDate: String, expectedEndDate: String, notes: String,
  paidAt: Date, negotiations: [negotiationSchema],
}, { _id: false });
const planSchema = new mongoose.Schema({
  spaceId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  strategy: { type: String, enum: STRATEGIES, default: "recommended" },
  monthlyExtraAmount: { ...integerMoney, required: false, default: null, validate: value => value == null || Number.isSafeInteger(value) },
  monthlyPaymentAmount: { ...integerMoney, required: false, default: null, validate: value => value == null || Number.isSafeInteger(value) },
  generatedAt: Date,
  items: [itemSchema],
}, { timestamps: true, optimisticConcurrency: true });
export const DebtPlan = mongoose.models.DebtPlan || mongoose.model("DebtPlan", planSchema);

export function moneyInput(value, label) {
  const raw = String(value ?? "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new InputError(`${label}: use um valor positivo com até duas casas decimais.`);
  const [whole, fraction = ""] = raw.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 100000000000000) throw new InputError(`${label} fora do limite.`);
  return result;
}
function rateInput(value) {
  if (value == null || value === "") return null;
  if (!/^\d+(\.\d{1,6})?$/.test(String(value)) || Number(value) > 1000) throw new InputError("Informe uma taxa entre 0 e 1000%, com até seis casas decimais.");
  return Number(value);
}
function countInput(value) {
  if (value == null || value === "") return null;
  if (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 1200) throw new InputError("Quantidade de parcelas inválida.");
  return Number(value);
}
export function validateSituation(body, existing = {}) {
  const input = { ...existing, ...body };
  const result = {
    debtType: oneOf(input.debtType || "OTHER", Object.keys(DEBT_TYPES), "Tipo da dívida"),
    negativeListingSource: oneOf(input.negativeListingSource || "UNSPECIFIED", ["SERASA", "SPC", "BOA_VISTA", "OTHER", "UNSPECIFIED"], "Origem da negativação"),
    activeDebtLevel: oneOf(input.activeDebtLevel || "OTHER", ["MUNICIPAL", "STATE", "FEDERAL", "OTHER"], "Esfera"),
  };
  for (const field of ["negativeListingActive", "protestActive", "activeDebtRegistered", "collectionActive", "hasInstallmentAgreement"]) result[field] = oneOf(input[field] || "UNKNOWN", TRI_STATE, field);
  for (const field of ["originalDueDate", "firstOverdueDate", "oldDebtReferenceDate", "negativeListingDate", "negativeListingEndDate", "activeDebtRegistrationDate", "protestDate"]) result[field] = input[field] ? isoDate(input[field]) : null;
  for (const field of ["creditorAgency", "registrationNumber", "processNumber", "originTax", "notaryName", "notaryCity", "titleNumber", "protocolNumber"]) result[field] = optionalText(input[field], "", 160);
  result.notaryState = optionalText(input.notaryState, "", 2).toUpperCase();
  if (result.notaryState && !/^[A-Z]{2}$/.test(result.notaryState)) throw new InputError("Informe a UF com duas letras.");
  // Existing values are already cents. Only submitted decimal fields are parsed.
  for (const field of ["amountOverdue", "protestedAmount"]) result[field] = Object.hasOwn(body, field) ? body[field] === "" || body[field] == null ? null : moneyInput(body[field], field) : existing[field] ?? null;
  if (result.negativeListingDate && result.negativeListingEndDate && result.negativeListingEndDate < result.negativeListingDate) throw new InputError("Fim da negativação anterior ao início.");
  if (input.status === "NEGATIVE_LISTED" && result.negativeListingActive === "NO") throw new InputError("Situação negativada é incompatível com negativação ativa = não.");
  if (input.status === "PROTESTED" && result.protestActive === "NO") throw new InputError("Situação protestada é incompatível com protesto cancelado.");
  if (input.status === "ACTIVE_DEBT" && result.activeDebtRegistered === "NO") throw new InputError("Situação inscrita em dívida ativa é incompatível com inscrição = não.");
  return result;
}
export function validateDebt(body) {
  const currentBalance = moneyInput(body.currentBalance, "Saldo devedor");
  const originalBalance = moneyInput(body.originalBalance, "Valor original");
  const status = oneOf(body.status || "ACTIVE", Object.keys(DEBT_STATUSES), "Situação");
  if (status === "PAID" && currentBalance !== 0) throw new InputError("Dívida quitada deve ter saldo zero.");
  const totalInstallments = countInput(body.totalInstallments), remainingInstallments = countInput(body.remainingInstallments);
  if (totalInstallments != null && remainingInstallments > totalInstallments) throw new InputError("Parcelas restantes superam o total.");
  if (typeof body.shared !== "boolean") throw new InputError("Compartilhamento inválido.");
  return { ...validateSituation(body), name: requiredText(body.name, "Nome", 160), description: optionalText(body.description, "", 300),
    originalBalance, currentBalance, minimumPayment: moneyInput(body.minimumPayment, "Parcela"),
    interestRateMonthly: rateInput(body.interestRateMonthly), interestRateAnnual: rateInput(body.interestRateAnnual),
    dueDate: isoDate(body.dueDate), totalInstallments, remainingInstallments,
    status: currentBalance === 0 ? "PAID" : status, shared: body.shared,
    creditor: optionalText(body.creditor, "", 160), category: optionalText(body.category, "Outras dívidas", 50),
    startDate: body.startDate ? isoDate(body.startDate) : null, expectedEndDate: body.expectedEndDate ? isoDate(body.expectedEndDate) : null,
    notes: optionalText(body.notes, "", 1000) };
}
export function negotiateDebt(debt, body, userId) {
  const negotiatedBalance = moneyInput(body.currentBalance, "Novo saldo"), newInstallment = moneyInput(body.minimumPayment, "Nova parcela");
  const newInterestRate = rateInput(body.interestRateMonthly), newDueDate = isoDate(body.dueDate), newInstallments = countInput(body.remainingInstallments);
  const status = negotiatedBalance === 0 ? "PAID" : oneOf(body.status || "NEGOTIATED", Object.keys(DEBT_STATUSES).filter(s => s !== "PAID"), "Situação");
  const situation = validateSituation({ ...body, status }, debt);
  const previousSituation = Object.fromEntries([...Object.keys(situationFields), "status"].map(k => [k, debt[k]]));
  const negotiation = { previousBalance: debt.currentBalance, negotiatedBalance,
    previousInstallment: debt.minimumPayment, newInstallment, previousInterestRate: debt.interestRateMonthly,
    newInterestRate, discountAmount: Math.max(0, debt.currentBalance - negotiatedBalance),
    previousDueDate: debt.dueDate, newDueDate, previousInstallments: debt.remainingInstallments, newInstallments,
    negotiatedAt: isoDate(body.negotiatedAt), notes: optionalText(body.notes, "", 1000), createdBy: userId,
    previousSituation, newSituation: { ...situation, status } };
  return { ...debt, ...situation, originalDueDate: debt.originalDueDate || debt.dueDate, currentBalance: negotiatedBalance, minimumPayment: newInstallment, interestRateMonthly: newInterestRate,
    interestRateAnnual: null, dueDate: newDueDate, remainingInstallments: newInstallments,
    status, balanceOverride: true,
    negotiations: [...(debt.negotiations || []), negotiation] };
}
// Scope is deliberately exact. Never use spaceViewIds/userWriteSpaceId here:
// those legacy helpers aggregate private individual data in the couple view.
export async function authorizeDebtSpace({ Space, Member }, userId, spaceId) {
  if (!mongoose.isValidObjectId(spaceId)) throw new InputError("Espaço inválido.");
  const membership = await Member.findOne({ userId, spaceId });
  if (!membership) return null;
  const space = await Space.findById(spaceId).lean();
  if (!space || (space.type === "individual" && String(space.ownerId) !== String(userId))) return null;
  return space;
}
export function registerDebtPlanRoutes(app, deps) {
  const { auth, Space, Member, Account, Transaction } = deps;
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(error => {
    if (error.name === "VersionError" || error.code === 11000) return res.status(409).json({ message: "O plano mudou em outra sessão. Recarregue e tente novamente." });
    next(error);
  });
  const base = "/api/spaces/:spaceId";
  const scope = async (req, res) => {
    const space = await authorizeDebtSpace({ Space, Member }, req.user._id, req.params.spaceId);
    if (!space) { res.status(403).json({ message: "Sem acesso a este espaço." }); return null; }
    return space;
  };
  const context = async (req, space) => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });
    const [plan, transactions, accounts, members] = await Promise.all([
      DebtPlan.findOne({ spaceId: space._id }), Transaction.find({ spaceId: space._id }).lean(),
      Account.find({ spaceId: space._id }).lean(), Member.find({ spaceId: space._id }).populate("userId", "name").lean(),
    ]);
    const sources = sourceDebts(transactions, today);
    const items = (plan?.toObject().items || []).map(d => ({ ...d, ownerUserId: String(d.ownerUserId) }));
    const debts = effectiveDebts(items, sources);
    // Couple reserve is locally configured only. Individual reserves and balances
    // are never fetched here; a shared budget must be explicitly recorded here.
    const financialCapacity = capacity(accounts, transactions, space.reserve, debts, today);
    return { plan, debts, today, financialCapacity, members: members.filter(m => m.userId).map(m => ({ id: String(m.userId._id), name: m.userId.name })) };
  };
  const payload = (ctx, space) => ({ ...buildPlan(ctx.debts, ctx.plan || {}, ctx.financialCapacity, ctx.today),
    revision: ctx.plan?.__v ?? 0, spaceId: String(space._id), spaceType: space.type, members: ctx.members,
    catalog: { types: DEBT_TYPES, statuses: DEBT_STATUSES, weights: PRIORITY_WEIGHTS } });
  for (const path of ["/debt-plan", "/debt-plan/simulation"]) app.get(base + path, auth, wrap(async (req, res) => {
    const space = await scope(req, res); if (!space) return;
    res.json(payload(await context(req, space), space));
  }));
  const edit = async (req, res, action) => {
    const space = await scope(req, res); if (!space) return;
    const ctx = await context(req, space);
    if (!Number.isInteger(req.body.revision) || req.body.revision !== (ctx.plan?.__v ?? 0)) return res.status(409).json({ message: "O plano mudou. Recarregue antes de salvar." });
    const plan = ctx.plan || new DebtPlan({ spaceId: space._id, userId: req.user._id, items: [] });
    await action(plan, ctx, space);
    await plan.save();
    res.json(payload(await context(req, space), space));
  };
  for (const method of ["post", "put"]) app[method](base + "/debt-plan", auth, wrap((req, res) => edit(req, res, (plan, ctx) => {
    plan.strategy = oneOf(req.body.strategy, STRATEGIES, "Estratégia");
    if (Object.hasOwn(req.body, "monthlyPaymentAmount")) {
      plan.monthlyPaymentAmount = req.body.monthlyPaymentAmount == null ? null : moneyInput(req.body.monthlyPaymentAmount, "Valor que posso pagar");
      plan.monthlyExtraAmount = null;
    } else if (Object.hasOwn(req.body, "monthlyExtraAmount")) {
      const extra = req.body.monthlyExtraAmount == null ? null : moneyInput(req.body.monthlyExtraAmount, "Valor extra");
      if (extra != null && extra > ctx.financialCapacity.recommended) throw new InputError("Esse valor excede a capacidade protegida disponível neste mês.");
      plan.monthlyExtraAmount = extra;
    }
    if (req.body.generate === true) plan.generatedAt = new Date();
  })));
  app.post(base + "/debt-plan/recalculate", auth, wrap(async (req, res) => {
    const space = await scope(req, res); if (!space) return;
    res.json(payload(await context(req, space), space));
  }));
  app.post(base + "/debts", auth, wrap((req, res) => edit(req, res, async (plan, ctx, space) => {
    if (ctx.debts.length >= 200) throw new InputError("Limite de 200 dívidas por plano.");
    const debt = validateDebt(req.body);
    const ownerUserId = req.body.ownerUserId || String(req.user._id);
    if (!ctx.members.some(m => m.id === ownerUserId)) throw new InputError("Responsável não pertence ao espaço.");
    if (space.type === "individual" && (debt.shared || ownerUserId !== String(req.user._id))) throw new InputError("Responsável inválido no espaço individual.");
    plan.items.push({ ...debt, id: crypto.randomUUID(), ownerUserId });
  })));
  for (const action of ["negotiate", "mark-paid", "update"]) app.post(base + `/debts/:debtId/${action}`, auth, wrap((req, res) => edit(req, res, (plan, ctx, space) => {
    const debt = ctx.debts.find(d => d.id === req.params.debtId);
    if (!debt) { throw new InputError("Dívida não encontrada neste espaço."); }
    if (!debt.shared && String(debt.ownerUserId) !== String(req.user._id)) throw new InputError("Somente o responsável pode alterar esta dívida.");
    let updated;
    if (action === "negotiate") {
      if (debt.currentBalance === 0) throw new InputError("Esta dívida já está quitada.");
      updated = negotiateDebt(debt, req.body, req.user._id);
    } else if (action === "mark-paid") updated = { ...debt, currentBalance: 0, status: "PAID", paidAt: new Date(), balanceOverride: true };
    else {
      const input = validateDebt(req.body);
      if (space.type === "individual" && input.shared) throw new InputError("Dívida individual não pode ser compartilhada neste espaço.");
      if (debt.sourceKey && !debt.balanceOverride && ["originalBalance", "currentBalance", "minimumPayment"].some(k => input[k] !== debt[k])) throw new InputError("Atualize os valores no lançamento original ou registre uma negociação.");
      updated = { ...debt, ...input };
    }
    const index = plan.items.findIndex(d => d.id === debt.id);
    if (index < 0) plan.items.push(updated); else plan.items.set(index, updated);
  })));
}
