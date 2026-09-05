export function createTransactionForm(type = "despesa", date = new Date().toISOString().slice(0, 10)) {
  return {
    type,
    description: "",
    amount: "",
    date,
    time: "",
    category: type === "receita" ? "Salário" : "",
    paymentMethod: "Não informado",
    notes: "",
    status: "pendente",
    fundingSource: "cash",
    accountId: "",
    recurrence: "none",
    installmentCount: "1",
    origin: "manual",
  };
}
