import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {generateKeyPairSync} from 'node:crypto';
import {legacyAudit} from './legacy-audit.js';
import {encryptAudit,decryptAudit} from './audit-envelope.js';

test('legacy audit detects real missing parents without mutating or exposing private fields',async()=>{
  const mongo=await MongoMemoryServer.create();
  const client=new mongoose.mongo.MongoClient(mongo.getUri(),{monitorCommands:true});
  try{
    await client.connect();const db=client.db('audit_fixture'),oid=()=>new mongoose.Types.ObjectId();
    const legacy=oid(),courtesy=oid(),expired=oid(),valid=oid(),space=oid(),missing=oid(),account=oid();
    await db.collection('users').insertMany([
      {_id:legacy,planCode:'PREMIUM',accessStatus:'active',trialStatus:'ACTIVE',email:'PRIVATE@example.test',passwordHash:'NEVER_READ'},
      {_id:courtesy,planCode:'PREMIUM',accessOrigin:'COURTESY',accessStatus:'active',trialStatus:'CONVERTED'},
      {_id:expired,planCode:'PLUS',accessOrigin:'SUBSCRIPTION'},
      {_id:valid,planCode:'PREMIUM',accessOrigin:'SUBSCRIPTION'},
    ]);
    await db.collection('spaces').insertOne({_id:space,ownerId:legacy,type:'couple'});
    await db.collection('accounts').insertOne({_id:account,spaceId:space,balance:999});
    await db.collection('transactions').insertMany([
      {spaceId:space,createdBy:legacy,accountId:account,amount:111,description:'PRIVATE_DESCRIPTION'},
      {spaceId:space,createdBy:missing}, // Surviving shared data is a review finding, not a deletion target.
      {spaceId:missing,createdBy:legacy,accountId:missing},
    ]);
    await db.collection('debtplans').insertOne({spaceId:missing,userId:missing});
    await db.collection('subscriptions').insertMany([
      {userId:expired,status:'MANUAL',startsAt:new Date('2026-01-01'),endsAt:new Date('2026-02-01'),planCode:'PLUS'},
      {userId:valid,status:'ACTIVE',startsAt:new Date('2026-01-01'),endsAt:new Date('2027-01-01'),planCode:'PLUS'},
    ]);
    const snapshot=async()=>Object.fromEntries(await Promise.all((await db.listCollections().toArray()).map(async c=>[c.name,await db.collection(c.name).find().sort({_id:1}).toArray()])));
    const before=await snapshot(),commands=[];
    client.on('commandStarted',event=>commands.push(event.commandName));
    const report=await legacyAudit(db,new Date('2026-11-18T12:00:00Z'));
    assert.ok(commands.every(name=>['aggregate','find','getMore','killCursors'].includes(name)),commands.join(','));
    assert.deepEqual(await snapshot(),before);
    const count=(collection,kind)=>report.references.find(row=>row.collection===collection&&row.kind===kind).count;
    assert.equal(count('transactions','missing_space'),1);assert.equal(count('transactions','missing_creator_review'),1);
    assert.equal(count('transactions','missing_account'),1);assert.equal(count('debtplans','missing_user'),1);
    assert.deepEqual(report.plans.legacyPaidOriginUnknown.map(x=>x.userId),[String(legacy)]);
    assert.equal(report.plans.trialMetadataMismatch.length,1);assert.equal(report.plans.courtesyMetadataMismatch.length,0);
    assert.deepEqual(report.plans.subscriptionWithoutValidRecord.map(x=>x.userId),[String(expired)]);
    assert.deepEqual(report.plans.subscriptionPlanMismatch.map(x=>x.userId),[String(valid)]);
    for(const secret of ['PRIVATE@example.test','NEVER_READ','PRIVATE_DESCRIPTION','balance','amount'])assert.ok(!JSON.stringify(report).includes(secret));
  }finally{await client.close();await mongo.stop();}
});

test('audit envelope authenticates report and rejects tampering, wrong recipients and weak keys',()=>{
  const keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  const report={readOnly:true,privateValue:'not for public logs'},envelope=encryptAudit(report,keys.publicKey);
  assert.deepEqual(decryptAudit(envelope,keys.privateKey),report);assert.ok(!JSON.stringify(envelope).includes(report.privateValue));
  const damaged=Buffer.from(envelope.ciphertext,'base64');damaged[0]^=1;
  assert.throws(()=>decryptAudit({...envelope,ciphertext:damaged.toString('base64')},keys.privateKey));
  const other=generateKeyPairSync('rsa',{modulusLength:2048});assert.throws(()=>decryptAudit(envelope,other.privateKey));
  assert.throws(()=>encryptAudit(report,other.publicKey.export({type:'spki',format:'pem'})));
});
