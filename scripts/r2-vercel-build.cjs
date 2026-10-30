#!/usr/bin/env node
// Exécution explicite ponctuelle sur Vercel Production uniquement. Les secrets
// restent dans l'environnement du build et ne sont jamais imprimés.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const mode = process.env.R2_SYNC_ON_BUILD;
if (!mode) process.exit(0);
if (mode !== 'public-v1' || process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production') {
  console.error('Synchronisation R2 refusée : configuration ou environnement incorrect.');
  process.exit(1);
}
// Défense en profondeur : impossible de cibler le compartiment privé depuis ce job.
if (process.env.R2_ACCOUNT_ID !== '6f3e2c1a84617db0da9cb4bf594446f2' || process.env.R2_PUBLIC_BUCKET !== 'pulsebet-public') {
  console.error('Synchronisation R2 refusée : compte ou compartiment public inattendu.');
  process.exit(1);
}
const env = { ...process.env, R2_PUBLIC_VERIFY_ORIGIN: 'https://pub-9fcfd4ec44554836a31192651e3ffaa1.r2.dev' };
const script = path.join(__dirname, 'r2-public.cjs');
for (const selection of ['web', 'ota-current']) {
  for (const action of ['--upload', '--verify', '--verify-public']) {
    const result = spawnSync(process.execPath, [script, action, `--only=${selection}`], { env, stdio: 'inherit' });
    if (result.error || result.status !== 0) {
      console.error(`Synchronisation R2 arrêtée : ${action} (${selection}).`);
      process.exit(1);
    }
  }
}
console.log('Synchronisation et vérification R2 publique réussies.');
