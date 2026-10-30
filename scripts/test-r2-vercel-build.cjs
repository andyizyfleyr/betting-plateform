const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load, originalExit = process.exit, originalError = console.error, originalLog = console.log;
const originalEnv = {...process.env};
let calls = [];
Module._load = function(name) {
  if (name === 'node:child_process') return {spawnSync: (_cmd, args, options) => { calls.push({args, options}); return {status:0}; }};
  return originalLoad.apply(this, arguments);
};
console.error=()=>{}; console.log=()=>{};
process.exit = (code) => { throw new Error(`exit:${code}`); };
function run() { delete require.cache[require.resolve('./r2-vercel-build.cjs')]; require('./r2-vercel-build.cjs'); }
try {
 delete process.env.R2_SYNC_ON_BUILD;
 assert.throws(run,/exit:0/);assert.equal(calls.length,0);
 process.env.R2_SYNC_ON_BUILD='public-v1';delete process.env.VERCEL;
 assert.throws(run,/exit:1/);assert.equal(calls.length,0);
 Object.assign(process.env,{VERCEL:'1',VERCEL_ENV:'production',R2_ACCOUNT_ID:'6f3e2c1a84617db0da9cb4bf594446f2',R2_PUBLIC_BUCKET:'pulsebet'});
 assert.throws(run,/exit:1/);assert.equal(calls.length,0);
 process.env.R2_PUBLIC_BUCKET='pulsebet-public';run();assert.equal(calls.length,6);
 assert.deepEqual(calls.map(c=>c.args.slice(1)),[['--upload','--only=web'],['--verify','--only=web'],['--verify-public','--only=web'],['--upload','--only=ota-current'],['--verify','--only=ota-current'],['--verify-public','--only=ota-current']]);
 assert(calls.every(c=>c.options.env.R2_PUBLIC_BUCKET==='pulsebet-public'));
} finally { Module._load=originalLoad; process.exit=originalExit; console.error=originalError;console.log=originalLog;process.env=originalEnv; }
console.log('Pré-build R2 : opt-in, production et compartiment public vérifiés ; six opérations simulées.');
