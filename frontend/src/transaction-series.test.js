import test from "node:test";
import assert from "node:assert/strict";
import {buildSeriesTotals,transactionSeriesKey} from "./transaction-series.js";
test("series total reflects current amounts without rewriting completed records",()=>{
 const paid={spaceId:"a",seriesId:"s",amount:0.1,totalAmount:0.3};const rows=[paid,{...paid,amount:0.2},{...paid,amount:0.4}];
 assert.equal(buildSeriesTotals(rows).get(transactionSeriesKey(paid)),0.7);assert.equal(paid.totalAmount,0.3);
});
test("series totals isolate spaces and exclude unrelated single entries",()=>{
 const totals=buildSeriesTotals([{spaceId:"a",seriesId:"s",amount:10},{spaceId:"b",seriesId:"s",amount:20},{spaceId:"a",amount:100}]);
 assert.equal(totals.get("a:s"),10);assert.equal(totals.get("b:s"),20);assert.equal(totals.size,2);
});
