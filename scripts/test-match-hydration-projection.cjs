const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { drizzle } = require('drizzle-orm/pglite');
const { eq, and, ne } = require('drizzle-orm');
const { unionAll } = require('drizzle-orm/pg-core');
const { matches } = require('../src/db/schema.ts');
const { fullHydrationColumns, finishedRealHydrationColumns } = require('../src/lib/match-hydration-projection.ts');
const { serializePublicMatch, serializeSlimPublicMatch } = require('../src/lib/match-serializer.ts');

(async () => {
  const pg = new PGlite();
  try {
    const ddl = fs.readFileSync('src/db/seed.ts', 'utf8').match(/CREATE TABLE IF NOT EXISTS "matches" \([\s\S]*?\n    \);/);
    assert(ddl); await pg.exec(ddl[0]);
    const ticks = [{minute: 20, market: 'sim', selection: 'clock', from: 0, to: 20}, ...Array.from({length: 100}, (_, i) => ({minute: i, market: 'result', selection: 'home', from: 2, to: 1.9}))];
    const scripted = [{minute: 10, type: 'goal', team: 'home'}];
    for (const [status, source] of [['finished','manual'], ['live','manual'], ['live','virtual'], ['finished','virtual']]) {
      await pg.query(`INSERT INTO matches(sport,league,home_team,away_team,status,starts_at,finished_at,odds_home,odds_away,source,home_score,away_score,tick_history,scripted_events,events)
       VALUES ('football','test','A','B',$1,'2026-01-01','2026-01-02',2,3,$2,2,1,$3::jsonb,$4::jsonb,'[]'::jsonb)`, [status,source,JSON.stringify(ticks),JSON.stringify(scripted)]);
    }
    const db = drizzle(pg);
    const active = db.select(fullHydrationColumns).from(matches).where(ne(matches.status,'finished'));
    const real = db.select(finishedRealHydrationColumns).from(matches).where(and(eq(matches.status,'finished'),eq(matches.source,'manual')));
    const virtual = db.select(fullHydrationColumns).from(matches).where(and(eq(matches.status,'finished'),ne(matches.source,'manual')));
    const projected = await unionAll(active, real, virtual);
    const originals = await db.select().from(matches);
    assert.equal(projected.length, originals.length);
    for (const row of projected) {
      const original = originals.find(r => r.id === row.id);
      assert(original);
      if (row.source === 'manual' && row.status === 'finished') {
        assert.deepEqual(row.tickHistory, []); assert.equal(row.scriptedEvents, null);
        assert.deepEqual({...row, tickHistory: original.tickHistory, scriptedEvents: original.scriptedEvents}, original);
        assert.deepEqual(serializePublicMatch(row, Date.parse('2026-01-03')), serializePublicMatch(original, Date.parse('2026-01-03')));
        assert.deepEqual(serializeSlimPublicMatch(row, Date.parse('2026-01-03')), serializeSlimPublicMatch(original, Date.parse('2026-01-03')));
        assert(Buffer.byteLength(JSON.stringify(row)) < Buffer.byteLength(JSON.stringify(original)));
      } else assert.deepEqual(row, original);
    }
    assert.equal((await db.select().from(matches).where(eq(matches.id, 1)))[0].tickHistory.length, 101);
    const activeVirtual = projected.find(r => r.status === 'live' && r.source === 'virtual');
    assert(activeVirtual.tickHistory.some(t => t.market === 'sim' && t.selection === 'clock' && t.to === 20));
    assert.deepEqual(activeVirtual.scriptedEvents, scripted);
    console.log('Hydratation : curseur de simulation et scénario actif préservés, parité API et base inchangée.');
  } finally { await pg.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
