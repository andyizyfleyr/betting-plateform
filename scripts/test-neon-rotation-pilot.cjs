const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { endpointId, validateEnv, simulate, main, PILOT_BRANCH } = require('./neon-rotation-pilot.cjs');
(async () => {
 const env = { VERCEL:'1', VERCEL_ENV:'preview', VERCEL_GIT_COMMIT_REF:PILOT_BRANCH,
   DATABASE_URL:'postgresql://test:test@ep-source-pooler.us-east-2.aws.neon.tech/test?sslmode=require',
   NEON_PILOT_URL:'postgresql://test:test@ep-target.us-east-2.aws.neon.tech/test?sslmode=require' };
 assert.equal(endpointId(env.DATABASE_URL),'ep-source');
 assert.equal(endpointId("psql '" + env.NEON_PILOT_URL + "'"),'ep-target');
 assert(validateEnv(env));
 for (const change of [{VERCEL_ENV:'production'}, {VERCEL_GIT_COMMIT_REF:'main'}, {VERCEL:'0'}]) assert.equal(validateEnv({...env,...change}), false);
 assert.throws(()=>validateEnv({...env,NEON_PILOT_URL:env.DATABASE_URL.replace('-pooler','')}));
 assert.throws(()=>validateEnv({...env,NEON_PILOT_URL:'postgresql://x:y@example.com/test?sslmode=require'}));
 assert.throws(()=>validateEnv({...env,NEON_PILOT_URL:''}));
 await main({}); // Local et production ne se connectent jamais.
 const src=new PGlite(), dst=new PGlite();
 try {
   await simulate(src,dst);
   let injected = false;
   const failing = { query: async (...args) => {
     if (!injected && args[0].startsWith('INSERT INTO rotation_pilot_bet VALUES')) { injected = true; throw Error('injected'); }
     return dst.query(...args);
   }};
   await assert.rejects(simulate(src, failing), /injected/);
   for (const db of [src,dst]) {
     const result = await db.query("SELECT to_regclass('pg_temp.rotation_pilot_account') AS account, to_regclass('pg_temp.rotation_pilot_bet') AS bet");
     assert.equal(result.rows[0].account, null); assert.equal(result.rows[0].bet, null);
   }
 } finally { await src.close(); await dst.close(); }
 console.log('Rotation Neon : garde preview, endpoints distincts, copie synthétique et annulation OK (PGlite).');
})().catch(()=>{console.error('Test de rotation échoué.');process.exitCode=1});
