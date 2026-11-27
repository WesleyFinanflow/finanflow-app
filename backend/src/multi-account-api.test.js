import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

// Multiconta (etapa 2): testa as rotas reais de contas com a chave desligada e ligada.
let mongo, server, base, db, alice, bob, aliceSpace, bobSpace, logs = "";
const origin = "http://localhost:5173", password = "Test-only-secret-947!";
const today = new Date().toISOString().slice(0, 10);

async function request(path, cookie, body, method = body ? "POST" : "GET") {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), Origin: origin }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json().catch(() => null), cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
const setFlag = (active, audience = "ALL") => db.collection("featureflags").updateOne({ key: "multiconta" }, { $set: { key: "multiconta", name: "Multiconta", active, audience } }, { upsert: true });
const accountsOf = async (user, space) => (await request(`/api/spaces/${space}/accounts`, user.cookie)).body.accounts;
const createAccount = (user, space, body) => request(`/api/spaces/${space}/accounts`, user.cookie, body);
const tx = (extra = {}) => ({ type: "despesa", description: "Mercado", amount: 50, date: today, category: "Moradia", status: "pago", ...extra });

before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri("multiconta"));
  db = mongoose.connection;
  const portProbe = createServer().listen(0, "127.0.0.1"); await once(portProbe, "listening");
  const port = portProbe.address().port; await new Promise((resolve) => portProbe.close(resolve)); base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["src/server.js"], { env: { ...process.env, PORT: String(port), MONGODB_URI: mongo.getUri("multiconta"), JWT_SECRET: "test-only-session-key-482fa7440037d9e7", ADMIN_EMAILS: "admin-nobody@example.test", CORS_ORIGIN: origin, NODE_ENV: "production", RESEND_API_KEY: "", EMAIL_FROM: "", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk) => logs += chunk); server.stderr.on("data", (chunk) => logs += chunk);
  let ready = false;
  for (let i = 0; i < 120; i += 1) { try { if ((await request("/api/ready")).status === 200) { ready = true; break; } } catch { /* ainda subindo */ } await new Promise((resolve) => setTimeout(resolve, 100)); }
  assert.ok(ready, logs);
  const fixtures = [];
  for (const email of ["alice@example.test", "bob@example.test"]) {
    const r = await request("/api/auth/register", null, { name: email.split("@")[0], email, password, acceptLegal: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    fixtures.push({ ...r.body.user, cookie: r.cookie });
  }
  [alice, bob] = fixtures;
  aliceSpace = (await request("/api/spaces", alice.cookie)).body.spaces.find((space) => space.type === "individual")._id;
  bobSpace = (await request("/api/spaces", bob.cookie)).body.spaces.find((space) => space.type === "individual")._id;
}, { timeout: 180000 });
after(async () => { if (server && server.exitCode === null) { server.kill(); await once(server, "exit"); } await mongoose.disconnect(); await mongo?.stop(); });

test("a chave Multiconta nasce desligada e o comportamento antigo continua igual", async () => {
  const flag = await db.collection("featureflags").findOne({ key: "multiconta" });
  assert.ok(flag, "a chave multiconta deveria ser cadastrada na partida do servidor");
  assert.equal(flag.active, false);
  const created = await createAccount(alice, aliceSpace, { name: "Nubank", balance: 100 });
  assert.equal(created.status, 409, JSON.stringify(created.body));
  assert.match(created.body.message, /conta principal automática/);
  assert.equal((await accountsOf(alice, aliceSpace)).length, 1);
});

test("ligada: cria contas e o sistema NÃO as junta nem as apaga", async () => {
  await setFlag(true);
  const nubank = await createAccount(alice, aliceSpace, { name: "Nubank", balance: 100 });
  assert.equal(nubank.status, 201, JSON.stringify(nubank.body));
  assert.equal(nubank.body.account.userCreated, true);
  assert.equal(nubank.body.account.balance, 100);
  assert.equal((await createAccount(alice, aliceSpace, { name: "Santander", balance: 250.5 })).status, 201);
  assert.equal((await accountsOf(alice, aliceSpace)).length, 3);
  assert.equal((await accountsOf(alice, aliceSpace)).length, 3, "a segunda leitura não pode juntar contas");
  assert.equal((await request(`/api/spaces/${aliceSpace}/transactions`, alice.cookie, tx({ requestId: "mc-default" }))).status, 201);
  assert.equal((await accountsOf(alice, aliceSpace)).length, 3, "criar lançamento não pode juntar contas");
});

