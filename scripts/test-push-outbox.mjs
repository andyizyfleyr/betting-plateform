import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const db = new PGlite();
await db.exec(`
CREATE TABLE app_user(id integer primary key, role text, notifications boolean, notify_matches boolean default true, notify_bets boolean default true, notify_payments boolean default true, notify_disputes boolean default true);
CREATE TABLE push_devices(token text primary key, user_id integer, created_at timestamp default now());
CREATE TABLE push_outbox(id serial primary key,token text,event_key text,title text,body text,data jsonb,created_at timestamp default now(),sent_at timestamp,claimed_until timestamp,attempts integer default 0,unique(token,event_key));
CREATE TABLE bets(id integer,user_id integer,match_id integer,status text,settled_at timestamp);
CREATE TABLE prediction_bets(id integer,user_id integer,status text,settled_at timestamp);
CREATE TABLE combo_bets(id integer,user_id integer,status text,settled_at timestamp,legs jsonb default '[]');
CREATE TABLE withdrawals(id integer,user_id integer,status text,created_at timestamp,processed_at timestamp);
CREATE TABLE deposits(id integer,user_id integer,status text,created_at timestamp,updated_at timestamp);
CREATE TABLE favorite_teams(user_id integer,team_name text);
CREATE TABLE matches(id integer,home_team text,away_team text,status text,starts_at timestamp,last_goal_at timestamp,home_score integer,away_score integer);
CREATE TABLE bet_disputes(id integer,user_id integer,bet_id integer,bet_kind text,status text,created_at timestamp,updated_at timestamp);
INSERT INTO app_user(id,role,notifications) VALUES (1,'user',true),(2,'admin',true),(3,'user',false),(4,'user',true);
INSERT INTO push_devices(token,user_id,created_at) VALUES ('token1',1,now()-interval '1 hour'),('token2',2,now()-interval '1 hour'),('token3',3,now()-interval '1 hour'),('token4',4,now()-interval '1 hour');
INSERT INTO bets VALUES (1,1,10,'won',now()),(2,3,10,'lost',now());
INSERT INTO prediction_bets VALUES (1,1,'lost',now());
INSERT INTO combo_bets(id,user_id,status,settled_at) VALUES (1,1,'won',now());
INSERT INTO deposits VALUES (1,1,'credited',now(),now()),(2,1,'pending',now(),now());
INSERT INTO favorite_teams VALUES (1,'Bayern'),(4,'Milan');
INSERT INTO matches VALUES (10,'Bayern','Milan','live',now(),now(),1,0);
INSERT INTO bet_disputes VALUES (1,1,1,'sport','open',now(),now()),(2,1,1,'combo','in_review',now(),now());
INSERT INTO withdrawals VALUES (1,1,'pending',now(),null),(2,1,'rejected',now(),now());
INSERT INTO combo_bets VALUES (3,1,'pending',null,'[{"kind":"sport","matchId":10}]');
`);
const source=readFileSync('src/lib/push-notifications.ts','utf8');
let q=source.slice(source.indexOf('INSERT INTO push_outbox')); q=q.slice(0,q.indexOf('`')); await db.query(q); const first=await db.query('select token,event_key from push_outbox order by token,event_key');
assert(first.rows.length>=7); assert(!first.rows.some(x=>x.token==='token4')); assert(first.rows.some(x=>x.token==='token1' && x.event_key==='match:start:10')); assert(first.rows.some(x=>x.token==='token1' && x.event_key==='match:goal:10:1:0'));  assert(first.rows.some(x=>x.event_key==='withdrawal:user:2:rejected'));  assert(!first.rows.some(x=>x.token==='token3')); assert(first.rows.some(x=>x.event_key==='dispute:admin:1')); await db.query(q); const second=await db.query('select count(*)::int n from push_outbox'); assert.equal(second.rows[0].n,first.rows.length);
// Anciennes alertes de favoris en file : elles ne doivent plus partir.
await db.query(`INSERT INTO push_outbox(token,event_key,title,body,data) VALUES
  ('token4','match:start:10','Match commencé','ancien favori','{}'),
  ('token4','match:goal:10:1:0','But dans un match favori','ancien favori','{}'),
  ('token1','match:goal:10:9:9','But dans un match favori','ancien favori','{}')`);
await db.query("update app_user set notify_payments=false where id=1");
let claim=source.slice(source.indexOf('WITH chosen AS')); claim=claim.slice(0,claim.indexOf('`')); const a=await db.query(claim),b=await db.query(claim); const claimed=await db.query("select event_key from push_outbox where claimed_until is not null and token='token1'"); assert(claimed.rows.every(x=>!x.event_key.startsWith("deposit:") && !x.event_key.startsWith("withdrawal:user:"))); assert(!a.rows.some(x=>x.token==='token4')); assert(!a.rows.some(x=>x.title==='But dans un match favori')); assert(a.rows.some(x=>x.token==='token1' && x.title==='Match commencé')); assert(a.rows.length < first.rows.length); assert.equal(b.rows.length,0);
const monitoringSource=readFileSync('src/app/api/admin/monitoring/route.ts','utf8');
let monitoringQuery=monitoringSource.slice(monitoringSource.indexOf('      SELECT\n        (SELECT count')); monitoringQuery=monitoringQuery.slice(0,monitoringQuery.indexOf('`'));
const monitoring=await db.query(monitoringQuery); assert.equal(monitoring.rows[0].deposits_review,0); assert.equal(monitoring.rows[0].push_failed,0);
console.log(`PostgreSQL isolé : ${first.rows.length} alertes, confidentialité, dédoublonnage et verrouillage OK`); await db.close();
