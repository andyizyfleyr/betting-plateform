const assert=require('node:assert/strict'), Module=require('node:module'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');const {drizzle}=require('drizzle-orm/pglite');const original=Module._load;
(async()=>{
 const pg=new PGlite();const seed=fs.readFileSync('src/db/seed.ts','utf8');const ddl=seed.match(/CREATE TABLE IF NOT EXISTS "matches" \([\s\S]*?\n    \);/);assert(ddl);await pg.exec(ddl[0]);
 await pg.exec(`INSERT INTO matches(sport,league,home_team,away_team,status,starts_at,finished_at,odds_home,odds_away,source,home_score,away_score,events)
 VALUES ('football','Test','A','B','finished','2026-01-01','2026-01-02',2,3,'manual',2,1,'[]'),('football','Test','C','D','finished','2026-01-01',NULL,2,3,'virtual',0,0,'[]');`);
 const db=drizzle(pg);let enabled=false,queryCount=0;
 const {HISTORY_SQL}=require('../party/history-hyperdrive.ts');
 const data=await pg.query(HISTORY_SQL);const rows=data.rows.map(m=>({...m,startsAt:new Date(m.startsAt),finishedAt:m.finishedAt?new Date(m.finishedAt):null,markets:null,scriptedEvents:null,tickHistory:[]}));
 const {NextRequest,NextResponse}=require('next/server');
 Module._load=function(n){
 if(n==='@/db') return {db};if(n==='@/db/seed')return {ensureSeeded:async()=>{}};
 if(n==='@/lib/hyperdrive-history')return {fetchHyperdriveHistory:async()=>{queryCount++;return enabled?rows:null}};
 if(n==='@/lib/ml-engine')return {ensureMlLoaded:async()=>{}};
 if(n==='@/lib/sync-throttle')return {syncLiveMatchesThrottled:async()=>{}};
 if(n==='@/lib/response-cache')return {EDGE_CACHE_TAGS:{history:'test'},getHistoryBaseCache:()=>null,hasUnexpectedSearchParams:()=>false,isManualRefreshRequest:()=>false,rejectUnexpectedQueryParams:()=>NextResponse.json({}, {status:400}),runSingleflight:(_k,f)=>f(),setHistoryBaseCache:(items,serverTime)=>({json:JSON.stringify({matches:items,focusedMatch:null,serverTime})}),publicJsonWithEdgeCache:(_r,data,cache)=>NextResponse.json(data??JSON.parse(cache.json))};
 return original.apply(this,arguments);
 };
 const {GET}=require('../src/app/api/matches/history/route.ts');const request=()=>new NextRequest('https://example.com/api/matches/history');
 const old=await GET(request());assert.equal(old.status,200,await old.clone().text());const a=await old.json();
 enabled=true;const via=await GET(request());assert.equal(via.status,200,await via.clone().text());const b=await via.json();
 delete a.serverTime;delete b.serverTime;assert.deepEqual(b,a);assert.equal(queryCount,2);assert.equal(b.matches.length,2);
 await pg.close();console.log('Historique API : réponse identique Neon/Hyperdrive pour web et mobile (PGlite).');
})().catch(e=>{console.error(e);process.exitCode=1});
