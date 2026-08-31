import test from "node:test";
import assert from "node:assert/strict";
import { addMonthsToIsoDate, repeatInstallmentAmount, splitInstallmentAmounts } from "./recurrence.js";

test("mantém o dia possível ao avançar contas mensais", () => {
  assert.equal(addMonthsToIsoDate("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsToIsoDate("2026-01-15", 2), "2026-03-15");
});

test("divide o valor total sem perder centavos", () => {
  const installments = splitInstallmentAmounts(100, 3);
  assert.deepEqual(installments, [33.34, 33.33, 33.33]);
  assert.equal(installments.reduce((total, value) => total + value, 0), 100);
});

test("repete o valor informado em todas as parcelas", () => {
  const installments = repeatInstallmentAmount(600, 6);
  assert.deepEqual(installments, [600, 600, 600, 600, 600, 600]);
  assert.equal(installments.reduce((sum, value) => sum + value, 0), 3600);
});
