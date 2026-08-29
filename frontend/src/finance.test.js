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
    baseBalance: 2500,
    balance: 2900,
    income: 1000,
    received: 700,
    totalReceived: 700,
    expenses: 400,
    paidExpenses: 300,
    totalPaidExpenses: 300,
    debt: 200,
    goals: 100,
    paidDebt: 0,
    totalPaidDebt: 0,
    savedGoals: 0,
    balanceDelta: 400,
    commitments: 700,
    free: 2900,
  });
});

test("movimenta automaticamente a conta principal com lançamentos pagos", () => {
  const summary = calculateSummary(
    [{ balance: 100 }],
    [
      { type: "receita", status: "pago", amount: 1825.06 },
      { type: "receita", status: "pago", amount: 600 },
      { type: "despesa", status: "pago", amount: 25 },
      { type: "divida", status: "pago", amount: 250 },
      { type: "meta", status: "pago", amount: 300 },
      { type: "despesa", status: "pendente", amount: 90 },
    ],
    0
  );
  assert.equal(summary.balance, 1950.06);
  assert.equal(summary.savedGoals, 300);
  assert.equal(summary.expenses, 90);
  assert.equal(summary.commitments, 90);
});

test("mantém o saldo acumulado e limita compromissos ao mês atual", () => {
  const summary = calculateSummary(
    [{ balance: 0 }],
    [
      { type: "receita", status: "pago", amount: 1000, date: "2026-07-05" },
      { type: "despesa", status: "pago", amount: 200, date: "2026-07-10" },
      { type: "despesa", status: "pendente", amount: 90, date: "2026-08-10" },
      { type: "despesa", status: "pendente", amount: 500, date: "2026-09-10" },
    ],
    0,
    "2026-08"
  );
  assert.equal(summary.balance, 800);
  assert.equal(summary.expenses, 90);
  assert.equal(summary.commitments, 90);
  assert.equal(summary.totalReceived, 1000);
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
