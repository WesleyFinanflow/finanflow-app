import { readFile } from "node:fs/promises";
export const base="http://127.0.0.1:5392";
export async function actor(project,kind){return JSON.parse(await readFile(new URL("./.financial-fixtures.json",import.meta.url),"utf8"))[project][kind];}
export async function useActor(context,fixture){
 await context.route("**/*",route=>["127.0.0.1","localhost"].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await context.addCookies([{name:"finanflow_session",value:fixture.cookie,url:base,httpOnly:true,sameSite:"Lax"}]);
}
export async function call(request,path,body,method=body?"POST":"GET"){
 const response=await request.fetch(base+path,{method,headers:{Origin:base},...(body?{data:body}:{})});
 return {status:response.status(),body:await response.json()};
}
export const month=()=>new Date().toISOString().slice(0,7);
export const transaction=(extra={})=>({type:"despesa",description:"Fixture expense",amount:100,date:month()+"-10",category:"Moradia",status:"pendente",recurrence:"none",installmentCount:1,...extra});
