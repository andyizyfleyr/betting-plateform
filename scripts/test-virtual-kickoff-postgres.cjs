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
 const now=Date.now()+1000;
 const gap=30*60_000;
 const future=await pool.query(`INSERT INTO matches(sport,league,home_team,away_team,starts_at,odds_home,odds_draw,odds_away) VALUES('football','Futur','Future A','Future B',$1,2,3,2) RETURNING id`,[new Date(now+gap)]);
 const futureRow=(await db.select().from(matches)).find(row=>row.id===future.rows[0].id);
 assert.equal(await claimVirtualKickoff(futureRow,now),null);
 await pool.query('DELETE FROM matches WHERE id=$1',[future.rows[0].id]);
 for(let i=0;i<20;i++) await pool.query(`INSERT INTO matches(sport,league,home_team,away_team,starts_at,odds_home,odds_draw,odds_away) VALUES('football','Test','Paris', $1, now(), 2,3,2)`,['Club '+i]);
 const all=await db.select().from(matches);
 const results=await Promise.all(all.map(row=>claimVirtualKickoff(row,now)));
 assert.equal(results.filter(Boolean).length,1);
 let r=await pool.query("SELECT count(*)::int n FROM matches WHERE status='live'"); assert.equal(r.rows[0].n,1);
 // Même des clubs différents ne peuvent pas partir simultanément.
 // La limite de 30 minutes est mesurée depuis le coup d'envoi, pas depuis la fin.
 for(let i=0;i<6;i++) await pool.query(`INSERT INTO matches(sport,league,home_team,away_team,starts_at,odds_home,odds_draw,odds_away) VALUES('football','Test',$1,$2,now(),2,3,2)`,['X'+i,'Y'+i]);
 const extra=(await db.select().from(matches)).slice(20);
 const race=await Promise.all(extra.map(row=>claimVirtualKickoff(row,now)));
 assert.equal(race.filter(Boolean).length,0);
 assert.equal(await claimVirtualKickoff(extra[0],now+gap-1),null);
 assert(await claimVirtualKickoff(extra[0],now+gap));
 r=await pool.query("SELECT count(*)::int n FROM matches WHERE status='live'"); assert.equal(r.rows[0].n,2);
 await pool.query("UPDATE matches SET status='finished', starts_at=now()-interval '8 days', finished_at=now() WHERE status='live'");
 const played=results.find(Boolean);
 const reverse=await pool.query(`INSERT INTO matches(sport,league,home_team,away_team,starts_at,odds_home,odds_draw,odds_away) VALUES('football','Test',$1,$2,now(),2,3,2) RETURNING id`,[played.awayTeam,played.homeTeam]);
 const rows=await db.select().from(matches); const again=rows.find(row=>row.id===reverse.rows[0].id);
 assert.equal(await claimVirtualKickoff(again,now),null);
 // La règle s'applique aussi six jours après, domicile/extérieur inversés.
 await pool.query("UPDATE matches SET finished_at=now()-interval '6 days 23 hours' WHERE id=$1",[played.id]);
 assert.equal(await claimVirtualKickoff(again,now),null);
 await pool.query("UPDATE matches SET finished_at=now()-interval '7 days 2 hours' WHERE id=$1",[played.id]);
 assert(await claimVirtualKickoff(again,now));
 await pool.query("UPDATE matches SET status='finished', starts_at=now()-interval '8 days', finished_at=now()-interval '8 days' WHERE id=$1",[again.id]);
 // Les alias PSG / Paris SG et OM / Marseille désignent les mêmes clubs.
 await pool.query(`INSERT INTO matches(sport,league,home_team,away_team,starts_at,finished_at,status,odds_home,odds_draw,odds_away) VALUES('football','Test','PSG','OM',now()-interval '3 days',now()-interval '3 days','finished',2,3,2)`);
 const alias=await pool.query(`INSERT INTO matches(sport,league,home_team,away_team,starts_at,odds_home,odds_draw,odds_away) VALUES('football','Test','Marseille','Paris SG',now(),2,3,2) RETURNING id`);
 const aliasRow=(await db.select().from(matches)).find(row=>row.id===alias.rows[0].id);
 assert.equal(await claimVirtualKickoff(aliasRow,now),null);
 // Aucun score ou statut n'est modifié sur le match dont le départ est refusé.
 r=await pool.query('SELECT status,home_score,away_score FROM matches WHERE id=$1',[aliasRow.id]); assert.equal(r.rows[0].status,'upcoming'); assert.equal(r.rows[0].home_score,null);
 // La purge conserve toute l'histoire des sept jours, même au-delà des 150 derniers matchs.
 await pool.query(`CREATE TABLE bets(match_id integer); CREATE TABLE combo_bets(legs jsonb);`);
 await pool.query(`INSERT INTO matches(sport,league,home_team,away_team,starts_at,finished_at,status,odds_home,odds_draw,odds_away)
   SELECT 'football','Retention','R'||i,'S'||i,now()-interval '2 days 10 minutes',now()-interval '2 days','finished',2,3,2 FROM generate_series(1,160) i`);
 await pool.query(`INSERT INTO matches(sport,league,home_team,away_team,starts_at,finished_at,status,odds_home,odds_draw,odds_away)
   SELECT 'football','Ancien','O'||i,'P'||i,now()-interval '9 days',now()-interval '9 days','finished',2,3,2 FROM generate_series(1,5) i`);
 const { pruneOldFinishedVirtualMatches }=require('../src/db/engine.ts');
 await pruneOldFinishedVirtualMatches();
 r=await pool.query("SELECT count(*)::int n FROM matches WHERE league='Retention'"); assert.equal(r.rows[0].n,160);
 r=await pool.query("SELECT count(*)::int n FROM matches WHERE league='Ancien'"); assert.equal(r.rows[0].n,0);
 await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
 console.log('PostgreSQL isolé : concurrence, limite 30 minutes, revanche et conservation des matchs OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
