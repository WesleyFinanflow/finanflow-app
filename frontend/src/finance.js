export function calculateSummary(accounts = [], transactions = [], reserve = 0) {
  const balance = accounts.reduce((total, account) => total + Number(account.balance || 0), 0);
  const totals = transactions.reduce(
    (result, transaction) => {
      const amount = Number(transaction.amount || 0);
      if (transaction.status === "pago") {
        if (transaction.type === "receita") result.received += amount;
        if (transaction.type === "despesa") result.paidExpenses += amount;
        return result;
      }
      if (transaction.type === "receita") result.income += amount;
      if (transaction.type === "despesa") result.expenses += amount;
      if (transaction.type === "divida") result.debt += amount;
      if (transaction.type === "meta") result.goals += amount;
      return result;
    },
    { income: 0, received: 0, expenses: 0, paidExpenses: 0, debt: 0, goals: 0 }
  );
  const commitments = totals.expenses + totals.debt + totals.goals;
  return {
    balance,
    ...totals,
    commitments,
    free: balance + totals.income - commitments - Number(reserve || 0),
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
