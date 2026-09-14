// All monetary operations use integer cents. Rates use millionths of a percent.
// This module never writes transactions, accounts or the protected reserve.
export const STRATEGIES = ["recommended", "avalanche", "snowball"];
export const cents = (value) => Math.round(Number(value || 0) * 100);
export const sum = (values) => values.reduce((a, b) => a + b, 0);
export const monthAt = (date, offset) => {
  const [y, m] = date.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 7);
};
export function overdueDays(debt, today) {
  return debt.currentBalance > 0 && debt.dueDate < today
    ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(debt.dueDate)) / 86400000)) : 0;
}
export function priorityScore(debt, today) {
  // 0..100: arrears 40 (20 + up to 20 at 90 days), known interest 30
  // (saturates at 15% monthly), installment/balance 20, small balance 10.
  // Arrears are the observable proxy for exposure to late fees; no fee is invented.
  const days = overdueDays(debt, today);
  return Math.round((days ? 20 + Math.min(days / 90, 1) * 20 : 0)
    + Math.min((debt.interestRateMonthly ?? 0) / 15, 1) * 30
    + Math.min(debt.minimumPayment / Math.max(1, debt.currentBalance), 1) * 20
    + 10 / (1 + debt.currentBalance / 100000));
}
export function orderDebts(debts, strategy, today) {
  return debts.filter(d => d.currentBalance > 0 && d.status !== "PAID").map(d => ({ ...d, priorityScore: priorityScore(d, today) })).sort((a, b) => {
    const difference = strategy === "avalanche"
      ? (b.interestRateMonthly ?? -1) - (a.interestRateMonthly ?? -1)
      : strategy === "snowball" ? a.currentBalance - b.currentBalance : b.priorityScore - a.priorityScore;
    return difference || a.currentBalance - b.currentBalance || String(a.id).localeCompare(String(b.id));
  });
}
function interest(balance, rate) {
  if (!rate) return 0;
  const numerator = BigInt(balance) * BigInt(Math.round(rate * 1000000));
  return Number((numerator + 50000000n) / 100000000n);
}
export function simulate(debts, extra, strategy, today, { rollover = true, limit = 600 } = {}) {
  const ordered = orderDebts(debts, strategy, today);
  const balances = new Map(ordered.map(d => [d.id, d.currentBalance]));
  const budget = sum(ordered.map(d => d.minimumPayment)) + extra;
  const months = [], payoffDates = {};
  let totalInterest = 0, complete = !ordered.length, reason = null;
  for (let index = 0; !complete && index < limit; index++) {
    const month = monthAt(today, index);
    const active = ordered.filter(d => balances.get(d.id) > 0);
    const rows = active.map(d => {
      const openingBalance = balances.get(d.id);
      const charge = interest(openingBalance, d.interestRateMonthly);
      return { debtId: d.id, name: d.name, openingBalance, interest: d.interestRateMonthly == null ? null : charge, normal: Math.min(d.minimumPayment, openingBalance + charge), extra: 0, closingBalance: openingBalance + charge };
    });
    if (rows.some(r => !Number.isSafeInteger(r.closingBalance) || r.closingBalance > 100000000000000)) { reason = "balance_limit"; break; }
    let available = (rollover ? budget : sum(active.map(d => d.minimumPayment)) + extra) - sum(rows.map(r => r.normal));
    for (const row of rows) row.closingBalance -= row.normal;
    for (const row of rows) {
      row.extra = Math.min(available, row.closingBalance);
      available -= row.extra;
      row.closingBalance -= row.extra;
      balances.set(row.debtId, row.closingBalance);
      totalInterest += row.interest ?? 0;
      if (row.closingBalance === 0) payoffDates[row.debtId] = month;
    }
    months.push({ month, rows, unused: available });
    complete = rows.every(r => r.closingBalance === 0);
    if (!complete && rows.every(r => r.closingBalance >= r.openingBalance)) { reason = "insufficient_payment"; break; }
  }
  if (!complete && !reason) reason = "horizon_limit";
  const ratesKnown = ordered.every(d => d.interestRateMonthly != null);
  return { months, payoffDates, complete, reason, monthsRemaining: complete ? months.length : null, endDate: complete ? months.at(-1)?.month ?? today.slice(0, 7) : null, estimatedInterest: ratesKnown && complete ? totalInterest : null, ratesKnown };
}

