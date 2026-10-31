const assert = require('node:assert/strict');
const Module = require('node:module');
const { NextRequest, NextResponse } = require('next/server');
const original = Module._load;
let hits = 0, cache = null, writes = 0, refresh = false;
Module._load = function(n) {
 if(n==='@/db') return {db:{select(){hits++; throw Error('central unavailable')}}};
 if(n==='@/db/seed') return {ensureSeeded:async()=>{}};
 if(n==='@/lib/ml-engine') return {ensureMlLoaded:async()=>{}};
 if(n==='@/lib/sync-throttle') return {syncLiveMatchesThrottled:async()=>{}};
 if(n==='@/lib/hyperdrive-history') return {fetchHyperdriveHistory:async()=>null};
 if(n==='@/lib/secondary-history-cache') return {readSecondaryHistory:async()=>cache,writeSecondaryHistory:async()=>{writes++}};
 if(n==='@/lib/response-cache') return {EDGE_CACHE_TAGS:{history:'test'},getHistoryBaseCache:()=>null,hasUnexpectedSearchParams:()=>false,isManualRefreshRequest:()=>refresh,rejectUnexpectedQueryParams:()=>NextResponse.json({}, {status:400}),runSingleflight:(_k,f)=>f(),setHistoryBaseCache:(items,serverTime)=>({json:JSON.stringify({matches:items,focusedMatch:null,serverTime})}),publicJsonWithEdgeCache:(_r,data,c)=>NextResponse.json(data??JSON.parse(c.json))};
 return original.apply(this,arguments);
};
(async()=>{
 const {GET}=require('../src/app/api/matches/history/route.ts');
 const request=()=>new NextRequest('https://example.com/api/matches/history');
 cache={items:[{id:1,status:'finished',homeTeam:'A',awayTeam:'B'}],serverTime:new Date().toISOString()};
 let res=await GET(request()); assert.equal(res.status,200); assert.equal((await res.json()).matches[0].id,1); assert.equal(hits,0);
 refresh=true; res=await GET(request()); assert.notEqual(res.status,200); assert(hits>0); assert.equal(writes,0);
 console.log('Historique API : cache secondaire évite la lecture centrale ; actualisation manuelle contourne le cache.');
})().catch(e=>{console.error(e); process.exitCode=1});
