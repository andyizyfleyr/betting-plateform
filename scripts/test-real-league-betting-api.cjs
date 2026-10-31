const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const {PGlite} = require('@electric-sql/pglite');
const {drizzle} = require('drizzle-orm/pglite');
const original = Module._load;
(async () => {
 const pg = new PGlite();
 const seed = fs.readFileSync('src/db/seed.ts','utf8');
 for (const table of ['matches','bets','combo_bets']) {
  const match=seed.match(new RegExp(`CREATE TABLE IF NOT EXISTS "${table}" \\([\\s\\S]*?\\n    \\);`)); assert(match,table); await pg.exec(match[0]);
 }
 await pg.exec(`CREATE TABLE app_user(id int primary key,currency text,balance float8);
 INSERT INTO app_user VALUES (1,'EUR',100);
 INSERT INTO matches(id,sport,league,external_league,home_team,away_team,starts_at,status,odds_home,odds_draw,odds_away,source,suspended) VALUES
 (1,'football','Premier League','usa.1','A','B',now()+interval '1 day','upcoming',2,3,4,'manual',false),
 (2,'football','Premier League','eng.1','C','D',now()+interval '1 day','upcoming',2,3,4,'manual',false);`);
 const db=drizzle(pg);
 Module._load=function(name) {
  if(name==='@/db') return {db};
  if(name==='@/db/seed') return {ensureSeeded:async()=>{}};
  if(name==='@/db/engine') return {checkpointVirtualMatchesForBet:async rows=>new Map(rows.map(r=>[r.id,r])),hydrateLiveMatchRow:r=>r};
  if(name==='@/lib/session') return {requireUserId:async()=>1};
  if(name==='@/lib/ml-engine') return {ensureMlLoaded:async()=>{}};
  if(name==='@/lib/sync-throttle') return {syncLiveMatchesThrottled:async()=>{}};
  if(name==='@/lib/betting-limits') return {getBettingLimits:async()=>({maxComboLegs:30,maxPayoutXof:10000000})};
  if(name==='@/lib/betting-limits-shared') return {limitsForCurrency:()=>({minEur:0.1,maxEur:1000,maxPayoutEur:10000})};
  if(name==='@/lib/idempotency') return {lookupIdempotencyRecord:async()=>({kind:'miss'}),computeIdempotencyHash:()=>''};
  return original.apply(this,arguments);
 };
 const {NextRequest}=require('next/server');
 const single=require('../src/app/api/bets/route.ts');
 const combo=require('../src/app/api/bets/combo/route.ts');
 const post=async(fn,body)=>{const r=await fn(new NextRequest('https://example.com/api/bets',{method:'POST',body:JSON.stringify(body)})); return [r.status,await r.json()];};
 const common={stake:1,idempotencyKey:'test-policy-12345678',expectedMaxPayoutXof:10000000};
 let [status,body]=await post(single.POST,{...common,matchId:1,selection:'home',expectedOdds:2});
 assert.equal(status,400,JSON.stringify(body)); assert.match(body.error,/compétition/i);
 [status,body]=await post(combo.POST,{...common,expectedTotalOdds:4,legs:[1,2].map(matchId=>({kind:'sport',matchId,selection:'home',expectedOdds:2}))});
 assert.equal(status,400,JSON.stringify(body)); assert.match(body.error,/compétition/i);
 assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM bets')).rows[0].n,0);
 assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM combo_bets')).rows[0].n,0);
 assert.equal((await pg.query('SELECT balance FROM app_user WHERE id=1')).rows[0].balance,100);
 await pg.close(); console.log('Paris simples/combinés : refus serveur et solde inchangé (PGlite isolé).');
})().catch(e=>{console.error(e);process.exitCode=1});
