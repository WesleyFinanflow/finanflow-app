// Multiconta, etapa 2: regras puras (sem banco). As rotas em server.js só chamam estas funções.
// Tudo isto só vale quando a chave "multiconta" está ligada; desligada, o comportamento antigo
// (uma conta automática por espaço) permanece intacto.
import { InputError, requiredText, optionalText, moneyValue } from "./validation.js";

export const MULTI_ACCOUNT_FLAG = "multiconta";
export const MAX_ACCOUNTS_PER_PERSON = 6;
const DEFAULT_ACCOUNT_NAMES = ["Conta principal", "Conta conjunta"];

export class ConflictError extends InputError {
  constructor(message) {
    super(message);
    this.name = "ConflictError";
    this.status = 409;
  }
}

const sameId = (a, b) => String(a) === String(b);
const normalizeName = (value) => String(value ?? "").trim().toLowerCase();
const activeOf = (accounts) => (Array.isArray(accounts) ? accounts : []).filter((account) => !account.archived);

// Diferente das chaves antigas (ausente = ligada), aqui ausente ou inativa = DESLIGADA.
export function featureEnabledForUser(flag, user = {}, role = "USER") {
  if (!flag || !flag.active) return false;
  switch (flag.audience) {
    case "ALL": return true;
    case "ADMINS": return role !== "USER";
    case "PREMIUM": return user?.planCode === "PREMIUM";
    case "TEST_GROUP": return user?.trialStatus === "ACTIVE";
    default: return false;
  }
}

function parseBalance(value) {
  if (typeof value !== "number" && typeof value !== "string") throw new InputError("Informe um saldo válido.");
  const amount = moneyValue(value, { label: "Saldo" });
  return Math.round(amount * 100) / 100;
}

// Só devolve campos conhecidos: identidade (espaço, dono, id) nunca vem do cliente.
export function parseAccountInput(body, user = {}, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new InputError("Dados da conta inválidos.");
  const result = {};

  if (!partial || body.name !== undefined) {
    if (body.name !== undefined && body.name !== null && typeof body.name !== "string") throw new InputError("Nome da conta deve ser texto.");
    result.name = requiredText(body.name, "Nome da conta", 80);
  }
  if (!partial || body.ownerName !== undefined) {
    if (body.ownerName !== undefined && body.ownerName !== null && typeof body.ownerName !== "string") throw new InputError("Responsável deve ser texto.");
    result.ownerName = optionalText(body.ownerName, user?.name || "Individual", 80);
  }
  if (!partial) {
    result.balance = body.balance === undefined || body.balance === null || body.balance === "" ? 0 : parseBalance(body.balance);
  } else if (body.balance !== undefined) {
    result.balance = parseBalance(body.balance);
  }
  if (partial && body.archived !== undefined) {
    if (typeof body.archived !== "boolean") throw new InputError("Arquivada deve ser verdadeiro ou falso.");
    result.archived = body.archived;
  }
  if (partial && Object.keys(result).length === 0) throw new InputError("Nenhum campo para atualizar.");
  return result;
}

function limitError() {
  return new ConflictError(`Limite de ${MAX_ACCOUNTS_PER_PERSON} contas atingido. Arquive ou exclua uma conta para criar outra.`);
}

export function assertCanCreate(accounts, name) {
  const active = activeOf(accounts);
  if (active.length >= MAX_ACCOUNTS_PER_PERSON) throw limitError();
  if (active.some((account) => normalizeName(account.name) === normalizeName(name))) throw new ConflictError("Já existe uma conta com esse nome.");
}

export function assertCanUpdate({ account, patch, accounts }) {
  const otherActive = activeOf((accounts || []).filter((item) => !sameId(item._id, account._id)));
  if (patch.archived === true && !account.archived && otherActive.length === 0) throw new ConflictError("Mantenha pelo menos uma conta ativa.");
  const becomesActive = patch.archived === false && Boolean(account.archived);
  if (becomesActive && otherActive.length >= MAX_ACCOUNTS_PER_PERSON) throw limitError();
  const willBeActive = patch.archived === undefined ? !account.archived : !patch.archived;
  if (willBeActive && (patch.name !== undefined || becomesActive)) {
    const name = patch.name ?? account.name;
    if (otherActive.some((item) => normalizeName(item.name) === normalizeName(name))) throw new ConflictError("Já existe uma conta com esse nome.");
  }
}

export function assertCanDelete({ account, accounts, confirmName }) {
  const others = (accounts || []).filter((item) => !sameId(item._id, account._id));
  if (others.length === 0) throw new ConflictError("Não é possível excluir a única conta.");
  if (!account.archived && activeOf(others).length === 0) throw new ConflictError("Mantenha pelo menos uma conta ativa. Reative ou crie outra antes de excluir esta.");
  if (typeof confirmName !== "string" || normalizeName(confirmName) !== normalizeName(account.name)) {
    throw new InputError("Digite o nome da conta para confirmar a exclusão.");
  }
}

// Escolhe a conta de um lançamento. `currentAccountId` permite editar um lançamento que já está
// numa conta arquivada sem precisar reativá-la.
export function chooseAccountForTransaction({ requestedId, currentAccountId, accounts }) {
  const list = Array.isArray(accounts) ? accounts : [];
  if (requestedId !== undefined && requestedId !== null && requestedId !== "") {
    const match = list.find((account) => sameId(account._id, requestedId));
    if (!match) throw new InputError("Conta inválida para este espaço.");
    const keepsCurrent = currentAccountId !== undefined && currentAccountId !== null && sameId(currentAccountId, match._id);
    if (match.archived && !keepsCurrent) throw new InputError("Esta conta está arquivada. Reative-a para lançar nela.");
    return match;
  }
  const active = activeOf(list);
  if (active.length === 0) throw new InputError("Nenhuma conta ativa neste espaço.");
  return active.find((account) => DEFAULT_ACCOUNT_NAMES.includes(account.name)) ?? active[0];
}

// Cópia gravada na auditoria ANTES de apagar, para a conta poder ser restaurada depois.
export function accountDeleteAudit({ account, transactions }) {
  const count = Array.isArray(transactions) ? transactions.length : 0;
  const summary = `Conta excluída: ${account.name} (${count} lançamento${count === 1 ? "" : "s"})`.slice(0, 180);
  return { summary, before: { account, transactions: transactions || [] } };
}
