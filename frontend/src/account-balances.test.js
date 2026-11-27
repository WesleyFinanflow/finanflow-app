import test from "node:test";
import assert from "node:assert/strict";
import { calculateSummary } from "./finance.js";
import { calculateAccountBalances } from "./account-balances.js";

const tx = (extra = {}) => ({ type: "despesa", status: "pago", amount: 10, date: "2026-11-10", accountId: "a1", fundingSource: "cash", ...extra });
const cents = (value) => Math.round(value * 100);

test("com uma conta só, o total é idêntico ao saldo atual do app", () => {
  const accounts = [{ _id: "a1", name: "Conta principal", balance: 1000 }];
  const transactions = [tx({ type: "receita", amount: 500 }), tx({ amount: 120.5 }), tx({ type: "divida", amount: 80 }), tx({ type: "meta", amount: 50 })];
  const result = calculateAccountBalances(accounts, transactions);
  assert.equal(result.total, calculateSummary(accounts, transactions).balance);
  assert.equal(result.total, 1249.5);
  assert.equal(result.accounts[0].balance, 1249.5);
  assert.equal(result.unassigned, 0);
});

test("cada conta recebe só os lançamentos dela", () => {
  const accounts = [{ _id: "a1", name: "Nubank", balance: 1000 }, { _id: "a2", name: "Santander", balance: 200 }];
  const transactions = [tx({ type: "receita", amount: 300, accountId: "a1" }), tx({ amount: 50, accountId: "a2" }), tx({ amount: 25, accountId: "a2" })];
  const result = calculateAccountBalances(accounts, transactions);
  assert.deepEqual(result.accounts.map((item) => [item.id, item.balance]), [["a1", 1300], ["a2", 125]]);
  assert.equal(result.total, 1425);
});

test("lançamentos pendentes não alteram o saldo", () => {
  const accounts = [{ _id: "a1", name: "Nubank", balance: 100 }];
  const result = calculateAccountBalances(accounts, [tx({ status: "pendente", amount: 999 }), tx({ status: "pendente", type: "receita", amount: 999 })]);
  assert.equal(result.total, 100);
});

test("vale-refeição fica fora do saldo das contas e no saldo de benefícios", () => {
  const accounts = [{ _id: "a1", name: "Nubank", balance: 100 }];
  const transactions = [tx({ type: "receita", amount: 550, fundingSource: "meal" }), tx({ amount: 150, fundingSource: "meal" }), tx({ type: "receita", amount: 20, description: "Vale-alimentação" })];
  const result = calculateAccountBalances(accounts, transactions);
  assert.equal(result.total, 100);
  assert.equal(result.mealBalance, 420);
  assert.equal(result.mealBalance, calculateSummary(accounts, transactions).mealBalance);
});

test("lançamento sem conta ou com conta desconhecida vai para 'sem conta' e o total não muda", () => {
  const accounts = [{ _id: "a1", name: "Nubank", balance: 100 }];
  const transactions = [tx({ type: "receita", amount: 40, accountId: undefined }), tx({ amount: 15, accountId: "conta-apagada" }), tx({ amount: 5, accountId: null })];
  const result = calculateAccountBalances(accounts, transactions);
  assert.equal(result.unassigned, 20);
  assert.equal(result.accounts[0].balance, 100);
  assert.equal(result.total, 120);
  assert.equal(result.total, calculateSummary(accounts, transactions).balance);
});

test("aceita ids como texto ou como objeto com toString", () => {
  const objectId = { toString: () => "507f1f77bcf86cd799439011" };
  const accounts = [{ _id: objectId, name: "Nubank", balance: 10 }];
  const result = calculateAccountBalances(accounts, [tx({ type: "receita", amount: 5, accountId: "507f1f77bcf86cd799439011" })]);
  assert.equal(result.accounts[0].balance, 15);
  assert.equal(result.unassigned, 0);
});

