#!/usr/bin/env node
// Diagnostic ponctuel Preview, sans contenu ni URL de base dans les journaux.
const { Client } = require('pg');
const { endpointId } = require('./neon-rotation-pilot.cjs');
const BRANCH = 'arena/85c1f2a4-betting-plateform';
function normalize(s) { const v = s.trim(); return /^psql\s+'([^'\r\n]+)'\s*$/.exec(v)?.[1] ?? v; }
async function run(env = process.env) {
  if (env.VERCEL !== '1' || env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_COMMIT_REF !== BRANCH) return;
  if (!env.DATABASE_URL || !env.NEON_PILOT_URL) throw Error('configuration');
  const target = normalize(env.NEON_PILOT_URL);
  if (endpointId(normalize(env.DATABASE_URL)) === endpointId(target)) throw Error('same endpoint');
  const db = new Client({connectionString: target, connectionTimeoutMillis: 8000, query_timeout: 8000});
  try {
    await db.connect();
    const meta = async () => (await db.query(`SELECT updated_at, octet_length(payload::text)::integer AS bytes,
       jsonb_array_length(payload->'items')::integer AS items FROM public.pulse_public_history_cache WHERE cache_key='history-v1'`)).rows[0] ?? null;
    const before = await meta();
    const url = `https://be-plateform.vercel.app/api/matches/history?_=${Date.now()}`;
    const response = await fetch(url, {signal: AbortSignal.timeout(20000), redirect:'error', headers:{'cache-control':'no-cache'}});
    if (!response.ok) throw Error('api');
    const payload = await response.json();
    if (!Array.isArray(payload.matches) || typeof payload.serverTime !== 'string') throw Error('payload');
    const after = await meta();
    console.log(`SECONDARY_HISTORY_OBSERVE api=ok resultats=${payload.matches.length} avant=${before ? 'present' : 'absent'} apres=${after ? 'present' : 'absent'}`);
    if (after) {
      const same = new Date(after.updated_at).getTime() === Date.parse(payload.serverTime);
      const age = Math.round((Date.now()-new Date(after.updated_at).getTime())/1000);
      console.log(`SECONDARY_HISTORY_OBSERVE cache_resultats=${after.items} cache_octets=${after.bytes} age_secondes=${age} horodatage_identique_api=${same}`);
    }
  } finally { await db.end().catch(()=>{}); }
}
if (require.main === module) run().catch(()=>{ console.error('SECONDARY_HISTORY_OBSERVE FAILED : diagnostic indisponible, aucun secret affiché.'); process.exitCode=1; });
module.exports = { run };
