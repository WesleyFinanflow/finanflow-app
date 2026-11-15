import { InputError } from "./validation.js";

export function userSearch(query = {}) {
  const filter = {}, q = typeof query.q === "string" ? query.q.trim() : "";
  if (q.length > 120) throw new InputError("A pesquisa deve ter até 120 caracteres.");
  if (q) { const text = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); filter.$or = [{ name: { $regex: text, $options: "i" } }, { email: { $regex: text, $options: "i" } }]; }
  if (["active", "blocked", "trial"].includes(query.status)) filter.accessStatus = query.status;
  if (["FREE", "PLUS", "PREMIUM"].includes(query.plan)) filter.planCode = query.plan;
  const principals = String(process.env.ADMIN_EMAILS || "").toLowerCase().split(",").map(x => x.trim()).filter(Boolean);
  if (query.role === "SUPER_ADMIN") filter.$and = [{ $or: [{ role: "SUPER_ADMIN" }, { email: { $in: principals } }] }];
  if (query.role === "ADMIN") { filter.role = "ADMIN"; filter.email = { $nin: principals }; }
  if (query.role === "USER") { filter.role = { $nin: ["ADMIN", "SUPER_ADMIN"] }; filter.email = { $nin: principals }; }
  const sort = { name: { name: 1, _id: 1 }, old: { createdAt: 1, _id: 1 }, access: { lastLoginAt: -1, _id: -1 } }[query.sort] || { createdAt: -1, _id: -1 };
  return { filter, sort };
}
