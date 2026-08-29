export function addMonthsToIsoDate(value, months) {
  const [year, month, day] = value.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

export function splitInstallmentAmounts(totalAmount, count) {
  const totalCents = Math.round(Number(totalAmount) * 100);
  const baseCents = Math.floor(totalCents / count);
  const remainder = totalCents - (baseCents * count);
  return Array.from({ length: count }, (_, index) => (baseCents + (index < remainder ? 1 : 0)) / 100);
}
