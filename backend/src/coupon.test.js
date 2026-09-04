import test from "node:test";
import assert from "node:assert/strict";
import { couponStatus } from "./admin.js";

const now = new Date("2026-09-04T12:00:00.000Z");

test("calcula todos os estados automáticos do cupom", () => {
  assert.equal(couponStatus({ active:true, startsAt:"2026-09-05", usageCount:0 }, now), "SCHEDULED");
  assert.equal(couponStatus({ active:true, startsAt:"2026-09-01", endsAt:"2026-09-10", usageCount:0 }, now), "ACTIVE");
  assert.equal(couponStatus({ active:true, maxUses:2, usageCount:2 }, now), "EXHAUSTED");
  assert.equal(couponStatus({ active:true, endsAt:"2026-09-03", usageCount:0 }, now), "EXPIRED");
  assert.equal(couponStatus({ active:false, usageCount:0 }, now), "DISABLED");
});

test("mantém compatibilidade com o limite antigo", () => {
  assert.equal(couponStatus({ active:true, usageLimit:3, usageCount:3 }, now), "EXHAUSTED");
});
