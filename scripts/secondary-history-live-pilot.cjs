#!/usr/bin/env node
// Une seule initialisation sur l'endpoint Preview secondaire autorisé. Aucun SQL sur la source.
const { Client } = require('pg');
const { endpointId } = require('./neon-rotation-pilot.cjs');
const BRANCH = 'arena/ce0cf9c0-betting-plateform';
function normalize(s) { const v = s.trim(); return /^psql\s+'([^'\r\n]+)'\s*$/.exec(v)?.[1] ?? v; }
async function run(env = process.env) {
  if (env.VERCEL !== '1' || env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_COMMIT_REF !== BRANCH) return;
  if (!env.DATABASE_URL || !env.NEON_PILOT_URL) throw Error('missing');
  const source = normalize(env.DATABASE_URL), target = normalize(env.NEON_PILOT_URL);
  if (endpointId(source) === endpointId(target)) throw Error('same endpoint');
  const client = new Client({ connectionString: target, connectionTimeoutMillis: 8000, query_timeout: 8000 });
  let created = false, marker = null;
  try {
    await client.connect();
    const exists = await client.query("SELECT to_regclass('public.pulse_public_history_cache') AS name");
    if (exists.rows[0].name !== null) throw Error('table already exists');
    // CREATE est atomique ; aucune table applicative existante n'est modifiée.
    await client.query(`CREATE TABLE public.pulse_public_history_cache (
      cache_key text PRIMARY KEY CHECK (cache_key = 'history-v1'), payload jsonb NOT NULL, updated_at timestamptz NOT NULL)`);
    created = true;
    // Seul le processus de build emprunte le drapeau Production, pas le déploiement.
    env.SECONDARY_HISTORY_URL = target;
    env.SECONDARY_HISTORY_CACHE_ENABLED = 'true';
    env.VERCEL_ENV = 'production';
    const { readSecondaryHistory, writeSecondaryHistory } = require('../src/lib/secondary-history-cache.ts');
    marker = `pilot-${require('node:crypto').randomUUID()}`;
    const page = { serverTime: new Date().toISOString(), items: [{ id: 1, status: 'finished', homeTeam: marker, awayTeam: 'Test' }] };
    await writeSecondaryHistory(page);
    const got = await readSecondaryHistory();
    if (!got || got.items.length !== 1 || got.items[0].homeTeam !== marker) throw Error('readback');
    const newer = { ...page, serverTime: new Date(Date.now() - 1000).toISOString(), items: [{ ...page.items[0], homeTeam: 'older' }] };
    await writeSecondaryHistory(newer);
    if ((await readSecondaryHistory())?.items[0]?.homeTeam !== marker) throw Error('order');
    console.log('SECONDARY_HISTORY_LIVE_PILOT OK : table créée sur endpoint secondaire, écriture et lecture réelles, ordre des versions vérifié.');
  } finally {
    env.VERCEL_ENV = 'preview';
    if (created && marker) {
      const deleted = await client.query("DELETE FROM public.pulse_public_history_cache WHERE cache_key = 'history-v1' AND payload->'items'->0->>'homeTeam' = $1", [marker]);
      if (deleted.rowCount !== 1) throw Error('cleanup');
      console.log('SECONDARY_HISTORY_LIVE_PILOT : ligne fictive supprimée, table conservée vide.');
    }
    await client.end().catch(() => {});
  }
}
if (require.main === module) run().catch(() => { console.error('SECONDARY_HISTORY_LIVE_PILOT FAILED : vérification impossible, aucun secret affiché.'); process.exitCode = 1; });
module.exports = { run };
