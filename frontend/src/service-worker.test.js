import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const code=readFileSync(new URL("../public/service-worker.js",import.meta.url),"utf8");
function worker(){
 const listeners={}, stored=new Map();let network=0, navigations=0, offline=false;
 const key=request=>typeof request==="string"?request:request.url;
 const caches={match:async request=>stored.get(key(request)),keys:async()=>["finanflow-pwa-v3"],delete:async()=>true,open:async()=>({put:async(request,response)=>stored.set(key(request),response),addAll:async()=>undefined})};
 const self={location:{origin:"https://app.example"},addEventListener:(name,handler)=>listeners[name]=handler,skipWaiting:()=>undefined,clients:{claim:async()=>undefined,matchAll:async()=>[{url:"https://app.example",navigate:()=>navigations++}]}};
 vm.runInNewContext(code,{self,caches,URL,fetch:async()=>{network++;if(offline)throw Error("offline");return new Response("network");}});
 function request(path,mode="cors",method="GET"){let response;listeners.fetch({request:{url:"https://app.example"+path,mode,method},respondWith:value=>response=value});return response;}
 return {listeners,stored,request,get network(){return network;},get navigations(){return navigations;},setOffline:()=>offline=true};
}
test("PWA serves immutable build assets from cache after the first request",async()=>{
 const w=worker();await w.request("/assets/index-abcdefgh.js");assert.equal(w.network,1);await w.request("/assets/index-abcdefgh.js");assert.equal(w.network,1);
 assert.equal(w.request("/api/me"),undefined);assert.equal(w.request("/api/auth/login","cors","POST"),undefined);
});
test("PWA refreshes navigation, supports offline shell and never substitutes HTML for a script",async()=>{
 const w=worker();w.stored.set("/",new Response("shell"));await w.request("/","navigate");assert.equal(w.network,1);
 w.setOffline();assert.equal(await(await w.request("/admin","navigate")).text(),"shell");
 await assert.rejects(w.request("/assets/missing-abcdefgh.js"));
});
test("PWA activation does not reload open forms",async()=>{
 const w=worker();let finished;w.listeners.activate({waitUntil:promise=>finished=promise});await finished;assert.equal(w.navigations,0);
});
