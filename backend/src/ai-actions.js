// OR-005 - Contratos das ações da IA.
// A IA nunca escreve no banco: ela só PROPÕE uma ação nomeada com campos tipados. Este módulo
// valida, classifica o risco e decide se a ação pode executar, precisa de confirmação ou de
// esclarecimento, ou deve ser negada. Não acessa banco nem provedor de IA (ver OR-008/OR-009).
import { createHash } from "node:crypto";
import { InputError, MAX_MONEY, requiredText, optionalText, moneyValue, oneOf, isoDate } from "./validation.js";

export const DEFAULT_POLICY = Object.freeze({
  highAmountThreshold: 5000, // acima disso a ação pede confirmação (ajustável por contexto)
  dateWindowDays: 366 // datas mais distantes que isto de "hoje" pedem confirmação
});

const TRANSACTION_TYPES = ["receita", "despesa"]; // dívida/meta e séries ficam fora desta versão
const STATUSES = ["pendente", "pago"];
const ID_PATTERN = /^[a-f0-9]{24}$/i;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const OUTCOMES = ["executed", "declined", "failed", "pending_confirmation"];
const LOG_REDACTED_FIELDS = ["notes"];

// Campos que a IA pode enviar. Nunca inclua identidade (usuário, espaço, papel): vem do contexto.
const fields = {
  type: { kind: "enum", values: TRANSACTION_TYPES, label: "Tipo", description: "receita (entrada) ou despesa (saída)." },
  description: { kind: "text", max: 160, label: "Descrição", description: "O que foi o lançamento, ex.: Mercado." },
  amount: { kind: "money", label: "Valor", description: "Valor em reais como número positivo com até 2 casas decimais, ex.: 150.5." },
  date: { kind: "date", label: "Data", description: "Data no formato AAAA-MM-DD, já resolvida (não 'amanhã')." },
  accountId: { kind: "id", label: "Conta", description: "Identificador da conta, quando o usuário a indicou." },
  category: { kind: "text", max: 50, label: "Categoria", description: "Categoria do lançamento." },
  paymentMethod: { kind: "text", max: 50, label: "Forma de pagamento", description: "Forma de pagamento." },
  status: { kind: "enum", values: STATUSES, label: "Status", description: "pago se já aconteceu; pendente se ainda vai acontecer." },
  fundingSource: { kind: "enum", values: ["cash", "meal"], label: "Origem do saldo", description: "cash para saldo comum; meal para vale-alimentação/refeição." },
  notes: { kind: "text", max: 300, label: "Observações", description: "Observação livre." },
  transactionId: { kind: "id", label: "Lançamento", description: "Identificador do lançamento." },
  from: { kind: "date", label: "Data inicial", description: "Início do período (AAAA-MM-DD)." },
  to: { kind: "date", label: "Data final", description: "Fim do período (AAAA-MM-DD)." },
  month: { kind: "month", label: "Mês", description: "Mês no formato AAAA-MM; omitido = mês atual." },
  limit: { kind: "int", min: 1, max: 50, label: "Limite", description: "Quantidade máxima de itens (1 a 50)." }
};

function pick(names, required = []) {
  return Object.fromEntries(names.map((name) => [name, { ...fields[name], required: required.includes(name) }]));
}

