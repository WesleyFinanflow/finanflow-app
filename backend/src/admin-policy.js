export function effectiveRole(user, adminEmails = new Set()) {
  return adminEmails.has(String(user?.email || "").toLowerCase()) ? "SUPER_ADMIN" : user?.role || "USER";
}
export const canAccessAdmin = (role) => ["ADMIN", "SUPER_ADMIN"].includes(role);
export const canAccessSuperAdmin = (role) => role === "SUPER_ADMIN";
export const trialExpired = (user, now = new Date()) => user?.trialStatus === "ACTIVE" && Boolean(user?.trialEndsAt) && new Date(user.trialEndsAt) <= now;
