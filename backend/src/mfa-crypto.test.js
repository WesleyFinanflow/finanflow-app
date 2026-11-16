import test from "node:test";
import assert from "node:assert/strict";
import { base32, totp, verifyTotp, seal, unseal, recoveryCodes, recoveryHash } from "./mfa-crypto.js";
test("TOTP matches RFC 6238 SHA1 vectors", () => {
 const secret = base32(Buffer.from("12345678901234567890"));
 for (const [seconds, expected] of [[59,"94287082"],[1111111109,"07081804"],[1111111111,"14050471"],[1234567890,"89005924"],[2000000000,"69279037"],[20000000000,"65353130"]]) assert.equal(totp(secret,Math.floor(seconds/30),8),expected);
});
test("verification allows bounded drift, rejects replay, malformed and stale codes", () => {
 const secret = base32(Buffer.from("12345678901234567890")), now=1234567890000, step=Math.floor(now/30000);
 assert.equal(verifyTotp(secret,totp(secret,step),-1,now),step);
 assert.equal(verifyTotp(secret,totp(secret,step),step,now),null);
 assert.equal(verifyTotp(secret,totp(secret,step-2),-1,now),null);
 assert.equal(verifyTotp(secret,{},-1,now),null);
});
test("MFA encryption authenticates ciphertext and recovery codes contain high entropy", () => {
 const encrypted=seal("private-seed","root-key");assert.equal(unseal(encrypted,"root-key"),"private-seed");
 assert.throws(()=>unseal(encrypted,"other-key"));assert.throws(()=>unseal(encrypted.slice(0,-2)+"AA","root-key"));
 const codes=recoveryCodes();assert.equal(new Set(codes).size,10);assert.equal(codes[0].length,23);assert.equal(recoveryHash(codes[0]),recoveryHash(codes[0].replaceAll("-","").toLowerCase()));
});