export const ACTIONS = Object.freeze({
  create_transaction: {
    description: "Registra uma receita ou despesa avulsa. Não cria parcelamentos nem contas fixas.",
    access: "write", risk: "write_low", reversible: true,
    fields: pick(["type", "description", "amount", "date", "accountId", "category", "paymentMethod", "status", "fundingSource", "notes"], ["type", "description", "amount", "date"]),
    defaults: { status: "pendente", fundingSource: "cash" },
    review(input, context, policy) {
      const reasons = [];
      if (input.amount > policy.highAmountThreshold) reasons.push(`Valor alto (acima de R$ ${policy.highAmountThreshold}).`);
      if (daysBetween(input.date, context.today) > policy.dateWindowDays) reasons.push("Data muito distante de hoje.");
      if (context.similarTransactionExists) reasons.push("Possível duplicidade: já existe um lançamento parecido.");
      return { reasons, warnings: [] };
    }
  },
  list_transactions: {
    description: "Consulta lançamentos do espaço atual, do mais recente ao mais antigo.",
    access: "read", risk: "read", reversible: true,
    fields: pick(["from", "to", "type", "status", "category", "limit"]),
    defaults: { limit: 20 },
    refine(input) {
      if (input.from && input.to && input.from > input.to) throw new InputError("A data inicial não pode ser depois da final.");
    }
  },
  get_summary: {
    description: "Resume receitas, despesas e saldo de um mês.",
    access: "read", risk: "read", reversible: true,
    fields: pick(["month"])
  },
  set_transaction_status: {
    description: "Marca um lançamento como pago ou pendente.",
    access: "write", risk: "write_low", reversible: true,
    fields: pick(["transactionId", "status"], ["transactionId", "status"])
  },
  delete_transaction: {
    description: "Exclui um lançamento. Sempre exige confirmação do usuário.",
    access: "write", risk: "write_high", reversible: true,
    fields: pick(["transactionId"], ["transactionId"]),
    review() {
      return {
        reasons: ["Exclusão exige confirmação."],
        warnings: ["Se o lançamento fizer parte de uma série, todos os itens da série serão excluídos. Só quem criou pode restaurar, pelo histórico."]
      };
    },
    alwaysConfirm: true
  }
});
// `list_transactions` aceita `type` com os mesmos valores do contrato de criação, mais dívida/meta para leitura.
ACTIONS.list_transactions.fields.type = { ...fields.type, values: ["receita", "despesa", "divida", "meta"], required: false };

function daysBetween(isoA, isoB) {
  const toUtc = (iso) => Date.UTC(...iso.split("-").map((part, index) => (index === 1 ? Number(part) - 1 : Number(part))));
  return Math.abs(toUtc(isoA) - toUtc(isoB)) / 86_400_000;
}

function isMissing(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function parseField(spec, value) {
  const label = spec.label;
  switch (spec.kind) {
    case "text":
      if (typeof value !== "string") throw new InputError(`${label} deve ser texto.`);
      return spec.required ? requiredText(value, label, spec.max) : optionalText(value, "", spec.max);
    case "money": {
      if (typeof value !== "number") throw new InputError(`${label} deve ser um número (sem texto nem vírgula).`);
      const amount = moneyValue(value, { label, min: 0.01, max: MAX_MONEY });
      if (Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) throw new InputError(`${label} deve ter no máximo 2 casas decimais.`);
      return amount;
    }
    case "enum":
      if (typeof value !== "string") throw new InputError(`${label} inválido.`);
      return oneOf(value, spec.values, label);
    case "date":
      if (typeof value !== "string") throw new InputError(`${label} deve ser texto no formato AAAA-MM-DD.`);
      return isoDate(value);
    case "id":
      if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new InputError(`${label} inválido.`);
      return value;
    case "month":
      if (typeof value !== "string" || !MONTH_PATTERN.test(value)) throw new InputError(`${label} deve estar no formato AAAA-MM.`);
      return value;
    case "int":
      if (!Number.isInteger(value) || value < spec.min || value > spec.max) throw new InputError(`${label} deve ser inteiro entre ${spec.min} e ${spec.max}.`);
      return value;
    default:
      throw new InputError(`${label} inválido.`);
  }
}

function result(decision, extra = {}) {
  return { decision, reasons: [], warnings: [], missing: [], errors: [], ...extra };
}

export function evaluateAction(name, rawInput, context = {}) {
  const action = typeof name === "string" && Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : null;
  if (!action) return result("deny", { reasons: ["Ação desconhecida."] });

  const permissions = context.permissions || {};
  if (!permissions.canRead) return result("deny", { reasons: ["Sem permissão para acessar este espaço."] });
  if (action.access === "write" && !permissions.canWrite) return result("deny", { reasons: ["Sem permissão para alterar este espaço."] });
  if (action.access === "write" && !context.requestId) return result("deny", { reasons: ["requestId ausente: toda escrita precisa ser idempotente."] });

  const policy = { ...DEFAULT_POLICY, ...(context.policy || {}) };
  const today = context.today || new Date().toISOString().slice(0, 10);
  const source = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput) ? rawInput : null;
  if (!source) return result("invalid", { errors: ["A ação deve receber um objeto de campos."] });

  const errors = Object.keys(source).filter((key) => !Object.hasOwn(action.fields, key)).map((key) => `Campo não permitido: ${key}.`);
  const missing = [];
  const input = {};
  for (const [key, spec] of Object.entries(action.fields)) {
    const value = source[key];
    if (isMissing(value)) {
      if (spec.required) missing.push(key);
      continue;
    }
    try {
      input[key] = parseField(spec, value);
    } catch (error) {
      if (!(error instanceof InputError)) throw error;
      errors.push(error.message);
    }
  }
  if (errors.length) return result("invalid", { errors, missing });
  if (missing.length) return result("clarify", { missing, reasons: [`Faltam informações: ${missing.join(", ")}.`] });

  for (const [key, value] of Object.entries(action.defaults || {})) if (input[key] === undefined) input[key] = value;
  try {
    action.refine?.(input);
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    return result("invalid", { errors: [error.message] });
  }

  const review = action.review ? action.review(input, { ...context, today }, policy) : { reasons: [], warnings: [] };
  if (action.alwaysConfirm || review.reasons.length) return result("confirm", { input, reasons: review.reasons, warnings: review.warnings });
  return result("execute", { input });
}

