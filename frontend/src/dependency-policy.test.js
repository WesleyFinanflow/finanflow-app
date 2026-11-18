import test from "node:test";
import assert from "node:assert/strict";
import policy from "../scripts/dependency-policy.cjs";
test("audit mitigation is restricted to the patched Vite paths of one advisory",()=>{
 const advisory={module_name:"picomatch",url:"https://github.com/advisories/GHSA-fc5q-39xc-vjpf",findings:[{version:"4.0.7",paths:[".>vite>picomatch",".>vite>tinyglobby>picomatch"]}]};
 assert.equal(policy.isMitigatedBuildAdvisory(advisory),true);
 assert.equal(policy.isMitigatedBuildAdvisory({...advisory,url:"https://github.com/advisories/GHSA-other"}),false);
 assert.equal(policy.isMitigatedBuildAdvisory({...advisory,findings:[{version:"2.3.2",paths:[".>vite>picomatch"]}]}),false);
 assert.equal(policy.isMitigatedBuildAdvisory({...advisory,findings:[{version:"4.0.7",paths:[".>runtime-api>picomatch"]}]}),false);
 assert.equal(policy.isMitigatedBuildAdvisory({...advisory,findings:[]}),false);
});
