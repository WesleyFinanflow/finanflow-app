export function effectiveRole(user, adminEmails = new Set()) {
  return adminEmails.has(String(user?.email || "").toLowerCase()) ? "SUPER_ADMIN" : user?.role || "USER";
}
export const canAccessAdmin = (role) => ["ADMIN", "SUPER_ADMIN"].includes(role);
export const canAccessSuperAdmin = (role) => role === "SUPER_ADMIN";
export function accessDenied(user, adminEmails = new Set(), now = new Date()) {
  if (adminEmails.has(String(user?.email || "").toLowerCase())) return "";
  if (user?.accessStatus === "blocked") return "Seu acesso foi bloqueado. Entre em contato com o suporte.";
  if (canAccessAdmin(effectiveRole(user, adminEmails))) return "";
  if (user?.accessStatus === "trial" && user.trialEndsAt && new Date(user.trialEndsAt) <= now) return "Seu período de teste terminou. Entre em contato com o suporte para continuar.";
  return "";
}

export function canManageUser(actor, target, adminEmails = new Set()) {
  const actorRole = effectiveRole(actor, adminEmails), targetRole = effectiveRole(target, adminEmails);
  if (adminEmails.has(String(target?.email || "").toLowerCase())) return false;
  if (String(actor?._id) === String(target?._id)) return false;
  return actorRole === "SUPER_ADMIN" || actorRole === "ADMIN" && targetRole === "USER";
}

export const trialExpired = (user, now = new Date()) => user?.trialStatus === "ACTIVE" && Boolean(user?.trialEndsAt) && new Date(user.trialEndsAt) <= now;