function toJsonSchema(spec) {
  const base = { description: spec.description };
  switch (spec.kind) {
    case "text": return { type: "string", maxLength: spec.max, ...base };
    case "money": return { type: "number", minimum: 0.01, maximum: MAX_MONEY, ...base };
    case "enum": return { type: "string", enum: spec.values, ...base };
    case "date": return { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", ...base };
    case "id": return { type: "string", pattern: "^[a-fA-F0-9]{24}$", ...base };
    case "month": return { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$", ...base };
    case "int": return { type: "integer", minimum: spec.min, maximum: spec.max, ...base };
    default: return base;
  }
}

// Definições neutras de provedor (JSON Schema); um adaptador por provedor as converte depois.
export function toToolDefinitions() {
  return Object.entries(ACTIONS).map(([name, action]) => ({
    name,
    description: action.description,
    parameters: {
      type: "object",
      properties: Object.fromEntries(Object.entries(action.fields).map(([key, spec]) => [key, toJsonSchema(spec)])),
      required: Object.entries(action.fields).filter(([, spec]) => spec.required).map(([key]) => key),
      additionalProperties: false
    }
  }));
}

// requestId determinístico por (conversa, mensagem, posição da ação): reenviar a mesma proposta
// reaproveita a idempotência já existente em Transaction.requestId (máx. 80 caracteres).
export function deriveRequestId({ conversationId, messageId, actionIndex }) {
  if (!conversationId || !messageId || !Number.isInteger(actionIndex) || actionIndex < 0) throw new InputError("Identificadores de conversa, mensagem e ação são obrigatórios.");
  const digest = createHash("sha256").update(JSON.stringify([String(conversationId), String(messageId), actionIndex])).digest("hex").slice(0, 32);
  return `orion:${digest}`;
}

// Registro para a trilha de execução (action_logs). Sem texto livre do usuário.
export function buildActionLog({ action, evaluation, requestId, outcome }) {
  if (!OUTCOMES.includes(outcome)) throw new InputError("Resultado inválido.");
  const input = Object.fromEntries(Object.entries(evaluation.input || {}).filter(([key]) => !LOG_REDACTED_FIELDS.includes(key)));
  return { action, decision: evaluation.decision, reasons: evaluation.reasons, requestId, outcome, input };
}
