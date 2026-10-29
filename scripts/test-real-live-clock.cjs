const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
Module._load = function(name) {
  if (name === 'react-native') return { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } };
  if (name === '@/db') return { db: {} };
  return original.apply(this, arguments);
};
const web = require('../src/lib/live-clock.ts');
const mobile = require('../mobile/src/lib/live-clock.ts');
const { parseEspnScoreboardEvent } = require('../src/lib/real-sports-feed.ts');
const { hydrateLiveMatchRow } = require('../src/db/engine.ts');
const now = Date.parse('2026-10-29T15:00:00Z');
const startsAt = new Date(now - 47 * 60000).toISOString();
const first = { id: 111, source: 'manual', status: 'live', minute: '45+2’', startsAt, htHomeScore: 0, htAwayScore: 0, realStats: { clockPeriod: 1, clockSeconds: 2780, updatedAt: new Date(now).toISOString() } };
assert.equal(web.normalizeRealLiveMinuteLabel(first, now), '45+2’');
const anchor = web.buildServerClockAnchor(first, now);
assert.equal(anchor.phase, '1H_STOPPAGE');
assert.equal(anchor.anchorSeconds, 2780);
const sample = { ...first, id: 0, clockAnchor: anchor };
for (const lib of [web, mobile]) {
  assert.equal(lib.computeLiveClockSnapshot(sample, null, now).display, '45+2’');
  assert.equal(lib.computeLiveClockSnapshot(sample, null, now).gameMinute, 45);
  assert.equal(lib.computeLiveClockSnapshot({ ...sample, clockAnchor: null }, null, now).display, '45+2’');
  assert.equal(lib.computeLiveClockSnapshot({ ...sample, minute: 'MT', clockAnchor: null }, null, now).display, 'MT');
  const resumed = { ...sample, minute: '46’', realStats: { clockPeriod: 2, clockSeconds: 2710 }, clockAnchor: { ...anchor, phase: '2H', anchorSeconds: 2710 } };
  assert.equal(lib.computeLiveClockSnapshot(resumed, null, now).display, '46’');
  const late = { ...sample, minute: '90+2’', realStats: { clockPeriod: 2, clockSeconds: 5480 }, clockAnchor: { ...anchor, phase: '2H_STOPPAGE', anchorSeconds: 5480, stoppageAdded: 2 } };
  assert.equal(lib.computeLiveClockSnapshot(late, null, now).display, '90+2’');
  assert.equal(lib.parseMatchMinuteLabel('45:30', 1).phase, '1H_STOPPAGE');
  assert.equal(lib.formatMinuteOnlyLabel('46:30', 1), '45+2’');
}
const projected = hydrateLiveMatchRow({ ...first, feedSyncedAt: new Date(now), suspended: false, events: [] }, now + 30000);
assert.equal(projected.realStats.clockPeriod, 1);
assert.equal(projected.minute, '45+2’');
assert.equal(web.isVirtualClockInput({ ...sample, source: 'virtual', clockAnchor: { ...anchor, mode: 'virtual' } }), true);
function event(clock, displayClock, period, linescores = []) { return {
  id: '123', date: startsAt, competitions: [{ date: startsAt,
    status: { period, clock, displayClock, type: { state: 'in', name: 'STATUS_IN_PROGRESS', detail: displayClock } },
    competitors: [
      { homeAway: 'home', score: '0', team: { id:'1', displayName:'Alpha' }, linescores },
      { homeAway: 'away', score: '0', team: { id:'2', displayName:'Beta' }, linescores },
    ],
  }],
}; }
for (const [clock, label, expected] of [[2730, '45:30', '45+1’'], [2780, '46:20', '45+2’'], [2780, '45+2', '45+2’'], [2780, '0:00', '45+2’']]) {
  const parsed = parseEspnScoreboardEvent(event(clock, label, 1, [{ value: 0 }]), 'eng.1', 'Test', new Date(now).toISOString());
  assert(parsed, label); assert.equal(parsed.minute, expected, label);
  assert.equal(parsed.realStats.clockPeriod, 1, label);
}
const halftime = parseEspnScoreboardEvent(event(2700, 'HT', 1), 'eng.1');
assert.equal(halftime.minute, 'MT');
const second = parseEspnScoreboardEvent(event(2710, '45:10', 2), 'eng.1');
assert.equal(second.minute, '46’');
const last = parseEspnScoreboardEvent(event(5480, '90+2', 2), 'eng.1');
assert.equal(last.minute, '90+2’');
console.log('Horloge réelle : temps additionnel 1re période, mi-temps, reprise, 90+, projection et clients web/mobile OK');
