import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ensureTransactionRequestIndex } from "./transaction-index.js";

test("migrates sparse request index without changing transactions or losing idempotency", async () => {
  const mongo = await MongoMemoryServer.create();
  const connection = await mongoose.createConnection(mongo.getUri()).asPromise();
  try {
    const collection = connection.db.collection("transactions");
    await collection.createIndex({ spaceId: 1, requestId: 1 }, { unique: true, sparse: true });
    const spaceId = new mongoose.Types.ObjectId();
    const existing = [{ spaceId, amount: 120 }, { spaceId, requestId: "submitted-1", amount: 45 }];
    await collection.insertMany(existing);
    await assert.rejects(collection.insertOne({ spaceId, amount: 120 }), { code: 11000 });
    const before = await collection.find().toArray();
    await ensureTransactionRequestIndex(collection);
    await ensureTransactionRequestIndex(collection);
    assert.deepEqual(await collection.find().toArray(), before);
    await collection.insertMany([
      { spaceId, amount: 120, date: "2026-11-07", recurrence: "monthly" },
      { spaceId, amount: 120, date: "2026-12-07", recurrence: "monthly" },
      { spaceId, requestId: null, amount: 10 },
      { spaceId, requestId: null, amount: 20 },
    ]);
    await assert.rejects(collection.insertOne({ spaceId, requestId: "submitted-1" }), { code: 11000 });
    await collection.insertOne({ spaceId: new mongoose.Types.ObjectId(), requestId: "submitted-1" });
    const indexes = await collection.listIndexes().toArray();
    assert.equal(indexes.some((index) => index.name === "spaceId_1_requestId_1"), false);
    assert.equal(indexes.find((index) => index.name === "space_request_id_unique").unique, true);
  } finally {
    await connection.close();
    await mongo.stop();
  }
});

test("retains legacy protection if creating the replacement fails", async () => {
  let dropped = false;
  const collection = {
    createIndex: async () => { throw new Error("index build failed"); },
    dropIndex: async () => { dropped = true; },
  };
  await assert.rejects(ensureTransactionRequestIndex(collection), /index build failed/);
  assert.equal(dropped, false);
});
