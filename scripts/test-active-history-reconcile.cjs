const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { drizzle } = require('drizzle-orm/pglite');
const originalLoad = Module._load;
(async () => {
  const pg = new PGlite();
  const ddl = fs.readFileSync('src/db/seed.ts', 'utf8').match(/CREATE TABLE IF NOT EXISTS "matches" \([\s\S]*?\n    \);/);
  assert(ddl); await pg.exec(ddl[0]);
  await pg.exec(`INSERT INTO matches(id,sport,league,home_team,away_team,status,starts_at,finished_at,odds_home,odds_away,source,home_score,away_score)
    VALUES (1,'football','T','A','B','live','2026-01-01',NULL,2,3,'manual',0,0),
    (2,'football','T','C','D','finished','2026-01-01','2026-01-02',2,3,'manual',1,0),
    (3,'football','T','E','F','finished','2026-01-01','2026-01-02',2,3,'virtual',0,1)`);
  const calls = [];
  const db = drizzle(pg, { logger: { logQuery: (query, params) => calls.push({query,params}) } });
  Module._load = function(name) {
    if (name === '@/db') return { db };
    if (name === '@/lib/response-cache') return { computeWeakEtag: () => 'etag', invalidatePublicApiCaches: () => {} };
    if (name === '@/lib/partykit') return { PARTY_LIVE_MATCHES_ROOM: 'live', publishPartyRoomEvent: () => {}, publishUserRealtimeInvalidation: () => {} };
    return originalLoad.apply(this, arguments);
  };
  const cache = require('../src/lib/active-state-cache.ts');
  const realNow = Date.now; let now = realNow(); Date.now = () => now;
  try {
    await cache.ensureMatchStoreHydrated();
    assert.equal(cache.getCachedAllMatchesForFeed().length,3);
    assert.equal(calls.length,1); assert(calls[0].params.includes(true));
    await pg.exec('UPDATE matches SET home_score=2 WHERE id=2');
    now += 2600; await cache.ensureMatchStoreHydrated();
    assert.equal(calls.length,2); assert(calls[1].params.includes(false));
    assert.equal(cache.getCachedMatchById(2).homeScore,1); // fenêtre courte et bornée
    now += 8000; await cache.ensureMatchStoreHydrated();
    assert.equal(calls.length,3); assert(calls[2].params.includes(true));
    assert.equal(cache.getCachedMatchById(2).homeScore,2);
    await pg.exec("UPDATE matches SET status='finished',finished_at='2026-01-03',home_score=3 WHERE id=1");
    now += 2600; await cache.ensureMatchStoreHydrated();
    assert.equal(calls.length,5); // disparition d'un actif : résultats relus immédiatement
    assert.equal(cache.getCachedMatchById(1).status,'finished');
    assert.equal(cache.getCachedMatchById(1).homeScore,3);
    await pg.exec('UPDATE matches SET home_score=4 WHERE id=2');
    await cache.ensureMatchStoreHydrated(true);
    assert.equal(cache.getCachedMatchById(2).homeScore,4); // refresh forcé
    cache.invalidateAllActiveCaches(false);
    await pg.exec('UPDATE matches SET home_score=5 WHERE id=2');
    await cache.ensureMatchStoreHydrated();
    assert.equal(cache.getCachedMatchById(2).homeScore,5); // invalidation
    console.log('Réconciliation : actifs frais, résultats bornés, disparition, refresh et invalidation OK.');
  } finally { Date.now=realNow; Module._load=originalLoad; await pg.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
