import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, evaluateAction, toToolDefinitions, deriveRequestId, buildActionLog } from "./ai-actions.js";

const FORBIDDEN_MODEL_FIELDS = ["userId", "spaceId", "createdBy", "role", "isAdmin", "token", "password"];
const ctx = (extra = {}) => ({ permissions: { canRead: true, canWrite: true }, requestId: "orion:abc", today: "2026-11-27", ...extra });
const expense = (extra = {}) => ({ type: "despesa", description: "Mercado", amount: 150, date: "2026-11-27", ...extra });

test("the model can never choose whose data an action touches", () => {
  for (const definition of toToolDefinitions()) {
    const properties = Object.keys(definition.parameters.properties);
    for (const forbidden of FORBIDDEN_MODEL_FIELDS) assert.ok(!properties.includes(forbidden), `${definition.name} exposes ${forbidden}`);
    assert.equal(definition.parameters.additionalProperties, false, `${definition.name} must be strict`);
  }
});

test("tool definitions are provider-neutral JSON Schema with required fields", () => {
  const create = toToolDefinitions().find((definition) => definition.name === "create_transaction");
  assert.equal(create.parameters.type, "object");
  assert.deepEqual([...create.parameters.required].sort(), ["amount", "date", "description", "type"]);
  assert.deepEqual(create.parameters.properties.type.enum, ["receita", "despesa"]);
  assert.equal(typeof create.description, "string");
});

test("every action declares risk, access and reversibility", () => {
  for (const [name, action] of Object.entries(ACTIONS)) {
    assert.ok(["read", "write_low", "write_high"].includes(action.risk), `${name} risk`);
    assert.ok(["read", "write"].includes(action.access), `${name} access`);
    assert.equal(typeof action.reversible, "boolean", `${name} reversible`);
  }
});

test("complete, authorized, low-risk expense executes", () => {
  const result = evaluateAction("create_transaction", expense(), ctx());
  assert.equal(result.decision, "execute");
  assert.deepEqual(result.input, { type: "despesa", description: "Mercado", amount: 150, date: "2026-11-27", status: "pendente", fundingSource: "cash" });
});

test("missing required fields ask for clarification instead of guessing", () => {
  const result = evaluateAction("create_transaction", { type: "despesa", amount: 80 }, ctx());
  assert.equal(result.decision, "clarify");
  assert.deepEqual(result.missing.sort(), ["date", "description"]);
});

test("invalid values are rejected, not silently fixed", () => {
  for (const bad of [{ amount: 0 }, { amount: -5 }, { amount: "150,50" }, { date: "2026-02-31" }, { type: "divida" }, { description: "x".repeat(161) }]) {
    const result = evaluateAction("create_transaction", expense(bad), ctx());
    assert.equal(result.decision, "invalid", JSON.stringify(bad));
    assert.ok(result.errors.length > 0);
  }
});

test("unknown fields, including injected identity fields, are rejected", () => {
  const result = evaluateAction("create_transaction", expense({ spaceId: "000000000000000000000001", createdBy: "x" }), ctx());
  assert.equal(result.decision, "invalid");
  assert.match(result.errors.join(" "), /spaceId/);
  assert.match(result.errors.join(" "), /createdBy/);
});

test("no write permission denies writes but still allows reads", () => {
  const readOnly = ctx({ permissions: { canRead: true, canWrite: false } });
  assert.equal(evaluateAction("create_transaction", expense(), readOnly).decision, "deny");
  assert.equal(evaluateAction("get_summary", {}, readOnly).decision, "execute");
});

test("no read permission denies everything", () => {
  const none = ctx({ permissions: { canRead: false, canWrite: false } });
  assert.equal(evaluateAction("get_summary", {}, none).decision, "deny");
});

test("unknown actions are denied", () => {
  assert.equal(evaluateAction("drop_database", {}, ctx()).decision, "deny");
  assert.equal(evaluateAction("__proto__", {}, ctx()).decision, "deny");
});

test("writes without a system-derived requestId are denied (idempotency is mandatory)", () => {
  const result = evaluateAction("create_transaction", expense(), ctx({ requestId: "" }));
  assert.equal(result.decision, "deny");
  assert.match(result.reasons.join(" "), /requestId/);
});

test("high amounts, far dates and possible duplicates require confirmation", () => {
  assert.equal(evaluateAction("create_transaction", expense({ amount: 5000.01 }), ctx()).decision, "confirm");
  assert.equal(evaluateAction("create_transaction", expense({ amount: 5000 }), ctx()).decision, "execute");
  assert.equal(evaluateAction("create_transaction", expense({ date: "2028-01-01" }), ctx()).decision, "confirm");
  assert.equal(evaluateAction("create_transaction", expense({ date: "2024-01-01" }), ctx()).decision, "confirm");
  const duplicate = evaluateAction("create_transaction", expense(), ctx({ similarTransactionExists: true }));
  assert.equal(duplicate.decision, "confirm");
  assert.match(duplicate.reasons.join(" "), /duplic/i);
});

