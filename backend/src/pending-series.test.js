import test from "node:test";
import assert from "node:assert/strict";
import { planPendingChanges,seriesSnapshot,assertSnapshot } from "./pending-series.js";
const row=(n,status="pendente")=>({_id:String(n).padStart(24,"0"),seriesId:"series",installmentNumber:n,installmentCount:5,status,date:`2028-${String(n).padStart(2,"0")}-10`,amount:10,updatedAt:new Date("2026-01-01"),__v:0});
const input={amount:20,date:"2028-02-29",status:"pago",description:"New description"};
test("selected and later pending installments change while earlier and completed rows stay identical",()=>{
 const rows=[row(1),row(2),row(3,"pago"),row(4),row(5,"pago")],before=JSON.stringify(rows);
 const changes=planPendingChanges(rows,rows[1]._id,input);
 assert.deepEqual(changes.map(c=>c.before.installmentNumber),[2,4]);assert.deepEqual(changes.map(c=>c.update.date),["2028-02-29","2028-04-29"]);
 assert.deepEqual(changes.map(c=>c.update.status),["pago","pendente"]);assert.equal(changes[0].update.totalAmount,70);assert.equal(JSON.stringify(rows),before);
});
test("monthly schedule retains skipped completed slots and clamps the end of the month",()=>{
 const rows=[row(1),row(2),row(3,"pago"),row(4)].map(({installmentNumber,installmentCount,...r})=>({...r,recurrence:"monthly"}));
 const changes=planPendingChanges(rows,rows[1]._id,{...input,date:"2028-01-31"});
 assert.deepEqual(changes.map(c=>c.update.date),["2028-01-31","2028-03-31"]);assert.equal(changes[0].update.totalAmount,undefined);
});
test("completed selected entry and excessive new total are refused",()=>{
 const paid=row(1,"pago");assert.throws(()=>planPendingChanges([paid],paid._id,input),{status:409});
 const rows=[row(1),row(2)];assert.throws(()=>planPendingChanges(rows,rows[0]._id,{...input,amount:1000000000000}),{status:400});
});
test("snapshot catches changed versions even at the same timestamp",()=>{
 const rows=[row(1),row(2)],snapshot=seriesSnapshot(rows);assert.doesNotThrow(()=>assertSnapshot(rows,snapshot));rows[1].__v=1;assert.throws(()=>assertSnapshot(rows,snapshot),{status:409});
});
test("snapshot refuses missing, duplicate and malformed entries",()=>{
 const rows=[row(1)];for(const value of [null,[],[...seriesSnapshot(rows),...seriesSnapshot(rows)],[{id:"wrong",updatedAt:null,revision:0}]])assert.throws(()=>assertSnapshot(rows,value),{status:400});
});
