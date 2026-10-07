export const requestIndexKey = { spaceId: 1, requestId: 1 };
export const requestIndexOptions = {
  name: "space_request_id_unique",
  unique: true,
  partialFilterExpression: { requestId: { $type: "string" } },
};

export async function ensureTransactionRequestIndex(collection) {
  // Build the replacement first so real request IDs remain protected throughout.
  await collection.createIndex(requestIndexKey, requestIndexOptions);
  const indexes = await collection.listIndexes().toArray();
  const legacy = indexes.find((index) => index.name === "spaceId_1_requestId_1");
  if (!legacy) return;
  if (legacy.unique !== true || legacy.sparse !== true
    || JSON.stringify(legacy.key) !== JSON.stringify(requestIndexKey)) {
    throw new Error("Unexpected legacy transaction request index; migration stopped.");
  }
  await collection.dropIndex(legacy.name);
}
