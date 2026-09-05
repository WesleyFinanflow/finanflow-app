const CATEGORY_RULES = [
  { category: "Saúde", words: ["drogasil", "droga raia", "pague menos", "farmacia", "drogaria"] },
  { category: "Alimentação", words: ["supermercado", "mercado", "atacadao", "assai", "carrefour", "sao luiz"] },
  { category: "Transporte", words: ["shell", "petrobras", "ipiranga", "posto", "combustivel"] },
  { category: "Moradia", words: ["energia", "enel", "coelce", "agua", "cagece", "internet", "telecom", "boleto"] },
];

export function normalizeReceiptText(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function brlToNumber(value) {
  const normalized = String(value).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function isoDate(value) {
  const match = String(value).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return "";
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  const date = new Date(`${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? "" : `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function findAmount(text) {
  const prioritized = [...text.matchAll(/(?:total(?:\s+a\s+pagar)?|valor(?:\s+pago|\s+da\s+transa[cç][aã]o)?)[^\d]{0,18}(?:r\$\s*)?(\d{1,9}(?:\.\d{3})*,\d{2})/gi)];
  if (prioritized.length) return brlToNumber(prioritized.at(-1)[1]);
  const values = [...text.matchAll(/(?:r\$\s*)?(\d{1,9}(?:\.\d{3})*,\d{2})/gi)].map((match) => brlToNumber(match[1])).filter(Boolean);
  return values.length ? Math.max(...values) : null;
}

function findMerchant(lines, normalized, isPix) {
  if (isPix) {
    const target = lines.find((line, index) => /destinat[aá]rio|favorecido|recebedor/i.test(line) && (line.split(/[:\-]/)[1]?.trim() || lines[index + 1]));
    if (target) return target.split(/[:\-]/).slice(1).join(" ").trim() || lines[lines.indexOf(target) + 1]?.trim() || "";
  }
  const ignored = /^(cupom|comprovante|documento|nota fiscal|cnpj|cpf|total|valor|data|hora|pix|banco|institui[cç][aã]o)/i;
  return lines.find((line) => line.length >= 3 && line.length <= 80 && /[a-zá-ú]/i.test(line) && !ignored.test(line))?.trim() || "";
}

export function parseReceiptText(text, learnedCategories = {}) {
  const raw = String(text || "").replace(/\r/g, "");
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const normalized = normalizeReceiptText(raw);
  const isPix = /\bpix\b|transferencia pix/.test(normalized);
  const description = findMerchant(lines, normalized, isPix);
  const learned = learnedCategories[normalizeReceiptText(description)];
  const rule = CATEGORY_RULES.find((entry) => entry.words.some((word) => normalized.includes(normalizeReceiptText(word))));
  const dateMatch = raw.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/)?.[0] || "";
  const time = raw.match(/(?:^|\s)([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:\s|$)/m)?.[0]?.trim().slice(0, 5) || "";
  const cpfCnpj = raw.match(/(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/)?.[0] || "";
  const institution = lines.find((line) => /banco|nubank|bradesco|itau|caixa|santander|inter\b/i.test(line)) || "";
  const paymentMethod = isPix ? "Pix" : /cart[aã]o.*cr[eé]dito|cr[eé]dito/i.test(raw) ? "Cartão de crédito" : /cart[aã]o.*d[eé]bito|d[eé]bito/i.test(raw) ? "Cartão de débito" : /dinheiro/i.test(raw) ? "Dinheiro" : "Não identificado";
  const amount = findAmount(raw);
  const confidence = { description: description ? "medium" : "low", amount: amount ? "high" : "low", date: dateMatch ? "high" : "low", category: learned || rule ? "medium" : "low" };
  return { type: "despesa", description, amount, date: isoDate(dateMatch), time, category: learned || rule?.category || "", paymentMethod, cpfCnpj, institution, transactionId: isPix ? (raw.match(/(?:id|identificador)(?:\s+da\s+transa[cç][aã]o)?\s*[:\-]?\s*([A-Z0-9-]{8,})/i)?.[1] || "") : "", isPix, confidence };
}

export function findSimilarTransaction(transactions, candidate, spaceMode = "") {
  const amount = Number(candidate.amount || 0);
  const targetTime = candidate.time ? Number(candidate.time.slice(0, 2)) * 60 + Number(candidate.time.slice(3, 5)) : null;
  return transactions.find((item) => {
    if (Math.abs(Number(item.amount || 0) - amount) > 0.01 || item.date !== candidate.date) return false;
    const similarName = normalizeReceiptText(item.description).includes(normalizeReceiptText(candidate.description)) || normalizeReceiptText(candidate.description).includes(normalizeReceiptText(item.description));
    if (!similarName) return false;
    if (!targetTime || !item.time) return true;
    const itemTime = Number(item.time.slice(0, 2)) * 60 + Number(item.time.slice(3, 5));
    return Math.abs(itemTime - targetTime) <= 30 && (!spaceMode || !item.spaceMode || item.spaceMode === spaceMode);
  }) || null;
}

export async function prepareReceiptImage(file, maxSide = 1800) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const gray = Math.round(pixels.data[index] * .299 + pixels.data[index + 1] * .587 + pixels.data[index + 2] * .114);
    const contrasted = gray > 175 ? 255 : gray < 70 ? 0 : Math.max(0, Math.min(255, Math.round((gray - 128) * 1.3 + 128)));
    pixels.data[index] = contrasted; pixels.data[index + 1] = contrasted; pixels.data[index + 2] = contrasted;
  }
  context.putImageData(pixels, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Não foi possível preparar a imagem.")), "image/jpeg", .9));
}
