import test from "node:test";
import assert from "node:assert/strict";
import { canAccessAdmin, canAccessSuperAdmin, effectiveRole, trialExpired } from "./admin-policy.js";
test("USER não acessa rotas administrativas",()=>assert.equal(canAccessAdmin("USER"),false));
test("ADMIN acessa admin, mas não ações de super admin",()=>{assert.equal(canAccessAdmin("ADMIN"),true);assert.equal(canAccessSuperAdmin("ADMIN"),false);});
test("e-mail principal recebe SUPER_ADMIN",()=>assert.equal(effectiveRole({email:"admin@teste.com",role:"USER"},new Set(["admin@teste.com"])),"SUPER_ADMIN"));
test("teste grátis expira pela data real",()=>assert.equal(trialExpired({trialStatus:"ACTIVE",trialEndsAt:"2026-09-01"},new Date("2026-09-03")),true));