test("a identidade vem do servidor: espaço, dono e marca interna enviados pelo cliente são ignorados", async () => {
  const result = await createAccount(alice, aliceSpace, { name: "Inter", spaceId: bobSpace, userCreated: false, _id: "507f1f77bcf86cd799439011" });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(String(result.body.account.spaceId), String(aliceSpace));
  assert.equal(result.body.account.userCreated, true);
  assert.notEqual(result.body.account._id, "507f1f77bcf86cd799439011");
  assert.equal((await accountsOf(bob, bobSpace)).length, 1, "a conta não pode aparecer no espaço de outra pessoa");
});

test("nome repetido é recusado e o limite é de 6 contas ativas", async () => {
  const duplicate = await createAccount(alice, aliceSpace, { name: " nubank " });
  assert.equal(duplicate.status, 409);
  assert.equal((await createAccount(alice, aliceSpace, { name: "Mercado Pago" })).status, 201);
  assert.equal((await createAccount(alice, aliceSpace, { name: "C6" })).status, 201);
  assert.equal((await accountsOf(alice, aliceSpace)).length, 6);
  const seventh = await createAccount(alice, aliceSpace, { name: "Sétima" });
  assert.equal(seventh.status, 409);
  assert.match(seventh.body.message, /6/);
});

test("entradas inválidas viram erro 400", async () => {
  for (const body of [{}, { name: "" }, { name: { $ne: 1 } }, { name: "X", balance: "abc" }]) {
    const result = await createAccount(bob, bobSpace, body);
    assert.equal(result.status, 400, JSON.stringify(body));
  }
});

test("o lançamento vai para a conta escolhida; conta inexistente é recusada", async () => {
  const accounts = await accountsOf(alice, aliceSpace);
  const nubank = accounts.find((account) => account.name === "Nubank");
  const principal = accounts.find((account) => account.name === "Conta principal");
  const chosen = await request(`/api/spaces/${aliceSpace}/transactions`, alice.cookie, tx({ accountId: nubank._id, description: "No Nubank", requestId: "mc-nubank" }));
  assert.equal(chosen.status, 201, JSON.stringify(chosen.body));
  assert.equal(String(chosen.body.transaction.accountId), String(nubank._id));
  const fallback = await request(`/api/spaces/${aliceSpace}/transactions`, alice.cookie, tx({ description: "Sem conta", requestId: "mc-fallback" }));
  assert.equal(String(fallback.body.transaction.accountId), String(principal._id));
  const unknown = await request(`/api/spaces/${aliceSpace}/transactions`, alice.cookie, tx({ accountId: new mongoose.Types.ObjectId().toString(), requestId: "mc-unknown" }));
  assert.equal(unknown.status, 400);
  const edited = await request(`/api/spaces/${aliceSpace}/transactions/${chosen.body.transaction._id}`, alice.cookie, tx({ accountId: principal._id, description: "Movido" }), "PUT");
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(String(edited.body.transaction.accountId), String(principal._id));
});

test("conta arquivada não recebe lançamentos novos e sempre sobra uma ativa", async () => {
  const accounts = await accountsOf(alice, aliceSpace);
  const santander = accounts.find((account) => account.name === "Santander");
  const archived = await request(`/api/spaces/${aliceSpace}/accounts/${santander._id}`, alice.cookie, { archived: true }, "PUT");
  assert.equal(archived.status, 200, JSON.stringify(archived.body));
  assert.equal(archived.body.account.archived, true);
  const rejected = await request(`/api/spaces/${aliceSpace}/transactions`, alice.cookie, tx({ accountId: santander._id, requestId: "mc-archived" }));
  assert.equal(rejected.status, 400);
  for (const account of accounts.filter((item) => item.name !== "Conta principal" && item.name !== "Santander")) {
    assert.equal((await request(`/api/spaces/${aliceSpace}/accounts/${account._id}`, alice.cookie, { archived: true }, "PUT")).status, 200);
  }
  const principal = accounts.find((account) => account.name === "Conta principal");
  const last = await request(`/api/spaces/${aliceSpace}/accounts/${principal._id}`, alice.cookie, { archived: true }, "PUT");
  assert.equal(last.status, 409, "não pode arquivar a última conta ativa");
  const reactivated = await request(`/api/spaces/${aliceSpace}/accounts/${santander._id}`, alice.cookie, { archived: false }, "PUT");
  assert.equal(reactivated.status, 200, JSON.stringify(reactivated.body));
});

