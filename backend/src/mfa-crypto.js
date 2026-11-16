import crypto from "node:crypto";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes) {
  let bits = ""; for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let result = ""; for (let i = 0; i < bits.length; i += 5) result += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return result;
}
function decode(secret) {
  const bits = [...secret].map(c => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  return Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)));
}
export function totp(secret, step, digits = 6) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac("sha1", decode(secret)).update(counter).digest();
  return String((mac.readUInt32BE(mac[mac.length - 1] & 15) & 0x7fffffff) % (10 ** digits)).padStart(digits, "0");
}
export function verifyTotp(secret, code, lastStep = -1, now = Date.now()) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const step of [current, current - 1, current + 1]) {
    if (step > lastStep && crypto.timingSafeEqual(Buffer.from(code), Buffer.from(totp(secret, step)))) return step;
  }
  return null;
}
export function seal(secret, rootKey) {
  const key = crypto.hkdfSync("sha256", rootKey, "finanflow", "mfa-encryption-v1", 32);
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(b => b.toString("base64url")).join(".");
}
export function unseal(value, rootKey) {
  const [iv, tag, ciphertext] = value.split(".").map(b => Buffer.from(b, "base64url"));
  const key = crypto.hkdfSync("sha256", rootKey, "finanflow", "mfa-encryption-v1", 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
export const recoveryHash = value => crypto.createHash("sha256").update(String(value).replace(/-/g, "").toUpperCase()).digest("hex");
export function recoveryCodes() { return Array.from({ length: 10 }, () => crypto.randomBytes(10).toString("hex").toUpperCase().match(/.{5}/g).join("-")); }
