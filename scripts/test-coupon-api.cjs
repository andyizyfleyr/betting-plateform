const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { drizzle } = require('drizzle-orm/pglite');
const original = Module._load;
(async () => {
 const pg = new PGlite();
 await pg.exec(`CREATE TABLE saved_coupons (code text primary key, legs jsonb not null, created_at timestamp not null default now());
 CREATE TABLE prediction_questions (id serial primary key, question text not null, category text not null, status text not null default 'open', resolution text, seed_value integer not null default 0, odds_yes float8 not null, odds_no float8 not null, options jsonb, volume float8 not null default 0, yes_count integer not null default 0, no_count integer not null default 0, resolves_at timestamp not null, resolved_at timestamp, created_at timestamp not null default now());
 INSERT INTO prediction_questions (id, question, category, odds_yes, odds_no, resolves_at) VALUES (1, 'Test', 'Sport', 1.75, 2.2, now() + interval '1 day');`);
 const matchCreate=fs.readFileSync('src/db/seed.ts','utf8').match(/CREATE TABLE IF NOT EXISTS "matches" \([\s\S]*?\n    \);/);
 assert(matchCreate); await pg.exec(matchCreate[0]);
 await pg.exec(`INSERT INTO matches(id,sport,league,home_team,away_team,starts_at,status,odds_home,odds_draw,odds_away,source,suspended) VALUES
 (1,'football','Premier League','Alpha','Beta',now()+interval '1 day','upcoming',2,3,4,'manual',false),
 (2,'football','Test','Gamma','Delta',now()-interval '1 minute','live',2,3,4,'manual',false),
 (3,'football','Test','Eta','Theta',now()+interval '1 hour','upcoming',2,3,4,'manual',true),
 (4,'football','Test','Iota','Kappa',now()-interval '1 minute','upcoming',2,3,4,'manual',false),
 (5,'football','MLS','Excluded','Team',now()+interval '1 day','upcoming',2,3,4,'manual',false);`);
 const db = drizzle(pg);
 Module._load = function(name) {
   if (name === '@/db') return { db, ensureHealthyDbConnection: async () => {} };
   if (name === '@/db/engine') return { hydrateLiveMatchRow: m => m };
   return original.apply(this, arguments);
 };
 const { POST, GET } = require('../src/app/api/coupons/route.ts');
 const { NextRequest } = require('next/server');
 const leg = { uid: 'pred-1', kind: 'prediction', questionId: 1, title: 'Test', league: 'Sport', market: 'yesno', selection: 'yes', selectionLabel: 'Oui', odds: 1.5 };
 const response = await POST(new NextRequest('https://example.com/api/coupons', { method:'POST', body: JSON.stringify({ legs: [leg] }) }));
 assert.equal(response.status, 200); const { code } = await response.json();
 assert.match(code, /^[A-Z0-9]{5}$/); assert.match(code, /[A-Z]/); assert.match(code, /[0-9]/);
 const stored=await pg.query('SELECT legs FROM saved_coupons WHERE code=$1',[code]);
 assert.deepEqual(stored.rows[0].legs,[{kind:'prediction',questionId:1,market:'yesno',selection:'yes'}]);
 const get = async value => { const response = await GET(new NextRequest(`https://example.com/api/coupons?code=${encodeURIComponent(value)}`)); return [response.status, await response.json()]; };
 for (const value of [code, code.toLowerCase(), `BX-${code}`]) { const [status, result] = await get(value); assert.equal(status,200); assert.equal(result.code,code); assert.equal(result.legs[0].odds,1.75); }
 await pg.query('INSERT INTO saved_coupons (code,legs) VALUES ($1,$2)', ['BX-84K2', JSON.stringify([leg])]);
 for (const value of ['BX-84K2','84K2']) { const [status, result] = await get(value); assert.equal(status,200); assert.equal(result.code,'BX-84K2'); }
 await pg.query(`INSERT INTO prediction_questions (id,question,category,odds_yes,odds_no,resolves_at) VALUES (2,'Passé','Sport',1.4,2.4,now()-interval '1 minute')`);
 const two=await POST(new NextRequest('https://example.com/api/coupons',{method:'POST',body:JSON.stringify({legs:[leg,{...leg,questionId:2}]})}));
 const twoCode=(await two.json()).code;
 let [status,result]=await get(twoCode); assert.equal(status,200); assert.equal(result.legs.length,1); assert.equal(result.skippedClosedCount,1); assert.equal(result.unavailable[0].title,'Passé');
 const fixture=(id)=>({kind:'sport',matchId:id,market:'result',selection:'home',odds:1.1});
 const mixed=await POST(new NextRequest('https://example.com/api/coupons',{method:'POST',body:JSON.stringify({legs:[fixture(1),fixture(2),fixture(3),fixture(4),fixture(5),fixture(999)]})}));
 const mixedCode=(await mixed.json()).code;
 [status,result]=await get(mixedCode); assert.equal(status,200); assert.equal(result.legs.length,1); assert.equal(result.legs[0].odds,2); assert.equal(result.skippedClosedCount,5);
 assert(result.unavailable.some(x=>x.reason==='compétition indisponible')); assert(result.unavailable.some(x=>x.title.includes('Gamma'))); assert(result.unavailable.some(x=>x.reason==='marché suspendu'));
 await pg.query("UPDATE prediction_questions SET status='closed' WHERE id=1");
 [status,result] = await get(code); assert.equal(status,200); assert.equal(result.legs.length,0); assert.equal(result.skippedClosedCount,1);
 await pg.close(); console.log('API coupons : nouveau code, anciennes APK/codes, cotes fraîches et clôture OK (PGlite isolé)');
})().catch(e => { console.error(e); process.exitCode = 1; });
