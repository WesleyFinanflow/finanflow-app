import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { DebtPlan, registerDebtPlanRoutes } from "./debt-plan.js";
let mongo, server, base;
const uid = () => new mongoose.Types.ObjectId();
const alice = uid(), bob = uid(), outsider = uid(), individual = uid(), couple = uid(), other = uid();
const User = mongoose.models.User || mongoose.model("User", new mongoose.Schema({ name: String }));
const Space = mongoose.model("TestSpace", new mongoose.Schema({ type: String, ownerId: mongoose.Schema.Types.ObjectId, reserve: Number }));
const Member = mongoose.model("TestMember", new mongoose.Schema({ spaceId: mongoose.Schema.Types.ObjectId, userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" } }));
const Account = mongoose.model("TestAccount", new mongoose.Schema({ spaceId: mongoose.Schema.Types.ObjectId, balance: Number }));
const Transaction = mongoose.model("TestTransaction", new mongoose.Schema({ spaceId: mongoose.Schema.Types.ObjectId, type: String, description: String, amount: Number, status: String, date: String, createdBy: mongoose.Schema.Types.ObjectId }));
const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });
before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await User.create([{ _id: alice, name: "Alice" }, { _id: bob, name: "Bob" }, { _id: outsider, name: "Outsider" }]);
  await Space.create([{ _id: individual, type: "individual", ownerId: alice, reserve: 100 }, { _id: couple, type: "couple", ownerId: alice, reserve: 100 }, { _id: other, type: "individual", ownerId: outsider, reserve: 0 }]);
  await Member.create([{ spaceId: individual, userId: alice }, { spaceId: couple, userId: alice }, { spaceId: couple, userId: bob }, { spaceId: other, userId: outsider }]);
  await Account.create({ spaceId: individual, balance: 1000 });
  await Transaction.create([{ spaceId: individual, type: "receita", amount: 1000, status: "pago", date, createdBy: alice }, { spaceId: individual, type: "divida", description: "Private card", amount: 123.45, status: "pendente", date, createdBy: alice }]);
  const app = express(); app.use(express.json());
  registerDebtPlanRoutes(app, { Space, Member, Account, Transaction, auth: (req, res, next) => { if (!req.headers["x-user"]) return res.sendStatus(401); req.user = { _id: req.headers["x-user"] }; next(); } });
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ message: err.message }));
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve)); base = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 180000 });
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await mongo?.stop(); });
async function call(space, path = "/debt-plan", user = alice, body, method = "POST") {
  const result = await fetch(`${base}/api/spaces/${space}${path}`, { method: body ? method : "GET", headers: { "Content-Type": "application/json", ...(user ? { "x-user": String(user) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: result.status, body: await result.json().catch(() => null) };
}
const input = (extra = {}) => ({ name: "Shared loan", originalBalance: "1000", currentBalance: "1000", minimumPayment: "100", dueDate: date, interestRateMonthly: "2", shared: true, ...extra });
test("HTTP denies unauthenticated, non-member, malformed space and private access by spouse", async () => {
  assert.equal((await call(individual, "/debt-plan", null)).status, 401);
  assert.equal((await call(individual, "/debt-plan", bob)).status, 403);
  assert.equal((await call(couple, "/debt-plan", outsider)).status, 403);
  assert.equal((await call("bad-id")).status, 400);
});
test("individual reuses private source; couple never receives it", async () => {
  const result = await call(individual); assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.debts[0].name, "Private card"); assert.equal(result.body.summary.remaining, 12345);
  const shared = await call(couple, "/debt-plan", bob);
  assert.equal(shared.status, 200); assert.equal(shared.body.debts.length, 0);
});
test("shared CRUD persists negotiation, recalculates and keeps balances unchanged", async () => {
  const transactions = JSON.stringify(await Transaction.find().lean()), accounts = JSON.stringify(await Account.find().lean());
  let result = await call(couple, "/debts", alice, input({ revision: 0 }));
  assert.equal(result.status, 200, JSON.stringify(result.body)); const id = result.body.debts[0].id;
  result = await call(couple, `/debts/${id}/negotiate`, bob, { revision: result.body.revision, currentBalance: "800", minimumPayment: "200", dueDate: date, interestRateMonthly: "0", negotiatedAt: date, remainingInstallments: 4 });
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.debts[0].negotiations.length, 1); assert.equal(result.body.summary.negotiatedDiscount, 20000);
  // No amount was manually supplied for this isolated couple plan, so there is
  // no invented payment capacity or payoff date.
  assert.equal(result.body.simulation.monthsRemaining, null);
  const updated = await call(couple, "/debt-plan/recalculate", bob, {});
  assert.equal(updated.body.summary.remaining, 80000);
  result = await call(couple, `/debts/${id}/mark-paid`, bob, { revision: result.body.revision });
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.status, "COMPLETED"); assert.equal(result.body.debts[0].negotiations.length, 1);
  assert.equal(JSON.stringify(await Transaction.find().lean()), transactions); assert.equal(JSON.stringify(await Account.find().lean()), accounts);
  assert.equal(await DebtPlan.countDocuments({ spaceId: couple }), 1);
});
test("HTTP refuses invalid owner, revision conflict and extra beyond protected capacity", async () => {
  const current = (await call(couple)).body;
  assert.equal((await call(couple, "/debts", alice, input({ revision: current.revision, ownerUserId: String(outsider) }))).status, 400);
  assert.equal((await call(couple, "/debts", alice, input({ revision: 999 }))).status, 409);
  assert.equal((await call(couple, "/debt-plan", alice, { revision: current.revision, strategy: "snowball", monthlyExtraAmount: "1" }, "PUT")).status, 400);
});
test("person-specific couple debts can be viewed but only changed by responsible person", async () => {
  let current = (await call(couple)).body;
  const created = await call(couple, "/debts", alice, input({ revision: current.revision, shared: false }));
  const id = created.body.debts.find(d => !d.shared).id;
  assert.equal((await call(couple, `/debts/${id}/mark-paid`, bob, { revision: created.body.revision })).status, 400);
  assert.equal((await call(other, `/debts/${id}/mark-paid`, outsider, { revision: 0 })).status, 400);
  current = (await call(couple)).body; assert.ok(current.debts.find(d => d.id === id).currentBalance > 0);
});
