import mongoose from 'mongoose';
import {writeFile} from 'node:fs/promises';
import {legacyAudit} from '../src/legacy-audit.js';
import {encryptAudit} from '../src/audit-envelope.js';
import {inspectLegacyCandidates} from '../src/legacy-inspection.js';
const uri=process.env.MONGODB_URI,publicKey=process.env.AUDIT_RECIPIENT_PUBLIC_KEY;
let client;
try{
  if(!uri||!publicKey)throw Error('Missing configuration');
  const parsed=new URL(uri);if(!['mongodb:','mongodb+srv:'].includes(parsed.protocol)||!parsed.pathname.slice(1)||parsed.pathname.slice(1).includes('/'))throw Error('Explicit database required');
  // Validate recipient before connecting. No private key or plaintext report goes to Actions.
  encryptAudit({},publicKey);
  client=new mongoose.mongo.MongoClient(uri,{serverSelectionTimeoutMS:20000,appName:'FinanFlow-read-only-audit',retryWrites:false});
  await client.connect();
  const report=await legacyAudit(client.db());
  report.inspection=await inspectLegacyCandidates(client.db(),report);
  await writeFile('legacy-audit.encrypted.json',JSON.stringify(encryptAudit(report,publicKey)),{mode:0o600});
  console.log('Read-only audit completed; encrypted report written. No application data printed.');
}catch{
  // Do not print driver errors: they may include hostnames or authentication details.
  console.error('Audit failed. Check database connectivity, explicit database name and recipient public key. No plaintext report was uploaded.');process.exitCode=1;
}finally{await client?.close();}
