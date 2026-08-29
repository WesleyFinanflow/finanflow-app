export function getCoupleMenuState(coupleSpace) {
  if (!coupleSpace) return { enabled: false, status: "unavailable", subtitle: "Não configurado" };
  if (Number(coupleSpace.memberCount || 0) > 1) return { enabled: true, status: "ready", subtitle: "Espaço compartilhado" };
  return { enabled: false, status: "pending", subtitle: "Convite pendente" };
}
