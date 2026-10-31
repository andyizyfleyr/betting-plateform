#!/usr/bin/env node
// Summarises observations, not a proof of feed freshness or betting performance.
const fs = require('node:fs');
const filename = process.argv[2];
if (!filename) { console.error('Usage: node scripts/analyze-espn-observations.cjs observations.jsonl'); process.exit(2); }
const lines = fs.readFileSync(filename, 'utf8').split(/\r?\n/).filter(Boolean);
const summary = { samples: 0, errors: 0, rejected: 0, sourceTimestampMissing: 0, incidents: [], quoteChanges: [] };
const prev = new Map();
for (const line of lines) {
  let row; try { row = JSON.parse(line); } catch { summary.errors++; continue; }
  summary.samples++;
  if (row.error || !row.match || !row.receivedAt) { summary.errors++; continue; }
  if (!row.consistent) { summary.rejected++; continue; }
  const key = `${row.match.league}:${row.match.id}`;
  const old = prev.get(key);
  if (old) {
    const fields = ['homeScore', 'awayScore', 'redHome', 'redAway', 'period', 'state'];
    const changed = fields.filter(k => row.after?.[k] !== old.after?.[k] && row.after?.[k] != null && old.after?.[k] != null);
    if (changed.length) summary.incidents.push({match:key, observedAt:row.receivedAt, fields:changed});
    for (const q of row.quotes ?? []) {
      const previous = (old.quotes ?? []).find(x => x.providerId === q.providerId);
      if (previous && JSON.stringify([previous.result, previous.total, previous.doubleChance]) !== JSON.stringify([q.result, q.total, q.doubleChance])) summary.quoteChanges.push({match:key, observedAt:row.receivedAt, provider:q.provider});
    }
  }
  for (const q of row.quotes ?? []) if (!q.sourceUpdatedAt) summary.sourceTimestampMissing++;
  prev.set(key, row);
}
console.log(JSON.stringify(summary, null, 2));
