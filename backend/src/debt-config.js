// Central, versioned deterministic rules. No bureau or legal inference is made.
export const DEBT_TYPES = {
  CREDIT_CARD: "Cartão de crédito", OVERDRAFT: "Cheque especial", PERSONAL_LOAN: "Empréstimo pessoal",
  PAYROLL_LOAN: "Empréstimo consignado", FINANCING: "Financiamento", STORE_CREDIT: "Loja / crediário",
  UTILITY: "Conta de consumo", RENT: "Aluguel", CONDOMINIUM: "Condomínio", TUITION: "Mensalidade",
  EDUCATION: "Escola / faculdade", TAX: "Imposto", ACTIVE_DEBT: "Dívida ativa", PROTEST: "Protesto / cartório",
  FINE: "Multa", HEALTH_PLAN: "Plano de saúde", SUBSCRIPTION: "Assinatura / serviço",
  PRIVATE_LOAN: "Empréstimo com pessoa física", OTHER: "Outras",
};
export const DEBT_STATUSES = { ACTIVE: "Em dia", OVERDUE: "Atrasada", NEGATIVE_LISTED: "Negativada", PROTESTED: "Protestada", ACTIVE_DEBT: "Inscrita em dívida ativa", NEGOTIATED: "Negociada", PAID: "Quitada" };
export const TRI_STATE = ["YES", "NO", "UNKNOWN"];
export const PRIORITY_WEIGHTS = Object.freeze({ version: 2, interest: 20, overdueDays: 12, overdueAmount: 8, negativeListing: 15, protest: 15, activeDebt: 15, monthlyCommitment: 10, balance: 5, oldWithoutRestrictionMultiplier: 0.65, interestSaturation: 15, overdueDaysSaturation: 180 });

export function debtMarkers(debt, today) {
  const paid = debt.currentBalance === 0 || debt.status === "PAID";
  const due = debt.originalDueDate || debt.dueDate;
  const referenceDate = debt.oldDebtReferenceDate || debt.firstOverdueDate || due || debt.startDate;
  const anniversary = referenceDate ? new Date(`${referenceDate}T00:00:00Z`) : null;
  if (anniversary) anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 5);
  // Negotiation may cure current arrears, but never erases the original age.
  const currentDue = debt.status === "NEGOTIATED" ? debt.dueDate : due;
  const daysOverdue = !paid && currentDue && currentDue < today ? Math.floor((Date.parse(today) - Date.parse(debt.firstOverdueDate || currentDue)) / 86400000) : 0;
  const isNegativeListed = !paid && (debt.negativeListingActive === "YES" || (debt.status === "NEGATIVE_LISTED" && debt.negativeListingActive !== "NO"));
  const isProtested = !paid && (debt.protestActive === "YES" || (debt.status === "PROTESTED" && debt.protestActive !== "NO"));
  const isActiveDebt = !paid && (debt.activeDebtRegistered === "YES" || (debt.status === "ACTIVE_DEBT" && debt.activeDebtRegistered !== "NO"));
  return { daysOverdue: Math.max(0, daysOverdue), overdueDays: Math.max(0, daysOverdue), isOverdue: daysOverdue > 0,
    isNegativeListed, isProtested, isActiveDebt, isOldDebt: !paid && Boolean(anniversary && anniversary.toISOString().slice(0, 10) < today), oldDebtReferenceDate: referenceDate || null };
}
