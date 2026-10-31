const assert = require('node:assert/strict');
const { realMatchScoreModel, realMatchHalfSplitModel } = require('../src/db/fixtures.ts');
const { buildRealMatchMarkets, realMatchOddsFor, realMatchLiveProbability } = require('../src/lib/markets.ts');
const now = Date.parse('2026-10-31T12:00:00Z');
const originalNow = Date.now;
Date.now = () => now;
try {
  const input = { oddsHome: 2.1, oddsDraw: 3.3, oddsAway: 3.7, homeScore: 1, awayScore: 0, minute: 60, isLive: true };
  const signal = { pHome: .55, pDraw: .3, pAway: .15, source: 'bookmaker_live', updatedAtSec: 3600, sourceUpdatedAt: new Date(now - 10000).toISOString(), scoreHome: 1, scoreAway: 0 };
  const model = (s) => realMatchScoreModel({ ...input, realStats: { clockSeconds: 3600, liveFeedProbs: s } });
  const baseline = model(null);
  const fresh = model(signal);
  assert.notEqual(fresh.lamH, baseline.lamH, 'fresh feed should affect pricing');
  for (const stale of [
    { ...signal, sourceUpdatedAt: null },
    { ...signal, sourceUpdatedAt: new Date(now - 241000).toISOString() },
    { ...signal, sourceUpdatedAt: new Date(now + 1000).toISOString() },
    { ...signal, scoreHome: 0 },
    { ...signal, pHome: -1 },
  ]) assert.equal(model(stale).lamH, baseline.lamH, 'unverified or incompatible feed must not influence pricing');

  const custom = { key: 'highest_scoring_half', label: 'Mi-temps', short: 'MT', outcomes: [{ key:'h2', label:'2', short:'2', odds:2 }] };
  const m = { id: 1, sport: 'football', homeTeam: 'Alpha', awayTeam: 'Beta', status: 'live', startsAt: new Date(now - 75*60000), minute: '60', homeScore: 1, awayScore: 0, oddsHome:2.1, oddsDraw:3.3, oddsAway:3.7, externalId:'test', autoSync:true, markets:[custom], realStats: {clockPeriod:2, clockSeconds:3600} };
  assert(!buildRealMatchMarkets(m, now).some(g => g.key === custom.key), 'custom markets cannot bypass missing half-time score');
  assert.equal(realMatchOddsFor(m, custom.key, 'h2', now), null);
  assert.equal(realMatchLiveProbability(m, custom.key, 'h2'), null);
  assert.notEqual(realMatchLiveProbability({...m, htHomeScore:1, htAwayScore:0}, custom.key, 'h2'), null, 'verified half-time score allows pricing');
  assert(!buildRealMatchMarkets({...m, htHomeScore:2, htAwayScore:0}, now).some(g => g.key === custom.key), 'impossible half-time score is rejected');
  assert.notEqual(realMatchLiveProbability({...m, homeScore:0, awayScore:0}, custom.key, 'h2'), null, '0-0 proves half-time score');
  const stoppage = realMatchHalfSplitModel({ ...input, minute:45, minuteLabel:'45+2’', homeScore:1, awayScore:0, realStats:{clockPeriod:1} });
  assert(stoppage.htResult.home > 0.95, 'first-half stoppage retains the current score in half-time model');
  console.log('Real live pricing: source freshness, score consistency and incomplete half-time history OK');
} finally { Date.now = originalNow; }
