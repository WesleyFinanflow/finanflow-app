import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan, capacity, effectiveDebts, orderDebts, overdueDays, priorityScore, simulate, sourceDebts } from "./debt-engine.js";
import { moneyInput, negotiateDebt, validateDebt } from "./debt-plan.js";
const today = "2026-09-13";
const debt = (id, values = {}) => ({ id, name: id, originalBalance: 100000, currentBalance: 100000, minimumPayment: 10000, interestRateMonthly: 0, status: "ACTIVE", dueDate: "2026-09-20", shared: false, ...values });
test("avalanche prioritizes known interest, then balance; unknown is not zero", () => {
  assert.deepEqual(orderDebts([debt("unknown", { interestRateMonthly: null }), debt("zero"), debt("high", { interestRateMonthly: 12.5 })], "avalanche", today).map(d => d.id), ["high", "zero", "unknown"]);
});
test("snowball chooses the smaller balance with stable ties", () => {
  assert.deepEqual(orderDebts([debt("b"), debt("a"), debt("small", { currentBalance: 1 })], "snowball", today).map(d => d.id), ["small", "a", "b"]);
});
test("recommended uses overdue risk and known interest deterministically", () => {
  const late = debt("late", { dueDate: "2026-06-01" });
  assert.equal(orderDebts([debt("normal"), late], "recommended", today)[0].id, "late");
  assert.equal(priorityScore(late, today), 8);
  assert.equal(overdueDays(late, today), 104);
  assert.equal(overdueDays(debt("paid", { currentBalance: 0, dueDate: "2020-01-01" }), today), 0);
});
test("rollover transfers unused extra in same month and installments in following months", () => {
  const result = simulate([debt("a"), debt("b", { currentBalance: 200000, originalBalance: 200000 })], 50000, "snowball", today);
  assert.equal(result.months[0].rows[0].closingBalance, 40000);
  assert.equal(result.months[1].rows[0].closingBalance, 0);
  assert.equal(result.months[1].rows[1].extra, 20000);
  assert.equal(result.months[2].rows[0].normal + result.months[2].rows[0].extra, 70000);
  assert.equal(result.monthsRemaining, 5);
  assert.equal(result.months.at(-1).unused, 50000);
});
test("cent rounding on interest and payment conservation", () => {
  const result = simulate([debt("cents", { currentBalance: 10001, minimumPayment: 5000, interestRateMonthly: 1.005 })], 0, "avalanche", today);
  assert.equal(result.months[0].rows[0].interest, 101);
  for (const month of result.months) for (const row of month.rows) assert.equal(row.openingBalance + row.interest, row.normal + row.extra + row.closingBalance);
  assert.equal(result.complete, true);
});
test("unknown rates allow provisional principal projection but never interest savings", () => {
  const result = buildPlan([debt("a", { interestRateMonthly: null })], {}, { recommended: 10000 }, today);
  assert.equal(result.simulation.complete, true);
  assert.equal(result.simulation.estimatedInterest, null);
  assert.equal(result.savings, null);
  assert.equal(result.simulation.months[0].rows[0].interest, null);
});
test("paid debts retained in history, excluded from simulation", () => {
  const result = buildPlan([debt("paid", { currentBalance: 0, status: "PAID" })], {}, { recommended: 0 }, today);
  assert.equal(result.status, "COMPLETED"); assert.equal(result.summary.progress, 100);
  assert.equal(result.debts.length, 1); assert.equal(result.simulation.months.length, 0);
});
test("negative amortization and zero payment stop without false payoff date", () => {
  for (const d of [debt("growing", { minimumPayment: 10, interestRateMonthly: 10 }), debt("zero", { minimumPayment: 0 })]) {
    const result = simulate([d], 0, "recommended", today);
    assert.equal(result.complete, false); assert.equal(result.endDate, null); assert.equal(result.reason, "insufficient_payment");
  }
});
test("600 month limit and balance overflow are explicit", () => {
  assert.equal(simulate([debt("slow", { minimumPayment: 1 })], 0, "snowball", today).reason, "horizon_limit");
  assert.equal(simulate([debt("huge", { currentBalance: 100000000000000, interestRateMonthly: 1000 })], 0, "snowball", today).reason, "balance_limit");
});
test("recalculation caps previously saved extra when protection changes", () => {
  const result = buildPlan([debt("a")], { monthlyExtraAmount: 50000 }, { recommended: 10000 }, today);
  assert.equal(result.extra, 10000); assert.equal(result.requestedExtra, 50000);
});
test("capacity excludes unreceived income and meal funds, protects reserve and commitments", () => {
  const transactions = [
    { type: "receita", amount: 2000, status: "pago", date: today },
    { type: "receita", amount: 90000, status: "pendente", date: today },
    { type: "receita", amount: 90000, status: "pago", date: today, fundingSource: "meal" },
    { type: "despesa", amount: 500, status: "pago", date: today },
    { type: "despesa", amount: 200, status: "pendente", date: today },
  ];
  const result = capacity([], transactions, 1000, [debt("manual")], today);
  assert.equal(result.recommended, 20000); assert.equal(result.safeFree, 20000);
  assert.equal(capacity([], transactions, 2000, [], today).recommended, 0);
});
test("capacity protects next month commitments and expired recurring expenses", () => {
  const transactions = [{ type: "receita", amount: 1000, status: "pago", date: today }, { type: "despesa", amount: 300, status: "pago", date: today, recurrence: "monthly", seriesId: "s" }];
  assert.equal(capacity([], transactions, 0, [], today).recommended, 40000);
  transactions.push({ type: "despesa", amount: 300, status: "pendente", date: "2026-10-20", recurrence: "monthly", seriesId: "s" });
  assert.equal(capacity([], transactions, 0, [], today).recommended, 40000);
});
test("no recurring extra inferred solely from historical cash balance", () => {
  assert.equal(capacity([{ balance: 100000 }], [], 300, [], today).recommended, 0);
});
test("legacy installment reuse stays live and does not mutate source transactions", () => {
  const rows = [{ _id: "1", seriesId: "s", type: "divida", description: "Loan", createdBy: "u", amount: 10.01, status: "pago", date: "2026-08-13" }, { _id: "2", seriesId: "s", type: "divida", description: "Loan", createdBy: "u", amount: 10.01, status: "pendente", date: today }];
  const before = JSON.stringify(rows), sources = sourceDebts(rows, today);
  assert.equal(sources.length, 1); assert.equal(sources[0].originalBalance, 2002); assert.equal(sources[0].currentBalance, 1001);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(effectiveDebts([{ ...sources[0], currentBalance: 9999 }], sources)[0].currentBalance, 1001);
  assert.equal(effectiveDebts([{ ...sources[0], currentBalance: 0, balanceOverride: true }], sources)[0].currentBalance, 0);
});
test("negotiation records previous terms and discounts without counting discount as cash paid", () => {
  const original = debt("a");
  const result = negotiateDebt(original, { currentBalance: "800", minimumPayment: "100", interestRateMonthly: "", dueDate: "2026-10-13", remainingInstallments: "8", negotiatedAt: today, notes: "Acordo" }, "u");
  assert.equal(original.currentBalance, 100000); assert.equal(result.currentBalance, 80000);
  assert.equal(result.negotiations[0].discountAmount, 20000); assert.equal(result.interestRateMonthly, null);
  assert.equal(result.status, "NEGOTIATED");
  const plan = buildPlan([result], {}, { recommended: 0 }, today);
  assert.equal(plan.summary.paid, 0); assert.equal(plan.summary.negotiatedDiscount, 20000); assert.equal(plan.summary.progress, 20);
});
test("known rates produce measurable interest savings with extra payments", () => {
  const result = buildPlan([debt("a", { interestRateMonthly: 2 })], {}, { recommended: 10000 }, today);
  assert.ok(result.savings > 0); assert.ok(result.simulation.estimatedInterest > 0);
});
test("money inputs reject non-finite values, scientific notation and fractions of cents", () => {
  assert.equal(moneyInput("0.01", "Valor"), 1); assert.equal(moneyInput("123.45", "Valor"), 12345);
  for (const input of [null, "NaN", "Infinity", -1, "1e3", "1.001", "", true, {}, "1000000000001"]) assert.throws(() => moneyInput(input, "Valor"));
});
test("input validates status, dates, rates and installment bounds", () => {
  const body = { name: "A", originalBalance: "100", currentBalance: "100", minimumPayment: "10", dueDate: today, shared: false };
  assert.equal(validateDebt(body).interestRateMonthly, null);
  for (const change of [{ dueDate: "2026-02-30" }, { status: "PAID" }, { interestRateMonthly: -2 }, { totalInstallments: 1, remainingInstallments: 2 }, { shared: "false" }]) assert.throws(() => validateDebt({ ...body, ...change }));
});
