#!/usr/bin/env node
// Contrôle explicite lors du déploiement : transaction annulée, aucune donnée réelle lue.
const { Client } = require('pg');
const { endpointId } = require('./neon-rotation-pilot.cjs');
function normalize(s) { const v = s.trim(); return /^psql\s+'([^'\r\n]+)'\s*$/.exec(v)?.[1] ?? v; }
async function main(env = process.env) {
  if (env.SECONDARY_HISTORY_PROBE !== '1') return;
  if (env.VERCEL !== '1' || env.VERCEL_ENV !== 'production' || env.SECONDARY_HISTORY_CACHE_ENABLED !== 'true' || !env.DATABASE_URL || !env.SECONDARY_HISTORY_URL) throw Error('configuration');
  const target = normalize(env.SECONDARY_HISTORY_URL), source = normalize(env.DATABASE_URL);
  if (endpointId(source) === endpointId(target)) throw Error('endpoints');
  const client = new Client({ connectionString: target, connectionTimeoutMillis: 8000, query_timeout: 8000 });
  let transaction = false;
  try {
    await client.connect();
    await client.query('BEGIN'); transaction = true;
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    const page = JSON.stringify({ serverTime: new Date().toISOString(), items: [{ id: 1, status: 'finished', homeTeam: 'fictional', awayTeam: 'fictional' }] });
    await client.query(`INSERT INTO public.pulse_public_history_cache(cache_key,payload,updated_at)
      VALUES ('history-v1',$1::jsonb,clock_timestamp())
      ON CONFLICT (cache_key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`, [page]);
    const result = await client.query("SELECT payload->'items'->0->>'homeTeam' AS marker FROM public.pulse_public_history_cache WHERE cache_key = 'history-v1'");
    if (result.rows[0]?.marker !== 'fictional') throw Error('readback');
    await client.query('ROLLBACK'); transaction = false;
    console.log('SECONDARY_HISTORY_PRODUCTION_PROBE OK : endpoints distincts, table accessible en lecture et écriture, transaction fictive annulée.');
  } finally {
    if (transaction) await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}
if (require.main === module) main().catch(() => { console.error('SECONDARY_HISTORY_PRODUCTION_PROBE FAILED : connexion ou configuration invalide, aucun secret affiché.'); process.exitCode = 1; });
module.exports = { main };
