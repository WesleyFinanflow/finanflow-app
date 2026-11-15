import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import crypto from "node:crypto";

let mongo, server, base, users, owner, alice, bob, admin, logs = "";
const origin = "http://localhost:5173", password = "Test-only-secret-947!";
async function request(path, cookie, body, method = body ? "POST" : "GET", requestOrigin = origin) {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(requestOrigin ? { Origin: requestOrigin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json(), cookie: r.headers.get("set-cookie")?.split(";")[0], headers: r.headers };
}
before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri("security"));
  users = mongoose.connection.collection("users");
  const portProbe = createServer().listen(0, "127.0.0.1"); await once(portProbe, "listening");
  const port = portProbe.address().port; await new Promise(r => portProbe.close(r)); base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["src/server.js"], { env: { ...process.env, PORT: String(port), MONGODB_URI: mongo.getUri("security"), JWT_SECRET: "test-only-session-key-482fa7440037d9e7", ADMIN_EMAILS: "owner@example.test", CORS_ORIGIN: origin, NODE_ENV: "production", RESEND_API_KEY: "", EMAIL_FROM: "", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", x => logs += x); server.stderr.on("data", x => logs += x);
  let ready = false;
  for (let i = 0; i < 120; i++) { try { if ((await request("/api/ready")).status === 200) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 100)); }
  assert.ok(ready, logs);
  const fixtures = [];
  for (const email of ["owner@example.test", "alice@example.test", "bob@example.test", "admin@example.test"]) {
    const r = await request("/api/auth/register", null, { name: email.split("@")[0], email, password, acceptLegal: true, role: "SUPER_ADMIN" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.token, undefined); fixtures.push({ ...r.body.user, cookie: r.cookie });
  }
  [owner, alice, bob, admin] = fixtures;
  await users.updateOne({ email: admin.email }, { $set: { role: "ADMIN", trialEndsAt: new Date(0) } });
}, { timeout: 180000 });
after(async () => { if (server && server.exitCode === null) { server.kill(); await once(server, "exit"); } await mongoose.disconnect(); await mongo?.stop(); });