test("não perde centavos em somas de decimais", () => {
  const accounts = [{ _id: "a1", name: "Nubank", balance: 0.1 }];
  const result = calculateAccountBalances(accounts, [tx({ type: "receita", amount: 0.2 })]);
  assert.equal(result.accounts[0].balance, 0.3);
  assert.equal(result.total, 0.3);
});

test("sem contas nem lançamentos devolve zeros", () => {
  assert.deepEqual(calculateAccountBalances([], []), { accounts: [], unassigned: 0, total: 0, mealBalance: 0 });
  assert.deepEqual(calculateAccountBalances(undefined, undefined), { accounts: [], unassigned: 0, total: 0, mealBalance: 0 });
});

test("equivalência: o total sempre bate com calculateSummary em 500 cenários aleatórios", () => {
  let seed = 20261127;
  const random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (list) => list[Math.floor(random() * list.length)];
  for (let round = 0; round < 500; round += 1) {
    const accounts = Array.from({ length: 1 + Math.floor(random() * 4) }, (_, index) => ({ _id: `a${index}`, name: `Conta ${index}`, balance: Math.round((random() - 0.3) * 500000) / 100 }));
    const ids = [...accounts.map((account) => account._id), undefined, null, "desconhecida"];
    const transactions = Array.from({ length: Math.floor(random() * 30) }, () => ({
      type: pick(["receita", "despesa", "divida", "meta"]),
      status: pick(["pago", "pendente"]),
      fundingSource: pick(["cash", "cash", "meal"]),
      description: pick(["Mercado", "Vale-refeição", "Salário"]),
      amount: Math.round(random() * 200000) / 100 + 0.01,
      date: "2026-11-10",
      accountId: pick(ids)
    }));
    const result = calculateAccountBalances(accounts, transactions);
    const summary = calculateSummary(accounts, transactions);
    assert.equal(cents(result.total), cents(summary.balance), `total, rodada ${round}`);
    assert.equal(cents(result.mealBalance), cents(summary.mealBalance), `benefícios, rodada ${round}`);
    const parts = result.accounts.reduce((sum, account) => sum + cents(account.balance), 0) + cents(result.unassigned);
    assert.equal(parts, cents(result.total), `soma das partes, rodada ${round}`);
  }
});

import { defaultAccountId, accountOptions } from "./account-balances.js";

const acct = (id, name, extra = {}) => ({ _id: id, name, balance: 0, archived: false, ...extra });

test("a conta padrão é a principal ativa; sem ela, a primeira ativa (mesma regra do backend)", () => {
  assert.equal(defaultAccountId([acct("2", "Nubank"), acct("1", "Conta principal")]), "1");
  assert.equal(defaultAccountId([acct("2", "Nubank"), acct("3", "Conta conjunta")]), "3");
  assert.equal(defaultAccountId([acct("2", "Nubank"), acct("3", "Santander")]), "2");
  assert.equal(defaultAccountId([acct("1", "Conta principal", { archived: true }), acct("2", "Nubank")]), "2");
});

test("sem contas ativas não há conta padrão", () => {
  assert.equal(defaultAccountId([]), "");
  assert.equal(defaultAccountId(undefined), "");
  assert.equal(defaultAccountId([acct("1", "Velha", { archived: true })]), "");
});

test("as opções do lançamento são as contas ativas; a conta atual arquivada continua aparecendo", () => {
  const list = [acct("1", "Conta principal"), acct("2", "Nubank"), acct("3", "Velha", { archived: true })];
  assert.deepEqual(accountOptions(list).map((item) => item.id), ["1", "2"]);
  assert.deepEqual(accountOptions(list, "3").map((item) => [item.id, item.archived]), [["1", false], ["2", false], ["3", true]]);
  assert.deepEqual(accountOptions(list, "2").map((item) => item.id), ["1", "2"]);
  assert.deepEqual(accountOptions(undefined), []);
});
