const cents = value => Math.round(Number(value || 0) * 100);
const reais = value => value / 100;

export function isMealTransaction(transaction) {
 return transaction.fundingSource === "meal" || (transaction.type === "receita" && /vale[-\s]?(refei|alimenta)/i.test(String(transaction.description || "")));
}
export function calculateReportBalances(baseBalance, transactions, reserve, firstMonth, lastMonth) {
 const throughEnd=transactions.filter(item=>String(item.date||"").slice(0,7)<=lastMonth);
 const beforeStart=transactions.filter(item=>String(item.date||"").slice(0,7)<firstMonth);
 const final=calculateSummary([{balance:baseBalance}],throughEnd,reserve,lastMonth);
 const saved=transactions.filter(item=>item.type==="meta"&&item.status==="pago"&&!isMealTransaction(item)&&String(item.date).slice(0,7)>=firstMonth&&String(item.date).slice(0,7)<=lastMonth).reduce((total,item)=>total+cents(item.amount),0);
 return {initialBalance:calculateSummary([{balance:baseBalance}],beforeStart).balance,finalBalance:final.balance,safeBalance:final.free,mealBalance:final.mealBalance,savedInPeriod:reais(saved)};
}

export function calculateSummary(accounts = [], transactions = [], reserve = 0, periodKey = "") {
  const baseBalance = accounts.reduce((total, account) => total + cents(account.balance), 0);
  const totals = transactions.reduce(
    (result, transaction) => {
      const amount = cents(transaction.amount);
      const inPeriod = !periodKey || String(transaction.date || "").slice(0, 7) === periodKey;
      if (transaction.status === "pago") {
        const isMeal = isMealTransaction(transaction);
        if (transaction.type === "receita") { result.totalReceived += amount; isMeal ? result.mealDelta += amount : result.balanceDelta += amount; if (inPeriod) result.received += amount; }
        if (transaction.type === "despesa") { result.totalPaidExpenses += amount; isMeal ? result.mealDelta -= amount : result.balanceDelta -= amount; if (inPeriod) result.paidExpenses += amount; }
        if (transaction.type === "divida") { result.totalPaidDebt += amount; isMeal ? result.mealDelta -= amount : result.balanceDelta -= amount; if (inPeriod) result.paidDebt += amount; }
        if (transaction.type === "meta") { result.savedGoals += amount; result.balanceDelta -= amount; }
        return result;
      }
      if (!inPeriod) return result;
      if (isMealTransaction(transaction)) return result;
      if (transaction.type === "receita") result.income += amount;
      if (transaction.type === "despesa") result.expenses += amount;
      if (transaction.type === "divida") result.debt += amount;
      if (transaction.type === "meta") result.goals += amount;
      return result;
    },
    { income: 0, received: 0, totalReceived: 0, expenses: 0, paidExpenses: 0, totalPaidExpenses: 0, debt: 0, goals: 0, paidDebt: 0, totalPaidDebt: 0, savedGoals: 0, balanceDelta: 0, mealDelta: 0 }
  );
  const commitments = totals.expenses + totals.debt + totals.goals;
  const balance = baseBalance + totals.balanceDelta;
  return {
    baseBalance: reais(baseBalance),
    balance: reais(balance),
    mealBalance: reais(totals.mealDelta),
    ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, reais(value)])),
    commitments: reais(commitments),
    free: reais(balance - commitments - cents(reserve)),
  };
}

export function calculatePurchase(total, installments, freeBalance) {
  const normalizedTotal = Math.max(0, Number(total || 0));
  const normalizedInstallments = Math.max(1, Math.floor(Number(installments || 1)));
  const monthlyImpact = normalizedTotal / normalizedInstallments;
  return {
    monthlyImpact,
    canBuy: normalizedTotal > 0 && Number(freeBalance || 0) >= monthlyImpact,
  };
}
