// PostgreSQL local isolé : un schéma aléatoire par exécution, jamais la base de production.
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { matches } = require('../src/db/schema.ts');
const original = Module._load;
(async () => {
 const connection={host:'/home/user/virtual-pg',port:55433,database:'postgres',user:'user'};
 const admin=new Pool(connection); const schema=`virtual_test_${randomBytes(8).toString('hex')}`;
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({...connection,max:25,options:`-c search_path=${schema}`});
 const seed=fs.readFileSync('src/db/seed.ts','utf8');
 const create=seed.match(/CREATE TABLE IF NOT EXISTS "matches" \([\s\S]*?\n    \);/);
 assert(create); await pool.query(create[0]);
 const db=drizzle(pool);
 Module._load=function(name){if(name==='@/db') return {db}; return original.apply(this,arguments);};
 const { claimVirtualKickoff } = require('../src/db/virtual-kickoff.ts');
 const now=Date.now();
 for(let i=0;i<20;i++) await pool.query(`INSERT INTO matches(sport,league,home_team,away_team,starts_at,odds_home,odds_draw,odds_away) VALUES('football','Test','Paris', $1, now(), 2,3,2)`,['Club '+i]);
 const all=await db.select().from(matches);
 const results=await Promise.all(all.map(row=>claimVirtualKickoff(row,now,now)));
 assert.equal(results.filter(Boolean).length,1);
 let r=await pool.query("SELECT count(*)::int n FROM matches WHERE status='live'"); assert.equal(r.rows[0].n,1);
 // Deux instances ne doivent pas lancer la même rencontre ni dépasser quatre directs.
 for(let i=0;i<6;i++) await pool.query(`INSERT INTO matches(sport,league,home_team,away_team,starts_at,odds_home,odds_draw,odds_away) VALUES('football','Test',$1,$2,now(),2,3,2)`,['X'+i,'Y'+i]);
 const extra=(await db.select().from(matches)).slice(20);
 const race=await Promise.all(extra.map(row=>claimVirtualKickoff(row,now,now)));
 assert.equal(race.filter(Boolean).length,3);
 r=await pool.query("SELECT count(*)::int n FROM matches WHERE status='live'"); assert.equal(r.rows[0].n,4);
 await pool.query("UPDATE matches SET status='finished',finished_at=now() WHERE status='live'");
 const played=results.find(Boolean);
 const reverse=await pool.query(`INSERT INTO matches(sport,league,home_team,away_team,starts_at,odds_home,odds_draw,odds_away) VALUES('football','Test',$1,$2,now(),2,3,2) RETURNING id`,[played.awayTeam,played.homeTeam]);
 const rows=await db.select().from(matches); const again=rows.find(row=>row.id===reverse.rows[0].id);
 assert.equal(await claimVirtualKickoff(again,now,now),null);
 // Aucun score ou statut n'est modifié sur le match dont le départ est refusé.
 r=await pool.query('SELECT status,home_score,away_score FROM matches WHERE id=$1',[again.id]); assert.equal(r.rows[0].status,'upcoming'); assert.equal(r.rows[0].home_score,null);
 await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
 console.log('PostgreSQL isolé : départs simultanés, limite de quatre, revanche et conservation des matchs OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