test("the confirmation threshold can be tuned per context", () => {
  const result = evaluateAction("create_transaction", expense({ amount: 300 }), ctx({ policy: { highAmountThreshold: 200 } }));
  assert.equal(result.decision, "confirm");
});

test("deleting always requires confirmation and warns about series", () => {
  const result = evaluateAction("delete_transaction", { transactionId: "64b7f0a1c2d3e4f5a6b7c8d9" }, ctx());
  assert.equal(result.decision, "confirm");
  assert.match(result.warnings.join(" "), /série/);
});

test("transaction ids must look like real ids", () => {
  const result = evaluateAction("delete_transaction", { transactionId: "../../etc/passwd" }, ctx());
  assert.equal(result.decision, "invalid");
});

test("status changes are low risk and validate the status", () => {
  const id = "64b7f0a1c2d3e4f5a6b7c8d9";
  assert.equal(evaluateAction("set_transaction_status", { transactionId: id, status: "pago" }, ctx()).decision, "execute");
  assert.equal(evaluateAction("set_transaction_status", { transactionId: id, status: "talvez" }, ctx()).decision, "invalid");
});

test("list_transactions applies safe defaults and bounds the page size", () => {
  assert.equal(evaluateAction("list_transactions", {}, ctx()).input.limit, 20);
  assert.equal(evaluateAction("list_transactions", { limit: 500 }, ctx()).decision, "invalid");
  assert.equal(evaluateAction("list_transactions", { from: "2026-12-01", to: "2026-11-01" }, ctx()).decision, "invalid");
});

test("get_summary accepts only a valid YYYY-MM month", () => {
  assert.equal(evaluateAction("get_summary", { month: "2026-11" }, ctx()).decision, "execute");
  assert.equal(evaluateAction("get_summary", { month: "2026-13" }, ctx()).decision, "invalid");
});

test("deriveRequestId is deterministic, unique per action and fits the existing 80-char field", () => {
  const base = { conversationId: "c1", messageId: "m1", actionIndex: 0 };
  assert.equal(deriveRequestId(base), deriveRequestId({ ...base }));
  assert.notEqual(deriveRequestId(base), deriveRequestId({ ...base, actionIndex: 1 }));
  assert.notEqual(deriveRequestId(base), deriveRequestId({ ...base, messageId: "m2" }));
  assert.ok(deriveRequestId(base).length <= 80);
  assert.match(deriveRequestId(base), /^orion:[0-9a-f]+$/);
});

test("action logs keep an audit trail without free-text notes", () => {
  const evaluation = evaluateAction("create_transaction", expense({ notes: "informação sensível do usuário" }), ctx());
  const log = buildActionLog({ action: "create_transaction", evaluation, requestId: "orion:abc", outcome: "executed" });
  assert.equal(log.action, "create_transaction");
  assert.equal(log.decision, "execute");
  assert.equal(log.outcome, "executed");
  assert.equal(log.requestId, "orion:abc");
  assert.equal(log.input.amount, 150);
  assert.equal("notes" in log.input, false);
  assert.ok(!JSON.stringify(log).includes("sensível"));
});

test("amounts are limited to cents and must be real numbers", () => {
  for (const amount of [10.123, NaN, Infinity, 1e15, "10", true]) {
    assert.notEqual(evaluateAction("create_transaction", expense({ amount }), ctx()).decision, "execute", String(amount));
  }
  assert.equal(evaluateAction("create_transaction", expense({ amount: 10.1 }), ctx()).decision, "execute");
});

test("non-object payloads and wrongly typed fields never reach execution", () => {
  for (const payload of [null, undefined, "texto", 42, [], [expense()]]) {
    assert.equal(evaluateAction("create_transaction", payload, ctx()).decision, "invalid", JSON.stringify(payload));
  }
  for (const bad of [{ description: { $ne: "" } }, { description: ["Mercado"] }, { type: { $gt: "" } }, { date: 20261127 }]) {
    assert.equal(evaluateAction("create_transaction", expense(bad), ctx()).decision, "invalid", JSON.stringify(bad));
  }
});

test("blank strings count as missing, not as valid values", () => {
  const result = evaluateAction("create_transaction", expense({ description: "   " }), ctx());
  assert.equal(result.decision, "clarify");
  assert.deepEqual(result.missing, ["description"]);
});

test("a rejected proposal never returns an executable input", () => {
  const result = evaluateAction("create_transaction", expense({ amount: -1 }), ctx());
  assert.equal(result.input, undefined);
});
