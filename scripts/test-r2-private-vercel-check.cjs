const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const run = env => spawnSync(process.execPath, ['scripts/r2-private-vercel-check.cjs'], { env, encoding: 'utf8' });
const clean = { ...process.env }; delete clean.R2_PRIVATE_CHECK_ON_BUILD;
assert.equal(run(clean).status, 0);
assert.equal(run({ ...clean, R2_PRIVATE_CHECK_ON_BUILD: 'synthetic-v1' }).status, 1);
assert.equal(run({ ...clean, R2_PRIVATE_CHECK_ON_BUILD: 'wrong', VERCEL: '1', VERCEL_ENV: 'production' }).status, 1);
assert.equal(run({ ...clean, R2_PRIVATE_CHECK_ON_BUILD: 'synthetic-v1', VERCEL: '1', VERCEL_ENV: 'preview' }).status, 1);
console.log('Contrôle R2 privé : opt-in explicite et production obligatoires.');
