import test from "node:test";
import assert from "node:assert/strict";
import { debtMarkers, PRIORITY_WEIGHTS } from "./debt-config.js";
import { orderDebts } from "./debt-engine.js";
const today = "2026-09-14";
const debt = (id, values = {}) => ({ id, name: id, originalBalance: 100000, currentBalance: 100000, minimumPayment: 10000, dueDate: "2026-09-20", originalDueDate: "2026-09-20", interestRateMonthly: null, status: "ACTIVE", ...values });
test("situation markers remain independent and never infer bureau facts", () => {
  const overdue = debt("late", { originalDueDate: "2026-08-01" });
  assert.equal(debtMarkers(overdue, today).isOverdue, true);
  assert.equal(debtMarkers(overdue, today).isNegativeListed, false);
  const listed = debt("listed", { status: "NEGATIVE_LISTED", negativeListingActive: "YES", originalDueDate: "2026-08-01" });
  assert.equal(debtMarkers(listed, today).isOverdue, true); assert.equal(debtMarkers(listed, today).isNegativeListed, true);
  assert.equal(debtMarkers(debt("unknown", { status: "NEGATIVE_LISTED", negativeListingActive: "NO" }), today).isNegativeListed, false);
});
test("protest, active debt and old debt are user-declared or informative", () => {
  assert.equal(debtMarkers(debt("protest", { protestActive: "YES" }), today).isProtested, true);
  assert.equal(debtMarkers(debt("active", { activeDebtRegistered: "YES" }), today).isActiveDebt, true);
  const old = debt("old", { originalDueDate: "2020-09-01", negativeListingActive: "NO" });
  assert.equal(debtMarkers(old, today).isOldDebt, true); assert.equal(old.currentBalance, 100000);
});
test("recommended priority gives declared critical markers higher weight and excludes paid", () => {
  const ordinary = debt("ordinary", { interestRateMonthly: 1 });
  const protested = debt("protested", { protestActive: "YES" });
  const active = debt("active", { activeDebtRegistered: "YES" });
  const paid = debt("paid", { currentBalance: 0, status: "PAID" });
  const ordered = orderDebts([ordinary, protested, active, paid], "recommended", today, 20000);
  assert.ok(["protested", "active"].includes(ordered[0].id)); assert.equal(ordered.some(d => d.id === "paid"), false);
  assert.equal(PRIORITY_WEIGHTS.version, 2);
});
