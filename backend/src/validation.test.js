import test from "node:test";
import assert from "node:assert/strict";
import { emailAddress, isoDate, moneyValue, oneOf, requiredText } from "./validation.js";

test("normaliza textos e e-mails", () => {
  assert.equal(requiredText("  Conta principal  ", "Conta", 80), "Conta principal");
  assert.equal(emailAddress("  TESTE@EXEMPLO.COM "), "teste@exemplo.com");
});

test("rejeita valor zero quando o mínimo é um centavo", () => {
  assert.throws(() => moneyValue(0, { min: 0.01 }), /valor válido/i);
  assert.equal(moneyValue("10.50", { min: 0.01 }), 10.5);
});

test("valida enumerações e datas ISO", () => {
  assert.equal(oneOf("receita", ["receita", "despesa"], "Tipo"), "receita");
  assert.throws(() => oneOf("outro", ["receita", "despesa"], "Tipo"), /inválido/i);
  assert.equal(isoDate("2026-06-20"), "2026-06-20");
  assert.throws(() => isoDate("20/06/2026"), /data válida/i);
  assert.throws(() => isoDate("2026-02-31"), /data válida/i);
});
