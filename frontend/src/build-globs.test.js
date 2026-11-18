import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
test("build glob mitigation rejects extended globs through active dependency paths",()=>{
 const result=spawnSync(process.execPath,[fileURLToPath(new URL("../scripts/check-build-globs.cjs",import.meta.url))],{timeout:3000,encoding:"utf8"});
 assert.equal(result.status,0,result.stderr||result.error?.message);
});
