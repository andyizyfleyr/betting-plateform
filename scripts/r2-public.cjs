#!/usr/bin/env node
/* Synchronisation des seuls fichiers publics connus. Jamais de suppression distante. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const root = path.resolve(__dirname, '..', 'public');
const meta = require('../src/lib/expo-sdk52-meta.json');
const rootFiles = ['favicon.ico', 'og-pulse-bet.png', 'cashout.mp3', 'crashed.mp3', 'maintien.mp3', 'Pulse-Bet-Android.apk'];
const dirs = ['images', 'brand', 'icons', 'expo-sdk52'];
function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function filesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const file = path.join(dir, d.name);
    if (d.isSymbolicLink()) throw new Error(`Lien symbolique interdit : ${file}`);
    return d.isDirectory() ? filesIn(file) : d.isFile() ? [file] : [];
  });
}
function contentType(key, data) {
  const ota = [meta.launchAsset, ...meta.assets].find(a => a.relativePath === `/${key}`);
  if (ota) return ota.contentType;
  const ext = path.extname(key).toLowerCase();
  const types = {'.hbc':'application/javascript','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.mp3':'audio/mpeg','.apk':'application/vnd.android.package-archive'};
  if (types[ext]) return types[ext];
  if (key.startsWith('expo-sdk52/assets/')) {
    if (data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) return 'image/png';
    if (data.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))) return 'image/jpeg';
    if (data.toString('ascii',0,4)==='RIFF' && data.toString('ascii',8,12)==='WEBP') return 'image/webp';
  }
  throw new Error(`Type inconnu, refus de publier : ${key}`);
}
function inventory() {
  const files = [...rootFiles.map(n => path.join(root,n)).filter(fs.existsSync), ...dirs.flatMap(d=>filesIn(path.join(root,d)))];
  return files.sort().map(file => {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`Lien symbolique interdit : ${file}`);
    const key=path.relative(root,file).split(path.sep).join('/');
    if (!key || key.startsWith('../') || key.includes('\\')) throw new Error('Chemin invalide');
    const data=fs.readFileSync(file);
    const immutable=/^expo-sdk52\/(?:AppEntry-[a-f0-9]+\.hbc|assets\/[a-f0-9]+)$/.test(key);
    return {key,data,hash:sha(data),type:contentType(key,data),immutable};
  });
}
async function digestBody(body) {
  const h=crypto.createHash('sha256');
  for await (const chunk of body) h.update(chunk);
  return h.digest('hex');
}
function config() {
  const { R2_ACCOUNT_ID: account, R2_PUBLIC_BUCKET: bucket, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey }=process.env;
  if (!account || !/^[a-f0-9]{32}$/i.test(account) || !bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || !accessKeyId || !secretAccessKey) throw new Error('Configuration R2 publique incomplète ou invalide.');
  return { bucket, client: new S3Client({region:'auto',endpoint:`https://${account}.r2.cloudflarestorage.com`,credentials:{accessKeyId,secretAccessKey},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'}) };
}
function isNotFound(e) { return e?.$metadata?.httpStatusCode===404 || e?.name==='NotFound' || e?.name==='NoSuchKey'; }
async function main() {
  const mode=process.argv[2] || '--dry-run';
  if (!['--dry-run','--upload','--verify','--verify-public'].includes(mode)) throw new Error('Utiliser --dry-run, --upload, --verify ou --verify-public');
  const selectionArg=process.argv[3];
  if (selectionArg && !/^--only=(?:web|ota-current|ota-all)$/.test(selectionArg)) throw new Error('Filtre invalide : --only=web, --only=ota-current ou --only=ota-all');
  if (process.argv.length > 4) throw new Error('Arguments supplémentaires interdits.');
  const selection=selectionArg?.slice('--only='.length);
  const currentOta = new Set([meta.launchAsset, ...meta.assets].map(a => a.relativePath.slice(1)));
  const list=inventory().filter(f => selection === 'web' ? !f.key.startsWith('expo-sdk52/') : selection === 'ota-current' ? currentOta.has(f.key) : selection === 'ota-all' ? f.key.startsWith('expo-sdk52/') : true);
  if (selection === 'ota-current' && list.length !== currentOta.size) throw new Error('Un asset OTA du manifeste est introuvable.');
  if(mode==='--dry-run') { for(const f of list) console.log(`${f.key}\t${f.data.length}\t${f.type}\t${f.hash}`); console.log(`${list.length} fichiers publics ; aucun envoi.`); return; }
  let client,bucket,origin;
  if(mode==='--verify-public') {
    const raw=process.env.R2_PUBLIC_VERIFY_ORIGIN;
    const u=new URL(raw || '');
    if(u.protocol!=='https:' || u.username || u.password || u.pathname!=='/' || u.search || u.hash) throw new Error('R2_PUBLIC_VERIFY_ORIGIN doit être une origine HTTPS.');
    origin=u.origin;
  } else ({client,bucket}=config());
  for(const f of list) {
    if(mode==='--verify-public') {
      const response=await fetch(`${origin}/${f.key}`,{redirect:'error',signal:AbortSignal.timeout(30000)});
      if (!response.ok || sha(Buffer.from(await response.arrayBuffer()))!==f.hash || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!==f.type) throw new Error(`Vérification publique échouée : ${f.key} (${response.status})`);
      console.log(`OK public ${f.key}`); continue;
    }
    let head=null;
    try { head=await client.send(new HeadObjectCommand({Bucket:bucket,Key:f.key})); }
    catch(e) { if(!isNotFound(e)) throw e; }
    if(mode==='--verify') {
      if(!head) throw new Error(`Objet absent : ${f.key}`);
      const obj=await client.send(new GetObjectCommand({Bucket:bucket,Key:f.key}));
      if(!obj.Body || await digestBody(obj.Body)!==f.hash || head.ContentType!==f.type) throw new Error(`Empreinte ou type incorrect : ${f.key}`);
      console.log(`OK ${f.key}`); continue;
    }
    if(head) {
      let remoteHash=head.Metadata?.sha256;
      if(!remoteHash) { const obj=await client.send(new GetObjectCommand({Bucket:bucket,Key:f.key})); if(!obj.Body) throw new Error(`Objet illisible : ${f.key}`); remoteHash=await digestBody(obj.Body); }
      if(remoteHash===f.hash && head.ContentType===f.type) { console.log(`Inchangé ${f.key}`); continue; }
      if(f.immutable) throw new Error(`Refus d'écraser un asset OTA immuable différent : ${f.key}`);
    }
    await client.send(new PutObjectCommand({Bucket:bucket,Key:f.key,Body:f.data,ContentType:f.type,CacheControl:f.immutable?'public, max-age=31536000, immutable':'public, max-age=3600',Metadata:{sha256:f.hash}}));
    console.log(`Envoyé ${f.key}`);
  }
}
if (require.main === module) main().catch(e=>{console.error(`R2 : ${e.message}`);process.exitCode=1});
module.exports = { inventory, contentType, isNotFound, main };
