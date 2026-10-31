const assert = require('node:assert/strict');
const {mkdtempSync, writeFileSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const dir = mkdtempSync(path.join(tmpdir(), 'odds-validation-'));
try {
 const f = path.join(dir, 'samples.json');
 const base = {match:'a', capturedAt:'2026-09-15T12:00:00Z',resultAt:'2026-09-15T14:00:00Z', outcome:'home', modelOdds:{home:2,draw:3,away:4}, referenceOdds:{home:2.2,draw:3.5,away:3.4}};
 const run = () => spawnSync(process.execPath, ['scripts/evaluate-live-calibration.cjs',f,'2026-10-01T00:00:00Z'], {encoding:'utf8'});
 writeFileSync(f, JSON.stringify([base, {...base, match:'b', capturedAt:'2026-10-15T12:00:00Z',resultAt:'2026-10-15T14:00:00Z'}, {...base, match:'bad', resultAt:base.capturedAt}]));
 let r = run(); assert.equal(r.status, 0, r.stderr); const report = JSON.parse(r.stdout); assert.equal(report.before.matches,1); assert.equal(report.after.matches,1); assert.equal(report.skipped,1);
 writeFileSync(f, JSON.stringify([base,{...base,capturedAt:'2026-10-02T12:00:00Z',resultAt:'2026-10-02T14:00:00Z'}]));
 r=run(); assert.notEqual(r.status, 0); assert.match(r.stderr,/Fuite temporelle/);
 console.log('Évaluation historique : métriques, séparation temporelle et refus fuite OK');
} finally {rmSync(dir,{recursive:true,force:true});}
