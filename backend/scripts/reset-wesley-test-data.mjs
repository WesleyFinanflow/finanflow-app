import mongoose from "mongoose";

const email = "wesleypeixoto@hotmail.com";
await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;
const user = await db.collection("users").findOne({ email });
if (!user) throw new Error("Usuário alvo não encontrado.");

const memberships = await db.collection("members").find({ userId: user._id }).toArray();
const spaceIds = memberships.map((item) => item.spaceId);
const spaces = await db.collection("spaces").find({ _id: { $in: spaceIds } }).toArray();
const summary = [];
for (const space of spaces) {
  summary.push({
    id: String(space._id),
    name: space.name,
    type: space.type,
    transactions: await db.collection("transactions").countDocuments({ spaceId: space._id }),
    accounts: await db.collection("accounts").countDocuments({ spaceId: space._id }),
    members: await db.collection("members").countDocuments({ spaceId: space._id }),
  });
}

if (!process.argv.includes("--confirm")) {
  console.log(JSON.stringify({ user: { id: String(user._id), name: user.name, email: user.email }, spaces: summary }, null, 2));
  await mongoose.disconnect();
  process.exit(0);
}

for (const space of spaces) {
  if (space.type === "couple") {
    await Promise.all([
      db.collection("transactions").deleteMany({ spaceId: space._id }),
      db.collection("accounts").deleteMany({ spaceId: space._id }),
      db.collection("invites").deleteMany({ spaceId: space._id }),
      db.collection("members").deleteMany({ spaceId: space._id }),
      db.collection("auditlogs").deleteMany({ spaceId: space._id }),
      db.collection("backupsnapshots").deleteMany({ spaceId: space._id }),
      db.collection("spaces").deleteOne({ _id: space._id }),
    ]);
    continue;
  }

  await Promise.all([
    db.collection("transactions").deleteMany({ spaceId: space._id }),
    db.collection("accounts").deleteMany({ spaceId: space._id }),
    db.collection("auditlogs").deleteMany({ spaceId: space._id }),
    db.collection("backupsnapshots").deleteMany({ spaceId: space._id }),
  ]);
  await db.collection("spaces").updateOne({ _id: space._id }, { $set: { reserve: 300, updatedAt: new Date() } });
  await db.collection("accounts").insertOne({ spaceId: space._id, name: "Conta principal", ownerName: user.name, balance: 0, createdAt: new Date(), updatedAt: new Date() });
}

console.log(JSON.stringify({ ok: true, resetSpaces: summary.map(({ id, name, type }) => ({ id, name, type })) }, null, 2));
await mongoose.disconnect();
