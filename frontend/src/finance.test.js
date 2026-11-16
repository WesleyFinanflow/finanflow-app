import test from "node:test";
import assert from "node:assert/strict";
import { calculatePurchase, calculateSummary, calculateReportBalances } from "./finance.js";

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
    mealDelta: 0,
    mealBalance: 0,
    commitments: 700,
    free: 1900,
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

test("separa vale-refeição do saldo em dinheiro", () => {
  const summary = calculateSummary(
    [{ balance: 100 }],
    [
      { type: "receita", status: "pago", fundingSource: "meal", amount: 500 },
      { type: "despesa", status: "pago", fundingSource: "meal", amount: 80 },
      { type: "receita", status: "pendente", amount: 1000 },
    ],
    0
  );
  assert.equal(summary.balance, 100);
  assert.equal(summary.mealBalance, 420);
  assert.equal(summary.free, 100);
});

test("simulador compara a parcela mensal com o saldo livre", () => {
  assert.deepEqual(calculatePurchase(1200, 12, 150), { monthlyImpact: 100, canBuy: true });
  assert.deepEqual(calculatePurchase(1200, 6, 150), { monthlyImpact: 200, canBuy: false });
});

test("currency arithmetic preserves cents and never displays negative zero", () => {
 const summary=calculateSummary([{balance:0.3}],[{type:"despesa",status:"pago",amount:0.1},{type:"despesa",status:"pago",amount:0.2}]);
 assert.equal(summary.balance,0);assert.equal(summary.paidExpenses,0.3);assert.equal(summary.free,0);
 const reserved=calculateSummary([{balance:1000.01}],[{type:"receita",status:"pago",amount:500.02},{type:"despesa",status:"pago",amount:50.03},{type:"divida",status:"pendente",amount:100.04},{type:"meta",status:"pendente",amount:20.05}],30.06);
 assert.equal(reserved.balance,1450);assert.equal(reserved.commitments,120.09);assert.equal(reserved.free,1299.85);
});
test("cash, meal benefits, periods and protected amounts remain separate in cents", () => {
 const summary=calculateSummary([{balance:10.1}],[{type:"receita",fundingSource:"meal",status:"pago",amount:0.3,date:"2026-01-01"},{type:"despesa",fundingSource:"meal",status:"pago",amount:0.1,date:"2026-01-02"},{type:"receita",status:"pago",amount:0.2,date:"2025-12-31"},{type:"despesa",status:"pendente",amount:0.1,date:"2026-01-10"},{type:"despesa",status:"pendente",amount:9,date:"2026-02-10"}],0.2,"2026-01");
 assert.equal(summary.balance,10.3);assert.equal(summary.mealBalance,0.2);assert.equal(summary.commitments,0.1);assert.equal(summary.free,10);
});

test("reports reconcile opening and closing cash balances without meal benefits or future paid records",()=>{
 const transactions=[{type:"receita",status:"pago",amount:500,date:"2026-01-10"},{type:"despesa",status:"pago",amount:50,date:"2026-01-11"},{type:"meta",status:"pago",amount:20,date:"2026-01-12"},{type:"receita",status:"pago",fundingSource:"meal",amount:200,date:"2026-01-10"},{type:"receita",status:"pago",amount:900,date:"2026-02-01"},{type:"despesa",status:"pendente",amount:100,date:"2026-01-20"}];
 assert.deepEqual(calculateReportBalances(1000,transactions,50,"2026-01","2026-01"),{initialBalance:1000,finalBalance:1430,safeBalance:1280,mealBalance:200,savedInPeriod:20});
 assert.deepEqual(calculateReportBalances(1000,transactions,50,"2026-02","2026-02"),{initialBalance:1430,finalBalance:2330,safeBalance:2280,mealBalance:200,savedInPeriod:0});
});
