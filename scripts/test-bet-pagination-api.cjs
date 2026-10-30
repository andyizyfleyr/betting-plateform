const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {drizzle}=require('drizzle-orm/pglite');
const original=Module._load;
(async()=>{
 const pg=new PGlite(); const seed=fs.readFileSync('src/db/seed.ts','utf8');
 for(const table of ['matches','bets','prediction_questions','prediction_bets','combo_bets']){
   const match=seed.match(new RegExp(`CREATE TABLE IF NOT EXISTS "${table}" \\([\\s\\S]*?\\n    \\);`)); assert(match,table); await pg.exec(match[0]);
 }
 await pg.exec(`ALTER TABLE prediction_bets ADD COLUMN settled_at timestamp;
 CREATE TABLE app_user(id int primary key,balance float8);
 INSERT INTO app_user VALUES (1,123),(2,999);
 INSERT INTO bets (user_id,sport,league,home_team,away_team,selection,selection_label,odds,stake,potential_win,status,placed_at,settled_at)
 SELECT 1,'football','Test','Alpha','Beta','home','Alpha',2,1,2,'won','2026-01-01 10:00:00.123456','2026-01-02 10:00:00.123456' FROM generate_series(1,45);
 INSERT INTO bets (user_id,sport,league,home_team,away_team,selection,selection_label,odds,stake,potential_win,status)
 VALUES (2,'football','Secret','X','Y','home','X',2,1,2,'won');`);
 let syncCalls=0, hydrationCalls=0;
 const queries=[]; const db=drizzle(pg,{logger:{logQuery:(query)=>queries.push(query)}});
 Module._load=function(name){
  if(name==='@/db') return {db};
  if(name==='@/db/seed') return {ensureSeeded:async()=>{}};
  if(name==='@/lib/session') return {requireUserId:async()=>1};
  if(name==='@/lib/sync-throttle') return {syncLiveMatchesThrottled:async()=>{syncCalls++}};
  if(name==='@/lib/active-state-cache') return {ensureMatchStoreHydrated:async()=>{hydrationCalls++},getCachedMatchById:()=>null,getCachedUserBetsResponse:()=>null,setCachedUserBetsResponse:(_u,_f,p)=>({json:JSON.stringify(p),etag:'x',at:Date.now()})};
  return original.apply(this,arguments);
 };
 const {GET}=require('../src/app/api/bets/route.ts'); const {NextRequest}=require('next/server');
 let cursor=null, ids=[];
 do {
  const query='filter=finished&pageSize=20'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
  queries.length=0;
  const response=await GET(new NextRequest('https://example.com/api/bets?'+query));
  // A sport-only page must not issue detail queries for empty prediction/combo kinds.
  assert(!queries.some(q=>/from "prediction_bets" (?:left join|where)/i.test(q)));
  assert(!queries.some(q=>/from "combo_bets" where/i.test(q))); 
  assert.equal(response.status,200,await response.clone().text());
  const body=await response.json(); assert(body.bets.length<=20); assert.equal(body.balance,123); ids.push(...body.bets.map(b=>b.id)); cursor=body.nextCursor;
  assert.match(response.headers.get('Vercel-CDN-Cache-Control'),/private, no-store/);
 } while(cursor);
 assert.equal(ids.length,45);assert.equal(new Set(ids).size,45);
 const old=await GET(new NextRequest('https://example.com/api/bets?filter=finished')); const oldBody=await old.json();assert.equal(oldBody.bets.length,45);assert(!('nextCursor' in oldBody));
 const beforeBad=[syncCalls,hydrationCalls];
 const bad=await GET(new NextRequest('https://example.com/api/bets?filter=finished&pageSize=20&cursor=bad!'));assert.equal(bad.status,400);
 assert.deepEqual([syncCalls,hydrationCalls],beforeBad);
 await pg.exec(`INSERT INTO matches (id,sport,league,home_team,away_team,home_score,away_score,status,starts_at,odds_home,odds_away,events)
 VALUES (900,'football','Test','Alpha','Beta',2,1,'finished',now(),2,3,'[{"huge":"blob"}]');
 INSERT INTO combo_bets (user_id,legs,base_odds,total_odds,stake,potential_win,status,placed_at,settled_at)
 VALUES (1,'[{"kind":"sport","matchId":900,"sport":"football","league":"Test","title":"Alpha – Beta","homeTeam":"Alpha","awayTeam":"Beta","market":"result","selection":"home","selectionLabel":"Alpha","odds":2,"status":"won"}]',2,2,1,2,'won',now(),now());`);
 queries.length=0;
 const comboResponse=await GET(new NextRequest('https://example.com/api/bets?filter=finished&pageSize=20'));
 assert.equal(comboResponse.status,200,await comboResponse.clone().text());
 const comboBody=await comboResponse.json();
 const combo=comboBody.bets.find(b=>b.kind==='combo');assert(combo);assert.equal(combo.legs[0].status,'won');assert.equal(combo.legs[0].matchHomeScore,2);
 const matchQuery=queries.find(q=>/from "matches" where/.test(q));assert(matchQuery);assert(!matchQuery.includes('"events"'));assert(!matchQuery.includes('"markets"'));
 console.log('API pagination : pages isolées, résultat privé, ancien contrat et curseur invalide OK (PGlite).');await pg.close();
})().catch(e=>{console.error(e);process.exitCode=1});
