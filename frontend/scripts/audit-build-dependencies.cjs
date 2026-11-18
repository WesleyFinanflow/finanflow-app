require('./check-build-globs.cjs');
const {spawnSync}=require('node:child_process');
const {isMitigatedBuildAdvisory}=require('./dependency-policy.cjs');
if(!process.env.npm_execpath)throw Error('Run this check through pnpm run audit:checked');
const cli=process.env.npm_execpath;
const isScript=/\.(?:c?js|mjs)$/i.test(cli);
const result=spawnSync(isScript?process.execPath:cli,[...(isScript?[cli]:[]),'audit','--json','--audit-level=moderate'],{encoding:'utf8',timeout:60000});
if(result.error || ![0,1].includes(result.status))throw Error(result.error?.message || result.stderr || 'Dependency audit failed');
let data;try{data=JSON.parse(result.stdout);}catch{throw Error('Dependency audit did not return valid JSON');}
if(data.error || !data.advisories || !data.metadata?.vulnerabilities)throw Error('Dependency audit returned an unsupported result');
const advisories=Object.values(data.advisories),mitigated=advisories.filter(isMitigatedBuildAdvisory),remaining=advisories.filter(advisory=>!isMitigatedBuildAdvisory(advisory));
const blocking=remaining.filter(advisory=>['moderate','high','critical'].includes(advisory.severity));
console.log(`${mitigated.length} verified build-tool advisory mitigated; ${blocking.length} other blocking advisories`);
for(const advisory of remaining)console.log(`${advisory.severity}: ${advisory.module_name} - ${advisory.url}`);
if(blocking.length)process.exitCode=1;
