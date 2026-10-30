const assert = require('node:assert/strict');
const Module = require('node:module');
const loader = Module._load;
let connects=0, closed=0, queries=[], fail=false;
class Client {
  constructor(options) { assert.equal(options.connectionString,'hyperdrive:test'); }
  async connect() { connects++; if(fail) throw new Error('secret database error'); }
  async query(q) { queries.push(q); return {rows:[{id:1,homeTeam:'A',awayTeam:'B',homeScore:1,awayScore:0}]}; }
  async end() { closed++; }
}
Module._load = function(name) { return name === 'pg' ? {Client} : loader.apply(this,arguments); };
let entries = new Map();
global.caches = { default: {
  match: async req => entries.get(req.url)?.clone(),
  put: async (req,res) => entries.set(req.url,res.clone()),
} };
const { getPublicResults } = require('../party/public-results.ts');
(async () => {
 const waits=[]; const ctx={waitUntil: p=>waits.push(p)};
 const req=new Request('https://example.com/public/hyperdrive/results?x=1');
 const noBinding=await getPublicResults(req,undefined,ctx); assert.equal(noBinding.status,503); assert.equal(connects,0);
 const post=await getPublicResults(new Request(req.url,{method:'POST'}),{connectionString:'hyperdrive:test'},ctx); assert.equal(post.status,405); assert.equal(connects,0);
 const res=await getPublicResults(req,{connectionString:'hyperdrive:test'},ctx);
 assert.equal(res.status,200); assert.equal((await res.json()).results[0].homeTeam,'A');
 await Promise.all(waits); assert.equal(connects,1); assert.equal(closed,1);
 assert.match(queries[0],/status = 'finished'/); assert.match(queries[0],/LIMIT 20/); assert(!/odds|user_id|bets/i.test(queries[0]));
 const hit=await getPublicResults(new Request('https://example.com/public/hyperdrive/results?x=another'),{connectionString:'hyperdrive:test'},ctx);
 assert.equal(hit.status,200); assert.equal(connects,1);
 entries=new Map(); fail=true;
 const error=await getPublicResults(req,{connectionString:'hyperdrive:test'},ctx);
 assert.equal(error.status,503); assert(!((await error.text()).includes('secret'))); assert.equal(closed,2);
 console.log('Hyperdrive : projection publique bornée, cache, isolation preview, méthodes et erreurs vérifiés.');
})().catch(e=>{console.error(e);process.exitCode=1});
