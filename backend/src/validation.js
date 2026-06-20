export const MAX_MONEY = 1_000_000_000_000;

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
    this.status = 400;
  }
}

export function requiredText(value, label, maxLength) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new InputError(`${label} é obrigatório.`);
  if (normalized.length > maxLength) throw new InputError(`${label} deve ter até ${maxLength} caracteres.`);
  return normalized;
}

export function optionalText(value, fallback, maxLength) {
  const normalized = String(value ?? "").trim() || fallback;
  if (normalized.length > maxLength) throw new InputError(`Texto deve ter até ${maxLength} caracteres.`);
  return normalized;
}

export function emailAddress(value) {
  const normalized = requiredText(value, "E-mail", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new InputError("Informe um e-mail válido.");
  return normalized;
}

export function moneyValue(value, { label = "Valor", min = -MAX_MONEY, max = MAX_MONEY } = {}) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < min || normalized > max) throw new InputError(`Informe um ${label.toLowerCase()} válido.`);
  return normalized;
}

export function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new InputError(`${label} inválido.`);
  return value;
}

export function isoDate(value) {
  const normalized = requiredText(value, "Data", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new InputError("Informe uma data válida.");
  const [year, month, day] = normalized.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new InputError("Informe uma data válida.");
  return normalized;
}
