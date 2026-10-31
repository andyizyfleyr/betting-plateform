const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const original = Module._load; let pg, queries=0;
class Client {
 constructor(opts){assert.equal(opts.connectionString,'test-hd')}
 async connect(){}
 async query(sql){queries++;return pg.query(sql)}
 async end(){}
}
Module._load=function(name){return name==='pg'?{Client}:original.apply(this,arguments)};
const storage=new Map();
global.caches={default:{match:async req=>storage.get(req.url)?.clone(),put:async (req,res)=>storage.set(req.url,res.clone())}};
const {hyperdriveHistory}=require('../party/history-hyperdrive.ts');
const {fetchHyperdriveHistory}=require('../src/lib/hyperdrive-history.ts');
(async()=>{
 pg=new PGlite();const seed=fs.readFileSync('src/db/seed.ts','utf8');
 const sql=seed.match(/CREATE TABLE IF NOT EXISTS "matches" \([\s\S]*?\n    \);/);assert(sql);await pg.exec(sql[0]);
 await pg.exec(`INSERT INTO matches(sport,league,home_team,away_team,status,starts_at,finished_at,odds_home,odds_away,source,events)
 SELECT 'football','T','A','B','finished','2026-01-01',CASE WHEN n%5=0 THEN NULL ELSE '2026-01-02'::timestamp END,2,3,CASE WHEN n%2=0 THEN 'manual' ELSE 'virtual' END,'[]' FROM generate_series(1,260) n`);
 const waits=[];const ctx={waitUntil:p=>waits.push(p)};const binding={connectionString:'test-hd'};const secret='long-secret-example';
 const req=(auth,extra='')=>new Request('https://example.com/internal/hyperdrive/history-v1'+extra,{headers:auth?{Authorization:'Bearer '+auth}:{}});
 assert.equal((await hyperdriveHistory(req(),binding,secret,ctx)).status,401);
 assert.equal((await hyperdriveHistory(req(secret),undefined,secret,ctx)).status,503);
 const concurrent=await Promise.all(Array.from({length:20},()=>hyperdriveHistory(req(secret),binding,secret,ctx)));
 assert(concurrent.every(r=>r.status===200));assert.equal(queries,1,'les requêtes simultanées doivent partager une lecture');
 let response=concurrent[0]; assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/private, no-store/);
 const body=await response.json();assert.equal(body.matches.length,240);assert.equal(queries,1);await Promise.all(waits);
 const expected=await pg.query(`(SELECT id FROM matches WHERE status='finished' AND source='manual' ORDER BY finished_at DESC,id DESC LIMIT 120) UNION ALL (SELECT id FROM matches WHERE status='finished' AND source<>'manual' ORDER BY finished_at DESC,id DESC LIMIT 120)`);
 assert.deepEqual(body.matches.map(x=>x.id),expected.rows.map(x=>x.id));assert(!('markets' in body.matches[0]));
 response=await hyperdriveHistory(req(secret),binding,secret,ctx);assert.equal(queries,1);assert.match(response.headers.get('Cache-Control'),/private/);
 response=await hyperdriveHistory(req(secret,'?fresh=1'),binding,secret,ctx);assert.equal(queries,2);
 Object.assign(process.env,{HYPERDRIVE_HISTORY_ENABLED:'true',VERCEL_ENV:'production',PARTYKIT_SECRET:secret});
 const oldFetch=global.fetch; global.fetch=async (_url,options)=>{assert.equal(options.headers.Authorization,'Bearer '+secret);return Response.json(body)};
 const rows=await fetchHyperdriveHistory(false);assert.equal(rows.length,240);assert(rows[0].startsAt instanceof Date);
 global.fetch=async()=>new Response('bad',{status:503}); assert.equal(await fetchHyperdriveHistory(false),null);
 global.fetch=async()=>Response.json({version:1,matches:[{id:1}]});assert.equal(await fetchHyperdriveHistory(false),null);
 process.env.VERCEL_ENV='preview';global.fetch=async()=>{throw Error('should not run')};assert.equal(await fetchHyperdriveHistory(false),null);
 global.fetch=oldFetch;await pg.close();console.log('Historique Hyperdrive : SQL, parité de sélection, accès, cache privé, rafraîchissement et repli OK (PGlite).');
})().catch(e=>{console.error(e);process.exitCode=1});
