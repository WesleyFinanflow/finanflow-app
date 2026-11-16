import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, csvRows } from "./csv.js";
test("spreadsheet exports keep separators, quotes and newlines in one quoted cell",()=>{
 assert.equal(csvCell('Market; "local"'), '"Market; ""local"""');
 assert.equal(csvRows([["description","amount"],["Store\nSecond line","12,34"]]),'"description";"amount"\r\n"Store\nSecond line";"12,34"');
});
test("formula-like export fields are neutralized as text",()=>{
 for(const value of ["=1+1","+SUM(A1)","-1+2","@SUM(A1)","  =1+1","\t=1+1","\r=1+1","\n=1+1","\uFF1D1+1"])assert.ok(csvCell(value).startsWith('"\t'));
 assert.equal(csvCell("12,34"),'"12,34"');assert.equal(csvCell("Ordinary description"),'"Ordinary description"');
});
