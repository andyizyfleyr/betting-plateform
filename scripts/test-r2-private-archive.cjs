const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { config, encrypt, decrypt, snapshot, storeAndVerify, restoreFile, TABLES } = require('./r2-private-archive.cjs');
(async () => {
  const env = { R2_ACCOUNT_ID: '6f3e2c1a84617db0da9cb4bf594446f2', R2_PRIVATE_BUCKET: 'pulsebet', R2_PRIVATE_ACCESS_KEY_ID: 'test', R2_PRIVATE_SECRET_ACCESS_KEY: 'test', R2_ARCHIVE_ENCRYPTION_KEY: '12'.repeat(32) };
  const cfg = config(env);
  assert.throws(() => config({ ...env, R2_PRIVATE_BUCKET: 'pulsebet-public' }));
  assert.throws(() => config({ ...env, R2_ARCHIVE_ENCRYPTION_KEY: 'invalid' }));
  const pg = new PGlite();
  for (const t of TABLES) await pg.exec(`CREATE TABLE ${t} (id int, user_id int, status text, settled_at timestamp, amount numeric); INSERT INTO ${t} VALUES (1,1,'won','2020-01-01',123456789012345.123456), (2,1,'pending',NULL,99), (3,2,'won','2020-01-01',99), (4,1,'lost','2025-01-01',99)`);
  const client = { query: async (sql, args) => pg.query(sql, args) };
  const data = await snapshot(client, 1, '2021-01-01');
  for (const t of TABLES) { assert.equal(data.tables[t].length, 1); assert.match(data.tables[t][0], /123456789012345\.123456/); }
  await assert.rejects(() => snapshot(client, 0, '2021-01-01'));
  const encrypted = encrypt(data, cfg.key);
  assert(!encrypted.toString().includes('123456789012345'));
  assert.deepEqual(decrypt(encrypted, cfg.key), data);
  assert.throws(() => decrypt(encrypted, Buffer.alloc(32)));
  const box = JSON.parse(encrypted); box.tag = Buffer.alloc(16).toString('base64');
  assert.throws(() => decrypt(Buffer.from(JSON.stringify(box)), cfg.key));
  let saved, savedKey;
  const s3 = { send: async cmd => {
    if (cmd instanceof PutObjectCommand) { assert.equal(cmd.input.IfNoneMatch, '*'); saved = cmd.input.Body; savedKey = cmd.input.Key; return {}; }
    assert(cmd instanceof GetObjectCommand); assert.equal(cmd.input.Key, savedKey);
    return { Body: { transformToByteArray: async () => saved } };
  } };
  const objectKey = await storeAndVerify(s3, cfg.bucket, data, cfg.key);
  assert.equal(objectKey, savedKey); assert.match(objectKey, /^archives\/v1\//); assert(!objectKey.includes('2021'));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-test-'));
  try {
    const file = path.join(dir, 'restored.json');
    await restoreFile(s3, cfg.bucket, objectKey, file, cfg.key);
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), data);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    await assert.rejects(() => restoreFile(s3, cfg.bucket, objectKey, file, cfg.key));
    await assert.rejects(() => restoreFile(s3, cfg.bucket, '../secret', file, cfg.key));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
  const badS3 = { send: async cmd => cmd instanceof PutObjectCommand ? {} : { Body: { transformToByteArray: async () => Buffer.from('modified') } } };
  await assert.rejects(() => storeAndVerify(badS3, cfg.bucket, data, cfg.key));
  await pg.exec("INSERT INTO bets SELECT i,1,'won','2020-01-01',1 FROM generate_series(10,110) AS i");
  await assert.rejects(() => snapshot(client, 1, '2021-01-01'), /Trop de lignes/);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM bets')).rows[0].n,105);
  await pg.close();
  console.log('Archives privées : isolation, précision, chiffrement, relecture, altération, limite et absence de suppression OK (PGlite et R2 simulé).');
})().catch(e => { console.error(e); process.exitCode = 1; });
