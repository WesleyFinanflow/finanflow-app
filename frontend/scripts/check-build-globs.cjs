const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {dirname}=require('node:path');
const viteRequire=createRequire(require.resolve('vite/package.json'));
const tinyRequire=createRequire(viteRequire.resolve('tinyglobby'));
const fdirRequire=createRequire(tinyRequire.resolve('fdir'));
for(const dependency of [viteRequire,tinyRequire,fdirRequire]){
 const pm=dependency('picomatch');
 for(const pattern of ['+(*)','+(*a)','*(a)','!(*.js)','@(a|b)','?(a)']){
  for(const options of [{},{fastpaths:true},{noext:false}]){
   assert.throws(()=>pm(pattern,options),/Extended globs disabled/);
   assert.throws(()=>pm.makeRe(pattern,options),/Extended globs disabled/);
   assert.throws(()=>pm.parse(pattern,options),/Extended globs disabled/);
  }
 }
 assert.equal(pm('src/**/*.{js,jsx}')('src/nested/App.jsx'),true);
 assert.equal(pm('src/**/*.{js,jsx}')('src/nested/style.css'),false);
}
console.log('Verified build-only picomatch mitigation for GHSA-fc5q-39xc-vjpf');