// Conservative capacity: cash actually received this month, less paid and pending
// obligations, capped by cash on hand after reserve and commitments. Also protect
// older overdue and the next month's known obligations/recurrences. A balance is
// never described as guaranteed recurring income. Re-evaluated on every request.
export function capacity(accounts, transactions, reserve, debts, today) {
  const month = today.slice(0, 7), nextMonth = monthAt(today, 1);
  let balance = sum(accounts.map(a => cents(a.balance))), received = 0, paid = 0, pending = 0, future = 0;
  const recurring = new Map();
  for (const t of transactions) {
    if (t.fundingSource === "meal" || (t.type === "receita" && /vale[-\s]?(refei|alimenta)/i.test(t.description || ""))) continue;
    const value = cents(t.amount), period = t.date.slice(0, 7), outgoing = t.type !== "receita";
    if (t.status === "pago") {
      balance += outgoing ? -value : value;
      if (period === month) { if (outgoing) paid += value; else received += value; }
    } else if (outgoing) {
      if (period <= month) pending += value;
      else if (period === nextMonth) future += value;
    }
    if (outgoing && t.recurrence === "monthly" && t.seriesId && period <= nextMonth) {
      const prior = recurring.get(t.seriesId);
      if (!prior || prior.date < t.date) recurring.set(t.seriesId, t);
    }
  }
  for (const t of recurring.values()) if (t.date.slice(0, 7) < nextMonth) future += cents(t.amount);
  const unlinkedMinimums = sum(debts.filter(d => !d.sourceKey && d.currentBalance > 0).map(d => Math.min(d.minimumPayment, d.currentBalance)));
  const protectedAmount = cents(reserve);
  const safeFree = Math.max(0, balance - protectedAmount - pending - unlinkedMinimums);
  const monthlySurplus = Math.max(0, received - paid - pending - unlinkedMinimums);
  const nextMonthBuffer = Math.max(0, future + unlinkedMinimums - pending - unlinkedMinimums);
  const recommended = Math.max(0, Math.min(safeFree - nextMonthBuffer, monthlySurplus));
  return { recommended, safeFree, protectedAmount, received, paid, pending, future, unlinkedMinimums };
}

export function sourceDebts(transactions, today) {
  const groups = new Map();
  for (const t of transactions.filter(t => t.type === "divida")) {
    const key = t.seriesId ? `series:${t.seriesId}` : `transaction:${t._id}`;
    const items = groups.get(key) || [];
    items.push(t); groups.set(key, items);
  }
  return [...groups].map(([sourceKey, rows]) => {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const pending = rows.filter(t => t.status !== "pago"), first = pending[0] || rows.at(-1);
    const currentBalance = sum(pending.map(t => cents(t.amount)));
    const originalBalance = sum(rows.map(t => cents(t.amount)));
    return { id: sourceKey, sourceKey, name: first.description, description: "", originalBalance, currentBalance,
      minimumPayment: pending.length ? cents(first.amount) : 0, interestRateMonthly: null, interestRateAnnual: null,
      dueDate: first.date, totalInstallments: rows.length, remainingInstallments: pending.length,
      status: currentBalance === 0 ? "PAID" : first.date < today ? "OVERDUE" : "ACTIVE",
      ownerUserId: String(first.createdBy), shared: false, creditor: "", category: first.category,
      startDate: rows[0].date, expectedEndDate: rows.at(-1).date, notes: "", sourceRecurring: rows.some(t => t.recurrence === "monthly") };
  });
}

export function effectiveDebts(items, sources) {
  const byKey = new Map(sources.map(d => [d.sourceKey, d]));
  const linked = new Set(items.map(d => d.sourceKey).filter(Boolean));
  return [...items.map(d => {
    const source = byKey.get(d.sourceKey);
    if (!d.sourceKey || d.balanceOverride) return d;
    if (!source) return { ...d, sourceMissing: true };
    return { ...d, originalBalance: source.originalBalance, currentBalance: source.currentBalance, minimumPayment: source.minimumPayment, dueDate: source.dueDate, remainingInstallments: source.remainingInstallments, status: source.status, sourceRecurring: source.sourceRecurring };
  }), ...sources.filter(d => !linked.has(d.sourceKey))];
}

export function buildPlan(debts, plan, financialCapacity, today) {
  const strategy = plan.strategy || "recommended";
  const requestedExtra = plan.monthlyExtraAmount ?? financialCapacity.recommended;
  const extra = Math.min(requestedExtra, financialCapacity.recommended);
  const normalized = debts.map(d => ({ ...d, overdueDays: overdueDays(d, today), status: d.currentBalance === 0 ? "PAID" : overdueDays(d, today) ? "OVERDUE" : d.status === "OVERDUE" ? "ACTIVE" : d.status }));
  const simulation = simulate(normalized, extra, strategy, today);
  const baseline = simulate(normalized, 0, strategy, today, { rollover: false });
  const faster = simulate(normalized, extra + 10000, strategy, today);
  const original = sum(normalized.map(d => d.originalBalance)), remaining = sum(normalized.map(d => d.currentBalance));
  const negotiatedDiscount = sum(normalized.flatMap(d => d.negotiations || []).map(n => n.discountAmount));
  const paid = Math.max(0, original - remaining - negotiatedDiscount);
  const ordered = orderDebts(normalized, strategy, today);
  return { strategy, requestedExtra, extra, capacity: financialCapacity, simulation,
    savings: simulation.estimatedInterest != null && baseline.estimatedInterest != null ? Math.max(0, baseline.estimatedInterest - simulation.estimatedInterest) : null,
    fasterBy100: simulation.complete && faster.complete ? simulation.monthsRemaining - faster.monthsRemaining : null,
    debts: [...ordered, ...normalized.filter(d => d.currentBalance === 0)].map(d => ({ ...d, payoffDate: simulation.payoffDates[d.id] || null })),
    summary: { original, remaining, paid, negotiatedDiscount, progress: original ? Math.min(100, Math.max(0, (original - remaining) / original * 100)) : 0,
      active: ordered.length, overdue: normalized.filter(d => d.status === "OVERDUE").length,
      monthlyCommitment: sum(ordered.map(d => Math.min(d.minimumPayment, d.currentBalance))), paidCount: normalized.length - ordered.length },
    status: normalized.length === 0 ? "EMPTY" : ordered.length === 0 ? "COMPLETED" : "ACTIVE" };
}
