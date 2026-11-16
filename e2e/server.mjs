import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
const backendDir=fileURLToPath(new URL("../backend/", import.meta.url));
const frontendDir=fileURLToPath(new URL("../frontend/", import.meta.url));
const require=createRequire(new URL("../backend/package.json",import.meta.url));
const {MongoMemoryReplSet}=require("mongodb-memory-server"), mongoose=require("mongoose"), bcrypt=require("bcryptjs");
let mongo, backend, frontend, closing=false;
async function stop() {
 if(closing)return;closing=true;
 for(const child of [frontend,backend])if(child && child.exitCode===null){child.kill();await Promise.race([once(child,"exit"),new Promise(resolve=>setTimeout(resolve,5000))]);}
 await mongoose.disconnect(); await mongo?.stop();
}
process.on("SIGTERM",()=>stop().finally(()=>process.exit(0)));
process.on("SIGINT",()=>stop().finally(()=>process.exit(0)));
try {
 mongo=await MongoMemoryReplSet.create({replSet:{count:1}});
 const uri=mongo.getUri("finanflow_e2e");
 if(!/^mongodb:\/\/(127\.0\.0\.1|localhost):/.test(uri))throw Error("E2E requires a disposable loopback database");
 await mongoose.connect(uri);
 const passwordHash=await bcrypt.hash("Browser-test-only-947!",10);
 const users=[];
 for(const project of ["desktop","mobile"]){
  for(const kind of ["owner","mfa","user","courtesy"]){
   users.push({name:`${project} ${kind}`,email:`${project}.${kind}@example.test`,passwordHash,role:"USER",emailVerified:true,accessStatus:kind==="courtesy"?"trial":"active",planCode:"FREE",trialStatus:kind==="courtesy"?"ACTIVE":"NOT_STARTED",...(kind==="courtesy"?{trialEndsAt:new Date(0)}:{}),createdAt:new Date(),updatedAt:new Date()});
  }
 }
 await mongoose.connection.collection("users").insertMany(users);
 await mongoose.disconnect();
 const admins=["desktop.owner","desktop.mfa","mobile.owner","mobile.mfa"].map(x=>x+"@example.test").join(",");
 backend=spawn(process.execPath,["src/server.js"],{cwd:backendDir,env:{...process.env,PORT:"4392",MONGODB_URI:uri,JWT_SECRET:"disposable-browser-suite-root-key-947",ADMIN_EMAILS:admins,CORS_ORIGIN:"http://127.0.0.1:5392",FRONTEND_URL:"http://127.0.0.1:5392",NODE_ENV:"development",GOOGLE_CLIENT_ID:"",GOOGLE_CLIENT_SECRET:"",GOOGLE_REDIRECT_URI:"",RESEND_API_KEY:"",EMAIL_FROM:""},stdio:["ignore","pipe","pipe"]});
 let logs="";backend.stdout.on("data",x=>logs=(logs+x).slice(-6000));backend.stderr.on("data",x=>logs=(logs+x).slice(-6000));
 let ready=false;
 for(let i=0;i<600;i++){if(backend.exitCode!==null)throw Error(logs);try{if((await fetch("http://127.0.0.1:4392/api/ready")).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 if(!ready)throw Error("E2E backend failed to become ready: "+logs);
 frontend=spawn(process.execPath,["node_modules/vite/bin/vite.js","preview","--host","127.0.0.1","--port","5392","--strictPort","--config",fileURLToPath(new URL("./preview.config.mjs",import.meta.url))],{cwd:frontendDir,stdio:"inherit"});
 frontend.on("exit",code=>{if(!closing)stop().finally(()=>process.exit(code||1));});
 backend.on("exit",code=>{if(!closing)stop().finally(()=>process.exit(code||1));});
 console.log("Disposable E2E application ready; no production services configured.");
}catch(error){console.error(error);await stop();process.exit(1);}