test("HttpOnly session, CSRF, reload and logout", async () => {
  const login = await request("/api/auth/login", null, { email: alice.email, password });
  assert.equal(login.status, 200); assert.equal(login.body.token, undefined);
  assert.match(login.headers.get("set-cookie"), /HttpOnly/i); assert.match(login.headers.get("set-cookie"), /; Secure/i); assert.match(login.cookie, /^__Host-finanflow_session=/); assert.match(login.headers.get("set-cookie"), /SameSite=Lax/i);
  assert.equal((await request("/api/me", login.cookie)).status, 200);
  assert.equal((await request("/api/support", login.cookie, { subject: "Test", message: "Test" }, "POST", null)).status, 403);
  assert.equal((await request("/api/support", login.cookie, { subject: "Test", message: "Test" }, "POST", "https://evil.example")).status, 403);
  const logout = await request("/api/auth/logout", login.cookie, {});
  assert.equal(logout.status, 200); assert.match(logout.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/i);
  assert.equal((await request("/api/me", login.cookie)).status, 401);
  assert.equal((await request("/api/me", alice.cookie)).status, 200);
});
test("invalid support category and malformed admin ID return 400; server survives", async () => {
  assert.equal((await request("/api/support", alice.cookie, { subject: "Test", message: "Test", category: "INVALID" })).status, 400);
  assert.equal((await request("/api/admin/users/not-an-id", owner.cookie)).status, 400);
  assert.equal((await request("/api/health")).status, 200); assert.equal(server.exitCode, null);
});
test("role separation and protection of primary administrator in both routes", async () => {
  assert.equal(alice.role, "USER");
  assert.equal((await request("/api/admin/bootstrap", alice.cookie)).status, 403);
  assert.equal((await request("/api/admin/bootstrap", admin.cookie)).status, 200);
  assert.equal((await request("/api/admin/config", admin.cookie, { globalNotice: "test" }, "PATCH")).status, 403);
  for (const path of [`/api/admin/users/${owner.id}`, `/api/admin/users/${owner.id}/access`]) assert.equal((await request(path, admin.cookie, { action: "block" }, "PATCH")).status, 403);
  assert.equal((await request(`/api/admin/users/${owner.id}`, owner.cookie, { action: "block" }, "PATCH")).status, 403);
  assert.equal((await request("/api/me", owner.cookie)).status, 200);
});
test("wrong password on expired trial stays generic; correct password shows expiry", async () => {
  await users.updateOne({ email: bob.email }, { $set: { trialEndsAt: new Date(0) } });
  const wrong = await request("/api/auth/login", null, { email: bob.email, password: "incorrect" });
  assert.equal(wrong.status, 401); assert.equal(wrong.body.message, "E-mail ou senha inválidos.");
  assert.equal((await request("/api/auth/login", null, { email: bob.email, password })).status, 403);
  await users.updateOne({ email: bob.email }, { $set: { trialEndsAt: new Date("2099-01-01") } });
});
test("new weak password rejected; existing short password still authenticates", async () => {
  assert.equal((await request("/api/auth/register", null, { email: "weak@example.test", name: "Weak", password: "123456", acceptLegal: true })).status, 400);
  const bcrypt = await import("bcryptjs");
  await users.updateOne({ email: bob.email }, { $set: { passwordHash: await bcrypt.default.hash("old123", 10) } });
  assert.equal((await request("/api/auth/login", null, { email: bob.email, password: "old123" })).status, 200);
});
test("OAuth exchange is single use, expires, and does not disclose JWT", async () => {
  const code = crypto.randomBytes(32).toString("base64url");
  await users.updateOne({ email: bob.email }, { $set: { oauthExchangeHash: crypto.createHash("sha256").update(code).digest("hex"), oauthExchangeExpiresAt: new Date(Date.now() + 60000) } });
  const attempts = await Promise.all([1, 2].map(() => request("/api/auth/session", null, { code })));
  assert.deepEqual(attempts.map(x => x.status).sort(), [200, 401]);
  assert.equal(attempts.find(x => x.status === 200).body.token, undefined);
});
async function raceCoupon(code, extra, cookies) {
  const r = await request("/api/admin/coupons", owner.cookie, { code, benefitType: "PLUS_DAYS", benefitValue: 1, allowedPlan: "ALL", allowedAudience: "ALL", ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const results = await Promise.all(cookies.map(c => request("/api/coupons/redeem", c, { code })));
  assert.deepEqual(results.map(x => x.status).sort(), [200, 400]);
  const coupon = await mongoose.connection.collection("coupons").findOne({ code });
  assert.equal(coupon.usageCount, 1);
  assert.equal(await mongoose.connection.collection("couponusages").countDocuments({ couponId: coupon._id, status: "SUCCESS" }), 1);
  return coupon;
}
test("concurrent global, per-user and daily coupon limits", async () => {
  await raceCoupon("GLOBAL", { maxUses: 1 }, [alice.cookie, bob.cookie]);
  await raceCoupon("PERUSER", { maxUses: 0, maxUsesPerUser: 1 }, [alice.cookie, alice.cookie]);
  await raceCoupon("DAILY", { maxUses: 0, dailyLimit: 1 }, [alice.cookie, bob.cookie]);
});
test("coupon failure rolls back benefits and usage atomically", async () => {
  const code = "ROLLBACK";
  assert.equal((await request("/api/admin/coupons", owner.cookie, { code, benefitType: "PLUS_DAYS", benefitValue: 1, maxUses: 1, allowedPlan: "ALL", allowedAudience: "ALL" })).status, 201);
  // Invalid persisted name makes the final user save fail after subscription creation.
  await users.updateOne({ email: bob.email }, { $set: { name: "x".repeat(100) } });
  const before = await mongoose.connection.collection("subscriptions").countDocuments();
  assert.equal((await request("/api/coupons/redeem", bob.cookie, { code })).status, 400);
  assert.equal(await mongoose.connection.collection("subscriptions").countDocuments(), before);
  assert.equal((await mongoose.connection.collection("coupons").findOne({ code })).usageCount, 0);
  await users.updateOne({ email: bob.email }, { $set: { name: "bob" } });
});
test("dashboard paginates users while preserving global counts", async () => {
  await users.insertMany(Array.from({ length: 105 }, (_, i) => ({ email: `page${i}@example.test`, name: `Page ${i}`, createdAt: new Date(), role: "USER", accessStatus: "active" })));
  const first = await request("/api/admin/bootstrap?page=1", owner.cookie);
  const second = await request("/api/admin/bootstrap?page=2", owner.cookie);
  assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(second.status, 200);
  assert.equal(first.body.stats.users, 109); assert.equal(second.body.stats.users, 109);
  assert.equal(first.body.users.length, 100); assert.equal(second.body.users.length, 9);
  assert.equal(new Set([...first.body.users, ...second.body.users].map(x => x._id)).size, 109);
});

test("adding trial days preserves existing time; courtesy clears test metadata", async () => {
  let r=await request(`/api/admin/users/${alice.id}`,owner.cookie,{action:"trial",days:30},"PATCH");
  const before=new Date(r.body.user.trialEndsAt);
  r=await request(`/api/admin/users/${alice.id}`,owner.cookie,{action:"trial",days:3},"PATCH");
  assert.equal(Math.round((new Date(r.body.user.trialEndsAt)-before)/86400000),3);
  r=await request(`/api/admin/users/${alice.id}`,owner.cookie,{action:"plan",planCode:"PREMIUM"},"PATCH");
  assert.equal(r.body.user.accessOrigin,"COURTESY");assert.equal(r.body.user.trialStatus,"CONVERTED");assert.equal(r.body.user.trialEndsAt,null);
  assert.equal((await request("/api/me",alice.cookie)).body.user.accessStatus,"active");
  const dashboard=await request("/api/admin/bootstrap?q=alice%40example.test",owner.cookie);
  assert.equal(dashboard.body.users.find(u=>u._id===alice.id).trialStatus,"CONVERTED");
});

test("disabled support, coupons and couple creation are denied at the API", async () => {
  await request("/api/admin/config",owner.cookie,{supportEnabled:false,couponsEnabled:false},"PATCH");
  assert.equal((await request("/api/support",alice.cookie,{subject:"Test",message:"Test"})).status,403);
  assert.equal((await request("/api/coupons/redeem",alice.cookie,{code:"ANY"})).status,403);
  const db=mongoose.connection;
  await db.collection("featureflags").updateOne({key:"modo_casal"},{$set:{active:false}});
  assert.equal((await request("/api/spaces/couple",alice.cookie,{partnerName:"Bob"})).status,403);
  await db.collection("featureflags").updateOne({key:"modo_casal"},{$set:{active:true}});
  await request("/api/admin/config",owner.cookie,{supportEnabled:true,couponsEnabled:true},"PATCH");
});

test("expired subscriptions are rejected or downgraded; courtesy stays permanent",async()=>{
  const past=new Date(Date.now()-86400000);
  assert.equal((await request("/api/admin/subscriptions",owner.cookie,{userId:bob.id,planCode:"PLUS",status:"MANUAL",startsAt:new Date(+past-86400000),endsAt:past})).status,400);
  const created=await request("/api/admin/subscriptions",owner.cookie,{userId:bob.id,planCode:"PLUS",status:"MANUAL",startsAt:new Date(),endsAt:new Date(Date.now()+86400000)});
  assert.equal(created.status,201);
  assert.equal((await request("/api/me",bob.cookie)).body.user.planCode,"PLUS");
  await mongoose.connection.collection("subscriptions").updateMany({userId:new mongoose.Types.ObjectId(bob.id)},{$set:{endsAt:past}});
  assert.equal((await request("/api/me",bob.cookie)).body.user.planCode,"FREE");
  assert.equal((await request("/api/me",alice.cookie)).body.user.planCode,"PREMIUM");
});

test("directory search and full export find a client beyond the first page",async()=>{
  const r=await request("/api/admin/bootstrap?q=page104%40example.test",owner.cookie);
  assert.equal(r.status,200);assert.equal(r.body.pagination.total,1);assert.equal(r.body.users[0].email,"page104@example.test");assert.equal(r.body.stats.users,109);
  const exported=await request("/api/admin/export/users?q=page104%40example.test",owner.cookie);
  assert.equal(exported.body.data.length,1);
});

test("auxiliary admin collections expose a second page instead of truncating",async()=>{
  await mongoose.connection.collection("coupons").insertMany(Array.from({length:205},(_,i)=>({code:`PAGE-COUPON-${i}`,createdAt:new Date(),benefitType:"PLUS_DAYS",benefitValue:1,active:true})));
  const r=await request("/api/admin/bootstrap?section=coupons&page=2",owner.cookie);
  assert.equal(r.status,200);assert.equal(r.body.listPagination.total>=205,true);assert.equal(r.body.listPagination.page,2);assert.equal(r.body.coupons.length>0,true);
  assert.equal(r.body.coupons.length,r.body.listPagination.total-200);
});

test("admin deletion removes private data and sessions while preserving partner shared debt",async()=>{
  const couple=await request("/api/spaces/couple",alice.cookie,{partnerName:"Bob"});assert.equal(couple.status,201);
  assert.equal((await request(`/api/invites/${couple.body.invite.code}/accept`,bob.cookie,{})).status,200);
  const debt=await request(`/api/spaces/${couple.body.space._id}/debts`,alice.cookie,{name:"Shared test",originalBalance:"1000",currentBalance:"1000",minimumPayment:"100",dueDate:"2026-12-01",interestRateMonthly:"0",shared:true,revision:0});assert.equal(debt.status,200,JSON.stringify(debt.body));
  const spaces=await request("/api/spaces",alice.cookie),spaceId=new mongoose.Types.ObjectId(spaces.body.spaces.find(s=>s.type==="individual")._id),uid=new mongoose.Types.ObjectId(alice.id),db=mongoose.connection;
  await db.collection("debtplans").insertOne({spaceId,userId:uid,items:[]});
  await db.collection("backupsnapshots").insertOne({spaceId,createdBy:uid,transactions:[]});
  await db.collection("merchantcategorymaps").insertOne({userId:uid,normalizedName:"test"});
  const removed=await request(`/api/admin/users/${alice.id}`,owner.cookie,null,"DELETE");assert.equal(removed.status,200,JSON.stringify(removed.body));
  for(const [name,filter] of [["debtplans",{spaceId}],["backupsnapshots",{createdBy:uid}],["merchantcategorymaps",{userId:uid}],["sessions",{userId:uid}]])assert.equal(await db.collection(name).countDocuments(filter),0,name);
  const shared=await db.collection("debtplans").findOne({spaceId:new mongoose.Types.ObjectId(couple.body.space._id)});assert.equal(shared.items.length,1);assert.equal(String(shared.items[0].ownerUserId),bob.id);
  assert.equal((await request("/api/me",alice.cookie)).status,401);assert.equal((await request("/api/me",bob.cookie)).status,200);
});

test("self deletion uses the same complete cleanup and principal stays protected",async()=>{
  const spaces=await request("/api/spaces",bob.cookie),spaceId=new mongoose.Types.ObjectId(spaces.body.spaces.find(s=>s.type==="individual")._id),uid=new mongoose.Types.ObjectId(bob.id),db=mongoose.connection;
  await db.collection("debtplans").insertOne({spaceId,userId:uid,items:[]});
  assert.equal((await request("/api/me",bob.cookie,null,"DELETE")).status,200);
  assert.equal(await db.collection("debtplans").countDocuments({spaceId}),0);assert.equal(await db.collection("sessions").countDocuments({userId:uid}),0);
  assert.equal((await request("/api/me",owner.cookie,null,"DELETE")).status,403);
});
