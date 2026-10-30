// Copie ponctuelle, bornée et non destructive d'une page d'un joueur.
// Uniquement après activation explicite sur Vercel Production.
const { S3Client } = require('@aws-sdk/client-s3');
const { Pool } = require('pg');
const { config, snapshotPage, storeAndVerify, TABLES } = require('./r2-private-archive.cjs');

async function runPilot(client, s3, cfg, cutoff) {
  // Ne communiquer ni l'identité ni les données du joueur dans les journaux.
  const found = await client.query(`SELECT user_id FROM (
    (SELECT user_id FROM bets WHERE status <> 'pending' AND settled_at < $1::date LIMIT 1)
    UNION ALL
    (SELECT user_id FROM prediction_bets WHERE status <> 'pending' AND settled_at < $1::date LIMIT 1)
    UNION ALL
    (SELECT user_id FROM combo_bets WHERE status <> 'pending' AND settled_at < $1::date LIMIT 1)
  ) candidates LIMIT 1`, [cutoff]);
  if (!found.rows.length) return { copied: false };
  const { data, nextCursor } = await snapshotPage(client, found.rows[0].user_id, cutoff);
  if (TABLES.every(t => data.tables[t].length === 0)) return { copied: false };
  const objectKey = await storeAndVerify(s3, cfg.bucket, data, cfg.key);
  return { copied: true, objectKey, hasMore: Boolean(nextCursor), count: TABLES.reduce((n, t) => n + data.tables[t].length, 0) };
}
async function main() {
  if (!process.env.R2_PRIVATE_PILOT_ON_BUILD) return;
  if (process.env.R2_PRIVATE_PILOT_ON_BUILD !== 'one-page-v1' || process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production') throw new Error('Contexte interdit');
  const cfg = config(process.env);
  if (!process.env.DATABASE_URL) throw new Error('Base absente');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
  const s3 = new S3Client({ region: 'auto', endpoint: `https://${cfg.account}.r2.cloudflarestorage.com`, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }, maxAttempts: 3 });
  try {
    const client = await pool.connect();
    try {
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const result = await runPilot(client, s3, cfg, cutoff);
      if (result.copied) console.log(`Pilote R2 privé : ${result.count} paris copiés et vérifiés ; objet ${result.objectKey} ; autres pages : ${result.hasMore ? 'oui' : 'non'}. Neon inchangé.`);
      else console.log('Pilote R2 privé : aucun pari éligible trouvé. Neon inchangé.');
    } finally { client.release(); }
  } finally { await pool.end(); s3.destroy(); }
}
if (require.main === module) main().catch(() => { console.error('Pilote R2 privé interrompu. Aucune donnée Neon supprimée ; un objet chiffré orphelin peut exister.'); process.exitCode = 1; });
module.exports = { runPilot };
