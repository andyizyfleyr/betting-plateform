#!/usr/bin/env node
// Copie chiffrée, volontairement non destructive. Aucune suppression ou lecture applicative.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Pool } = require('pg');
const MAX_ROWS_PER_KIND = 100;
const MAX_BYTES = 8 * 1024 * 1024;
const TABLES = ['bets', 'prediction_bets', 'combo_bets'];

function config(env) {
  if (env.R2_ACCOUNT_ID !== '6f3e2c1a84617db0da9cb4bf594446f2' || env.R2_PRIVATE_BUCKET !== 'pulsebet') throw new Error('Compte ou bucket privé incorrect.');
  if (!env.R2_PRIVATE_ACCESS_KEY_ID || !env.R2_PRIVATE_SECRET_ACCESS_KEY) throw new Error('Identifiants R2 privés manquants.');
  if (!/^[a-fA-F0-9]{64}$/.test(env.R2_ARCHIVE_ENCRYPTION_KEY || '')) throw new Error('Clé de chiffrement dédiée de 32 octets requise en hexadécimal.');
  return { account: env.R2_ACCOUNT_ID, bucket: env.R2_PRIVATE_BUCKET, accessKeyId: env.R2_PRIVATE_ACCESS_KEY_ID, secretAccessKey: env.R2_PRIVATE_SECRET_ACCESS_KEY, key: Buffer.from(env.R2_ARCHIVE_ENCRYPTION_KEY, 'hex') };
}
function encrypt(data, key) {
  const plain = Buffer.from(JSON.stringify(data));
  if (plain.length > MAX_BYTES) throw new Error('Archive trop volumineuse.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('pulsebet-private-archive-v1'));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.from(JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') }));
}
function decrypt(bytes, key) {
  if (bytes.length > 12 * 1024 * 1024) throw new Error('Archive trop volumineuse.');
  const box = JSON.parse(bytes.toString('utf8'));
  if (box.version !== 1 || typeof box.iv !== 'string' || typeof box.tag !== 'string' || typeof box.data !== 'string') throw new Error('Format d’archive invalide.');
  const iv = Buffer.from(box.iv, 'base64'), tag = Buffer.from(box.tag, 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Format d’archive invalide.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from('pulsebet-private-archive-v1'));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8'));
}
async function snapshot(client, uid, cutoff) {
  if (!Number.isSafeInteger(uid) || uid < 1 || uid > 2147483647) throw new Error('Identifiant utilisateur invalide.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff) || !Number.isFinite(Date.parse(cutoff)) || new Date(cutoff).toISOString().slice(0, 10) !== cutoff || Date.parse(cutoff) > Date.now()) throw new Error('Date limite invalide.');
  const rows = {};
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    for (const table of TABLES) {
      // to_json conserve la précision numérique dans le texte sérialisé par PostgreSQL ;
      // la valeur est conservée comme chaîne pour ne pas l'arrondir en JavaScript.
      const result = await client.query(`SELECT row_to_json(t)::text AS record FROM (SELECT * FROM ${table} WHERE user_id = $1 AND status <> 'pending' AND settled_at IS NOT NULL AND settled_at < $2::date ORDER BY settled_at, id LIMIT $3) t`, [uid, cutoff, MAX_ROWS_PER_KIND + 1]);
      if (result.rows.length > MAX_ROWS_PER_KIND) throw new Error('Trop de lignes : réduire la période avant export.');
      rows[table] = result.rows.map(r => r.record);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  return { version: 1, createdAt: new Date().toISOString(), userId: uid, cutoff, tables: rows };
}
async function restoreFile(s3, bucket, objectKey, filename, encryptionKey) {
  if (!/^archives\/v1\/[0-9a-f-]{36}\.json\.enc$/.test(objectKey)) throw new Error('Chemin invalide.');
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
  if (!response.Body || (response.ContentLength != null && response.ContentLength > 12 * 1024 * 1024)) throw new Error('Archive absente ou trop volumineuse.');
  const data = decrypt(Buffer.from(await response.Body.transformToByteArray()), encryptionKey);
  await fs.writeFile(filename, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
}
async function storeAndVerify(s3, bucket, data, encryptionKey) {
  const bytes = encrypt(data, encryptionKey);
  // Identifiant opaque : ni utilisateur, ni date dans le chemin objet.
  const objectKey = `archives/v1/${crypto.randomUUID()}.json.enc`;
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: bytes, ContentType: 'application/octet-stream', IfNoneMatch: '*' }));
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
  if (!result.Body) throw new Error('Relecture impossible.');
  const read = Buffer.from(await result.Body.transformToByteArray());
  if (!crypto.timingSafeEqual(crypto.createHash('sha256').update(bytes).digest(), crypto.createHash('sha256').update(read).digest())) throw new Error('Empreinte différente à la relecture.');
  const recovered = decrypt(read, encryptionKey);
  if (JSON.stringify(recovered) !== JSON.stringify(data)) throw new Error('Vérification de restauration échouée.');
  return objectKey;
}
async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 5 || !['--copy-user', '--restore-file'].includes(mode)) throw new Error('Arguments invalides.');
  const cfg = config(process.env);
  const s3 = new S3Client({ region: 'auto', endpoint: `https://${cfg.account}.r2.cloudflarestorage.com`, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }, maxAttempts: 3 });
  if (mode === '--restore-file') {
    try {
      await restoreFile(s3, cfg.bucket, process.argv[3], process.argv[4], cfg.key);
      console.log('Archive déchiffrée dans un fichier privé. Aucune modification Neon.');
    } finally { s3.destroy(); }
    return;
  }
  if (!process.env.DATABASE_URL) { s3.destroy(); throw new Error('DATABASE_URL manquante.'); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const client = await pool.connect();
    let data;
    try { data = await snapshot(client, Number(process.argv[3]), process.argv[4]); } finally { client.release(); }
    if (TABLES.every(t => data.tables[t].length === 0)) { console.log('Aucun pari réglé à copier.'); return; }
    const objectKey = await storeAndVerify(s3, cfg.bucket, data, cfg.key);
    console.log(`Copie chiffrée relue et vérifiée : ${objectKey}. Les données Neon restent inchangées.`);
  } finally { await pool.end(); s3.destroy(); }
}
if (require.main === module) main().catch(() => { console.error('Archivage impossible. Vérifiez la configuration, les droits et la limite de volume ; aucune donnée Neon n’a été supprimée.'); process.exitCode = 1; });
module.exports = { config, encrypt, decrypt, snapshot, storeAndVerify, restoreFile, TABLES, MAX_ROWS_PER_KIND };
