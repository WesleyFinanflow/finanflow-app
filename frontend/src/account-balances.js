// Multiconta, etapa 1: saldo por conta. Ainda não é usado pelas telas.
// Regras idênticas às de calculateSummary (finance.js) para que o total nunca diverja:
// só lançamentos pagos contam; receita soma; despesa e dívida subtraem; meta paga sempre sai do
// saldo comum; lançamentos de vale-refeição ficam no saldo de benefícios, fora das contas.
import { isMealTransaction } from "./finance.js";

const cents = (value) => Math.round(Number(value || 0) * 100);
const reais = (value) => value / 100;

export function calculateAccountBalances(accounts = [], transactions = []) {
  const list = Array.isArray(accounts) ? accounts : [];
  const rows = Array.isArray(transactions) ? transactions : [];
  const byId = new Map(list.map((account) => [String(account._id), { id: account._id, name: account.name, cents: cents(account.balance) }]));
  let unassigned = 0;
  let meal = 0;

  for (const transaction of rows) {
    if (transaction.status !== "pago") continue;
    const amount = cents(transaction.amount);
    let delta = 0;
    if (transaction.type === "receita") delta = amount;
    else if (transaction.type === "despesa" || transaction.type === "divida") delta = -amount;
    else if (transaction.type === "meta") delta = -amount;
    else continue;

    // Meta nunca vai para o saldo de benefícios (mesma regra de calculateSummary).
    if (transaction.type !== "meta" && isMealTransaction(transaction)) {
      meal += delta;
      continue;
    }
    const target = transaction.accountId == null ? undefined : byId.get(String(transaction.accountId));
    if (target) target.cents += delta;
    else unassigned += delta;
  }

  const accountsOut = [...byId.values()].map(({ id, name, cents: value }) => ({ id, name, balance: reais(value) }));
  const totalCents = [...byId.values()].reduce((sum, item) => sum + item.cents, 0) + unassigned;
  return { accounts: accountsOut, unassigned: reais(unassigned), total: reais(totalCents), mealBalance: reais(meal) };
}

const DEFAULT_ACCOUNT_NAMES = ["Conta principal", "Conta conjunta"];

// Mesma regra do backend (chooseAccountForTransaction): a principal ativa; sem ela, a primeira ativa.
export function defaultAccountId(accounts = []) {
  const active = (Array.isArray(accounts) ? accounts : []).filter((account) => !account.archived);
  const chosen = active.find((account) => DEFAULT_ACCOUNT_NAMES.includes(account.name)) ?? active[0];
  return chosen ? String(chosen._id) : "";
}

// Opções do seletor de conta no lançamento: as ativas, mais a conta atual do lançamento se estiver arquivada.
export function accountOptions(accounts = [], currentAccountId) {
  const list = Array.isArray(accounts) ? accounts : [];
  return list
    .filter((account) => !account.archived || (currentAccountId != null && String(currentAccountId) === String(account._id)))
    .map((account) => ({ id: String(account._id), name: account.name, archived: Boolean(account.archived) }));
}
