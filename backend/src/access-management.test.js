import test from "node:test";
import assert from "node:assert/strict";
import { extendTrial, grantManualPlan, subscriptionPayload } from "./access-management.js";
import { userSearch } from "./admin-search.js";

test("trial extension uses current expiry or now and rejects invalid days",()=>{
  const now=new Date("2026-11-15T12:00:00Z");
  const u={trialEndsAt:new Date("2026-12-01T12:00:00Z")};extendTrial(u,{days:3},now);assert.equal(u.trialEndsAt.toISOString(),"2026-12-04T12:00:00.000Z");
  const expired={trialEndsAt:new Date(0)};extendTrial(expired,{days:3},now);assert.equal(expired.trialEndsAt.toISOString(),"2026-11-18T12:00:00.000Z");
  for(const days of [0,-1,366,1.5,"bad"])assert.throws(()=>extendTrial({}, {days},now));
  assert.throws(()=>extendTrial({}, {endsAt:"2026-02-30"},now));
});
test("courtesy converts trial, removes expiry and never changes role",()=>{
  const user={role:"USER",trialStatus:"ACTIVE",trialEndsAt:new Date(),accessStatus:"trial"};grantManualPlan(user,"PREMIUM");
  assert.equal(user.role,"USER");assert.equal(user.accessOrigin,"COURTESY");assert.equal(user.trialStatus,"CONVERTED");assert.equal(user.trialEndsAt,undefined);assert.equal(user.accessStatus,"active");
  assert.throws(()=>grantManualPlan(user,"UNKNOWN"));
});
test("active subscription needs future end; expired records can be cancelled",()=>{
  const now=new Date("2026-11-15T12:00:00Z"),current={userId:"test",planCode:"PLUS",startsAt:"2026-11-01",endsAt:"2026-11-10",status:"MANUAL"};
  assert.throws(()=>subscriptionPayload({},current,now));assert.equal(subscriptionPayload({status:"CANCELLED"},current,now).status,"CANCELLED");
});
test("directory search escapes regex metacharacters",()=>{
  const {filter}=userSearch({q:".*[test]"});const pattern=filter.$or[0].name.$regex;
  assert.equal(new RegExp(pattern).test("anything"),false);assert.equal(new RegExp(pattern).test(".*[test]"),true);
});
