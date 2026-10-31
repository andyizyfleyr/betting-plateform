const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { SQL, main } = require('./neon-transfer-profile.cjs');
(async () => {
  delete process.env.NEON_TRANSFER_PROFILE;
  await main(); // inert by default, no database access
  process.env.NEON_TRANSFER_PROFILE = 'sample-v1';
  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = 'preview';
  process.env.DATABASE_URL = 'not-a-database';
  await assert.rejects(main, /configuration invalide/);
  const db = new PGlite();
  try {
    const ddl = fs.readFileSync('src/db/seed.ts', 'utf8').match(/CREATE TABLE IF NOT EXISTS "matches" \([\s\S]*?\n    \);/);
    assert(ddl); await db.exec(ddl[0]);
    await db.exec(`INSERT INTO matches(sport,league,home_team,away_team,status,starts_at,odds_home,odds_away,source, markets)
      SELECT 'football','test','a','b',CASE WHEN n <= 130 THEN 'live' ELSE 'finished' END, now(),2,3,CASE WHEN n % 2 = 0 THEN 'manual' ELSE 'virtual' END, '{"test":"value"}'::jsonb FROM generate_series(1,200) n`);
    const { rows } = await db.query(SQL);
    assert.deepEqual(rows.map(r => [r.category, r.rows]), [['active', 120], ['finished', 32]]);
    assert(rows.every(r => Number(r.markets_bytes) > 0));
    assert(rows.every(r => !('home_team' in r) && !('away_team' in r)));
    console.log('Profil Neon : limites, agrégats et garde production vérifiés.');
  } finally { await db.close(); }
})().catch(() => { console.error('Échec du test de profil Neon.'); process.exitCode = 1; });
