#!/usr/bin/env node
// Offline evaluation of resolved 1X2 snapshots only. Does not fit or deploy coefficients.
const fs = require('node:fs');
const [filename, cutoff] = process.argv.slice(2);
const cutoffMs = Date.parse(cutoff ?? '');
if (!filename || !Number.isFinite(cutoffMs)) { console.error('Usage: node scripts/evaluate-live-calibration.cjs donnees.json 2026-10-01T00:00:00Z'); process.exit(2); }
const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
if (!Array.isArray(data)) throw new Error('Un tableau de snapshots est requis');
const keys = ['home', 'draw', 'away'];
const groups = { before: [], after: [] }, matchSplit = new Map();
function probabilities(prices) {
  if (!prices || keys.some(k => typeof prices[k] !== 'number' || !Number.isFinite(prices[k]) || prices[k] <= 1)) return null;
  const inv = keys.map(k => 1 / prices[k]); const sum = inv.reduce((a, b) => a + b, 0);
  return inv.map(x => x / sum);
}
let skipped = 0;
for (const r of data) {
  if (!r || typeof r.match !== 'string' || !r.match || !keys.includes(r.outcome)) { skipped++; continue; }
  const captured = Date.parse(r.capturedAt), result = Date.parse(r.resultAt), model = probabilities(r.modelOdds), reference = probabilities(r.referenceOdds);
  if (!Number.isFinite(captured) || !Number.isFinite(result) || result <= captured || !model || !reference) { skipped++; continue; }
  const group = captured < cutoffMs ? 'before' : 'after';
  if (matchSplit.has(r.match) && matchSplit.get(r.match) !== group) throw new Error(`Fuite temporelle : match ${r.match} présent des deux côtés de la coupure`);
  matchSplit.set(r.match, group);
  const target = keys.indexOf(r.outcome);
  const metrics = p => ({ logLoss: -Math.log(Math.max(p[target], 1e-12)), brier: p.reduce((s, v, i) => s + (v - (i === target ? 1 : 0)) ** 2, 0) });
  groups[group].push({match:r.match, model:metrics(model), reference:metrics(reference)});
}
function summarise(rows) {
  // Equal weight per match, rather than over-weighting matches with more snapshots.
  const matches = new Map();
  for (const r of rows) { const a = matches.get(r.match) ?? []; a.push(r); matches.set(r.match, a); }
  const mean = (side, metric) => matches.size ? [...matches.values()].reduce((sum, list) => sum + list.reduce((v, r) => v + r[side][metric], 0) / list.length, 0) / matches.size : null;
  return {matches:matches.size, snapshots:rows.length, model:{logLoss:mean('model','logLoss'),brier:mean('model','brier')}, reference:{logLoss:mean('reference','logLoss'),brier:mean('reference','brier')}};
}
console.log(JSON.stringify({skipped, before:summarise(groups.before), after:summarise(groups.after), caveat:'Évaluation descriptive uniquement : aucune calibration ni preuve de rentabilité.'}, null, 2));
