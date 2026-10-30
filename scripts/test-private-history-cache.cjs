const assert = require('node:assert/strict');
const Module = require('node:module');
const crypto = require('node:crypto');
const { GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const objects = new Map(); let getCount=0, putCount=0, fail=false;
class S3Client {
 async send(cmd) {
  if (fail) throw new Error('offline');
  if (cmd instanceof PutObjectCommand) { putCount++; objects.set(cmd.input.Key, Buffer.from(cmd.input.Body)); return {}; }
  assert(cmd instanceof GetObjectCommand); getCount++;
  const body=objects.get(cmd.input.Key); if(!body) throw new Error('missing');
  return {ContentLength: body.length, Body:{transformToByteArray:async()=>body}};
 }
}
const load=Module._load;
Module._load=function(name){ if(name==='@aws-sdk/client-s3') return {GetObjectCommand,PutObjectCommand,S3Client}; return load.apply(this,arguments); };
Object.assign(process.env,{R2_HISTORY_CACHE_ENABLED:'true',R2_ACCOUNT_ID:'6f3e2c1a84617db0da9cb4bf594446f2',R2_PRIVATE_BUCKET:'pulsebet',R2_PRIVATE_ACCESS_KEY_ID:'test',R2_PRIVATE_SECRET_ACCESS_KEY:'test',R2_ARCHIVE_ENCRYPTION_KEY:'12'.repeat(32)});
const {readPrivateHistoryCache,writePrivateHistoryCache}=require('../src/lib/private-history-cache.ts');
(async()=>{
 const uid=7,cursor='opaque-cursor', page={bets:[{id:3,status:'won',matchStatus:'finished',cashOut:null,stake:5}],nextCursor:null};
 assert.equal(await readPrivateHistoryCache(uid,cursor),null);
 await writePrivateHistoryCache(uid,cursor,page); assert.equal(putCount,1);
 assert.deepEqual(await readPrivateHistoryCache(uid,cursor),page);
 assert.equal(await readPrivateHistoryCache(8,cursor),null);
 assert.equal(await readPrivateHistoryCache(uid,'other'),null);
 assert(![...objects.keys()][0].includes(cursor)); assert(![...objects.values()][0].includes(Buffer.from('stake')));
 await writePrivateHistoryCache(uid,cursor,{bets:[{status:'cashed',matchStatus:'live'}],nextCursor:null});
 await writePrivateHistoryCache(uid,cursor,{bets:[{status:'lost',legs:[{status:'pending'}]}],nextCursor:null});
 await writePrivateHistoryCache(uid,cursor,{bets:[{status:'pending'}],nextCursor:null});
 assert.equal(putCount,1);
 const realNow=Date.now; Date.now=()=>realNow()+11000;
 assert.equal(await readPrivateHistoryCache(uid,cursor),null); Date.now=realNow;
 const key=[...objects.keys()][0]; const corrupted=Buffer.from(objects.get(key)); corrupted[corrupted.length-1]^=1; objects.set(key,corrupted);
 assert.equal(await readPrivateHistoryCache(uid,cursor),null);
 fail=true; assert.equal(await readPrivateHistoryCache(uid,cursor),null); await writePrivateHistoryCache(uid,cursor,page);
 assert(getCount>0); assert(crypto);
 console.log('Cache R2 privé : isolation, chiffrement, expiration, paris actifs exclus et repli testés.');
})().catch(e=>{console.error(e);process.exitCode=1});
