export function createTransactionForm(type = "despesa", date = new Date().toISOString().slice(0, 10)) {
  return {
    type,
    description: "",
    amount: "",
    date,
    category: type === "receita" ? "Renda" : "Moradia",
    status: "pendente",
    accountId: "",
  };
}
