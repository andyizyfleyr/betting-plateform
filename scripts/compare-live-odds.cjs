#!/usr/bin/env node
// Offline comparison only: input is a JSON array of paired, complete market snapshots.
// No credentials, scraping, production writes, or storage of player data.
const fs = require('node:fs');
const path = process.argv[2];
if (!path) { console.error('Usage: node scripts/compare-live-odds.cjs snapshots.json'); process.exit(2); }
const rows = JSON.parse(fs.readFileSync(path, 'utf8'));
if (!Array.isArray(rows)) throw new Error('Expected an array of snapshot pairs');
function fair(o) {
  const keys = Object.keys(o ?? {}).sort();
  if (keys.length < 2 || keys.some(k => typeof o[k] !== 'number' || !Number.isFinite(o[k]) || o[k] <= 1)) throw new Error('Each complete market must contain at least two valid decimal odds');
  const sum = keys.reduce((v, k) => v + 1 / o[k], 0);
  return { keys, sum, p: Object.fromEntries(keys.map(k => [k, 1 / o[k] / sum])) };
}
const report = [];
let skipped = 0;
for (const pair of rows) {
  const { ours, reference } = pair;
  if (!ours || !reference || ours.partition !== true || reference.partition !== true || !ours.match || !ours.market || !ours.period || !ours.score ||
      !Object.prototype.hasOwnProperty.call(ours, 'line') || !Object.prototype.hasOwnProperty.call(reference, 'line') ||
      !Number.isInteger(ours.minute) || !Number.isInteger(reference.minute) ||
      ['match', 'market', 'period', 'score', 'line'].some(k => ours[k] !== reference[k]) ||
      Math.abs(ours.minute - reference.minute) > 1 ||
      !Number.isFinite(Date.parse(ours.timestamp)) || !Number.isFinite(Date.parse(reference.timestamp)) ||
      Math.abs(Date.parse(ours.timestamp) - Date.parse(reference.timestamp)) > 30000) { skipped++; continue; }
  let a, b;
  try { a = fair(ours.odds); b = fair(reference.odds); } catch { skipped++; continue; }
  if (a.keys.join('\0') !== b.keys.join('\0')) { skipped++; continue; }
  report.push({ match: ours.match, market: ours.market, line: ours.line ?? null, score: ours.score, minute: ours.minute,
    overroundOurs: +a.sum.toFixed(4), overroundReference: +b.sum.toFixed(4),
    differencesPercentagePoints: Object.fromEntries(a.keys.map(k => [k, +((a.p[k] - b.p[k]) * 100).toFixed(2)])) });
}
console.log(JSON.stringify({ compared: report.length, skipped, comparisons: report }, null, 2));
