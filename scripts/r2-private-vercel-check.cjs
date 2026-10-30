#!/usr/bin/env node
// Vérification ponctuelle avec données fictives exclusivement, sans accès Neon.
const mode = process.env.R2_PRIVATE_CHECK_ON_BUILD;
if (!mode) process.exit(0);
if (mode !== 'synthetic-v1' || process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production') {
  console.error('Test R2 privé refusé : configuration ou environnement incorrect.');
  process.exit(1);
}
const { S3Client } = require('@aws-sdk/client-s3');
const { config, storeAndVerify } = require('./r2-private-archive.cjs');
(async () => {
  const cfg = config(process.env);
  const s3 = new S3Client({ region: 'auto', endpoint: `https://${cfg.account}.r2.cloudflarestorage.com`, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }, maxAttempts: 3 });
  try {
    const data = { version: 1, synthetic: true, message: 'Pulse Bet archive test: no user data', tables: { bets: [], prediction_bets: [], combo_bets: [] } };
    await storeAndVerify(s3, cfg.bucket, data, cfg.key);
    console.log('Test R2 privé réussi : objet fictif chiffré, écrit, relu et déchiffré. Aucune donnée Neon utilisée.');
  } finally { s3.destroy(); }
})().catch(() => { console.error('Test R2 privé échoué : vérifier la configuration et les permissions. Aucun secret affiché.'); process.exitCode = 1; });
