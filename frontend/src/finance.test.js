import test from "node:test";
import assert from "node:assert/strict";
import { calculatePurchase, calculateSummary } from "./finance.js";

test("calcula o saldo livre sem descontar lançamentos já pagos duas vezes", () => {
  const summary = calculateSummary(
    [{ balance: 2000 }, { balance: 500 }],
    [
      { type: "receita", status: "pendente", amount: 1000 },
      { type: "despesa", status: "pendente", amount: 400 },
      { type: "divida", status: "pendente", amount: 200 },
      { type: "meta", status: "pendente", amount: 100 },
      { type: "receita", status: "pago", amount: 700 },
      { type: "despesa", status: "pago", amount: 300 },
    ],
    300
  );

  assert.deepEqual(summary, {
    balance: 2500,
    income: 1000,
    received: 700,
    expenses: 400,
    paidExpenses: 300,
    debt: 200,
    goals: 100,
    commitments: 700,
    free: 2500,
  });
});

test("mantém reservas independentes por espaço", () => {
  const accounts = [{ balance: 2000 }];
  assert.equal(calculateSummary(accounts, [], 300).free, 1700);
  assert.equal(calculateSummary(accounts, [], 800).free, 1200);
});

test("simulador compara a parcela mensal com o saldo livre", () => {
  assert.deepEqual(calculatePurchase(1200, 12, 150), { monthlyImpact: 100, canBuy: true });
  assert.deepEqual(calculatePurchase(1200, 6, 150), { monthlyImpact: 200, canBuy: false });
});
