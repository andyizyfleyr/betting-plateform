const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const handlers = {};
const entries = new Map();
let fetchCount = 0;
const cache = {
  match: async r => entries.get(r.url),
  put: async (r, v) => entries.set(r.url, v),
  keys: async () => [...entries.keys()].map(url => ({url})),
  delete: async r => entries.delete(r.url),
};
const response = (value, policy = '') => ({ value, ok: true, type: 'basic', headers: { get: () => policy }, clone() { return this; } });
const ctx = { URL, Promise, self: { location:{origin:'https://example.org'}, addEventListener:(name,cb)=>handlers[name]=cb }, caches: {open:async()=>cache}, fetch: async () => {fetchCount++;return response('network');} };
vm.runInNewContext(fs.readFileSync('public/sw-static.js','utf8'),ctx);
async function dispatch(url, opts = {}) {
 let dispatching=true, result, keepAlive;
 const e={request:{url,method:opts.method||'GET'},respondWith(p){assert(dispatching);result=p},waitUntil(p){assert(dispatching);keepAlive=p}};
 handlers.fetch(e);dispatching=false;
 if(!result) return null;
 const r=await result;await keepAlive;return r;
}
(async()=>{
 assert.equal(await dispatch('https://example.org/api/wallet'),null);
 assert.equal(await dispatch('https://other.org/images/test.png'),null);
 assert.equal(await dispatch('https://example.org/images/test.png?code=1'),null);
 assert.equal(await dispatch('https://example.org/images/test.png',{method:'POST'}),null);
 assert.equal((await dispatch('https://example.org/images/test.png')).value,'network');
 entries.set('https://example.org/images/test.png',response('cached'));
 assert.equal((await dispatch('https://example.org/images/test.png')).value,'cached');
 assert.equal(fetchCount,2);
 assert.equal(entries.get('https://example.org/images/test.png').value,'network');
 ctx.fetch=async()=>response('private','private, no-store');
 await dispatch('https://example.org/images/secret.png');
 assert(!entries.has('https://example.org/images/secret.png'));
 console.log('Service Worker : cycle de vie, revalidation et exclusion des données privées OK.');
})().catch(e=>{console.error(e);process.exitCode=1});