test("excluir exige o nome da conta, copia tudo para a auditoria antes e apaga os lançamentos dela", async () => {
  const accounts = await accountsOf(alice, aliceSpace);
  const nubank = accounts.find((account) => account.name === "Nubank");
  const path = `/api/spaces/${aliceSpace}/accounts/${nubank._id}`;
  await request(path, alice.cookie, { archived: false }, "PUT");
  await request(`/api/spaces/${aliceSpace}/transactions`, alice.cookie, tx({ accountId: nubank._id, description: "Vai sumir", requestId: "mc-delete" }));
  assert.equal((await request(path, alice.cookie, {}, "DELETE")).status, 400);
  assert.equal((await request(path, alice.cookie, { confirmName: "Outra conta" }, "DELETE")).status, 400);
  assert.equal((await accountsOf(alice, aliceSpace)).some((account) => account.name === "Nubank"), true, "nada pode ser apagado sem confirmação");
  const removed = await request(path, alice.cookie, { confirmName: "nubank" }, "DELETE");
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.ok(removed.body.removedTransactions >= 1);
  assert.equal((await accountsOf(alice, aliceSpace)).some((account) => account.name === "Nubank"), false);
  const leftover = await db.collection("transactions").countDocuments({ accountId: new mongoose.Types.ObjectId(nubank._id) });
  assert.equal(leftover, 0);
  const audit = await db.collection("auditlogs").findOne({ entityType: "account", action: "delete", entityId: String(nubank._id) });
  assert.ok(audit, "a exclusão precisa ficar na auditoria");
  assert.equal(audit.before.account.name, "Nubank");
  assert.ok(audit.before.transactions.length >= 1);
  assert.ok(audit.before.transactions.some((item) => item.description === "Vai sumir"));
});

test("uma pessoa nunca mexe nas contas de outra", async () => {
  const accounts = await accountsOf(alice, aliceSpace);
  const target = accounts[0];
  assert.equal((await request(`/api/spaces/${aliceSpace}/accounts/${target._id}`, bob.cookie, { name: "Invadida" }, "PUT")).status, 403);
  assert.equal((await request(`/api/spaces/${bobSpace}/accounts/${target._id}`, bob.cookie, { name: "Invadida" }, "PUT")).status, 404);
  assert.equal((await request(`/api/spaces/${bobSpace}/accounts/${target._id}`, bob.cookie, { confirmName: target.name }, "DELETE")).status, 404);
  assert.equal((await accountsOf(alice, aliceSpace)).find((account) => account._id === target._id).name, target.name);
});

test("desligar a chave depois de usar não apaga nenhuma conta criada", async () => {
  const before = await db.collection("accounts").countDocuments({ spaceId: new mongoose.Types.ObjectId(aliceSpace), userCreated: true });
  assert.ok(before >= 1);
  await setFlag(false);
  const legacy = await accountsOf(alice, aliceSpace);
  assert.equal(legacy.length, 1, "no modo antigo só a conta principal aparece");
  assert.equal(await db.collection("accounts").countDocuments({ spaceId: new mongoose.Types.ObjectId(aliceSpace), userCreated: true }), before, "o modo antigo não pode apagar contas do recurso");
  await setFlag(true);
  assert.ok((await accountsOf(alice, aliceSpace)).length > 1, "ao religar, as contas voltam");
});

test("público ADMINS: usuário comum não recebe o recurso", async () => {
  await setFlag(true, "ADMINS");
  assert.equal((await createAccount(bob, bobSpace, { name: "Teste" })).status, 409, "usuário comum segue no modo antigo");
  await setFlag(true, "ALL");
});
