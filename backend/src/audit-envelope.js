import {createCipheriv,createDecipheriv,randomBytes,publicEncrypt,privateDecrypt,constants,createPublicKey} from 'node:crypto';
export function encryptAudit(report,publicKey){
  const recipient=createPublicKey(publicKey);
  if(recipient.asymmetricKeyType!=='rsa'||recipient.asymmetricKeyDetails.modulusLength<3072)throw Error('Use an RSA public key with at least 3072 bits');
  const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(report),'utf8'),cipher.final()]);
  return {version:1,algorithm:'RSA-OAEP-SHA256/AES-256-GCM',key:publicEncrypt({key:recipient,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
}
export function decryptAudit(envelope,privateKey){
  if(envelope.version!==1||envelope.algorithm!=='RSA-OAEP-SHA256/AES-256-GCM')throw Error('Unsupported audit envelope');
  const key=privateDecrypt({key:privateKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(envelope.key,'base64'));
  const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));cipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext,'base64')),cipher.final()]).toString('utf8'));
}
