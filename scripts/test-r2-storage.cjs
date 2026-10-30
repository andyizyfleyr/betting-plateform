const assert = require('node:assert/strict');
const Module = require('node:module');
const {Readable} = require('node:stream');
const original = Module._load;
const store = new Map(); let puts=0;
class HeadObjectCommand { constructor(input) {this.input=input;} }
class GetObjectCommand { constructor(input) {this.input=input;} }
class PutObjectCommand { constructor(input) {this.input=input;} }
class S3Client { async send(command) {
 const key=command.input.Key, obj=store.get(key);
 if(command instanceof PutObjectCommand) { puts++;store.set(key,{data:Buffer.from(command.input.Body),metadata:command.input.Metadata,type:command.input.ContentType});return {}; }
 if(!obj) {const e=new Error('not found'); e.$metadata={httpStatusCode:404};throw e;}
 if(command instanceof HeadObjectCommand) return { Metadata: obj.metadata, ContentType: obj.type };
 if(command instanceof GetObjectCommand) return { Body: Readable.from([obj.data]) };
 throw Error('commande inconnue');
} }
Module._load=function(name){ if(name==='@aws-sdk/client-s3') return {S3Client,HeadObjectCommand,GetObjectCommand,PutObjectCommand};return original.apply(this,arguments); };
const {main}=require('./r2-public.cjs');Module._load=original;
const oldLog=console.log; console.log=()=>{};
Object.assign(process.env,{R2_ACCOUNT_ID:'1234567890abcdef1234567890abcdef',R2_PUBLIC_BUCKET:'public-test',R2_ACCESS_KEY_ID:'example',R2_SECRET_ACCESS_KEY:'example'});
(async()=>{
 process.argv=['node','script','--upload','--only=ota-current'];await main();assert.equal(puts,10);
 await main();assert.equal(puts,10);
 process.argv[2]='--verify';await main();
 const target=[...store.entries()].find(([k])=>k.endsWith('.hbc'));target[1].data=Buffer.from('tampered');
 await assert.rejects(main(),/Empreinte ou type incorrect/);
 target[1].metadata.sha256='incorrect';process.argv[2]='--upload';await assert.rejects(main(),/Refus d'écraser/);
 process.argv[2]='--verify';store.delete(target[0]);await assert.rejects(main(),/Objet absent/);
 console.log=oldLog;console.log('R2 : upload, reprise, vérification SHA-256, détection de corruption et immutabilité vérifiés sur stockage simulé.');
})().catch(e=>{console.log=oldLog;console.error(e);process.exitCode=1});
