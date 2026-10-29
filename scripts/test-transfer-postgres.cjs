// Base locale isolée uniquement : nécessite l'instance de test créée pour cette suite.
const assert = require('node:assert/strict');
const Module = require('node:module');
const { Pool } = require('pg');
const { randomBytes } = require('node:crypto');
const { drizzle } = require('drizzle-orm/node-postgres');
const original = Module._load;
(async () => {
 const connection = { host:'/home/user/pgtemp', port:55432, database:'postgres', user:'user' };
 const admin = new Pool(connection);
 const schema = `transfer_test_${randomBytes(8).toString('hex')}`;
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool = new Pool({ ...connection, max:40, options: `-c search_path=${schema}` });
 await pool.query(`
 CREATE TABLE app_user(id integer primary key,balance float8 not null,bonus_locked float8 not null default 0,currency text not null);
 CREATE TABLE admin_settings(setting_key text primary key,value jsonb,updated_at timestamp);
 CREATE TABLE bets(user_id integer,stake float8,odds float8,status text);
 CREATE TABLE prediction_bets(user_id integer,stake float8,odds float8,status text);
 CREATE TABLE combo_bets(user_id integer,stake float8,total_odds float8,status text);
 INSERT INTO app_user SELECT i, CASE WHEN i=1 THEN 1000 ELSE 0 END, 0, 'EUR' FROM generate_series(1,65) i;`);
 const db = drizzle(pool);
 Module._load = function(name) { if (name === '@/db') return {db}; return original.apply(this,arguments); };
 const {ensureTransferSchema} = require('../src/db/transfer-schema.ts'); await ensureTransferSchema();
 const {createTransfer,redeemTransfer,cancelTransfer} = require('../src/lib/transfer-code-engine.ts');
 const { CURRENCIES } = require('../src/lib/countries.ts');
 const { DEFAULT_BETTING_LIMITS, limitsForCurrency } = require('../src/lib/betting-limits-shared.ts');
 const secret='21'.repeat(32), key = i=>`isolated-test-${String(i).padStart(14,'0')}`;
 for (const [i,currency] of Object.keys(CURRENCIES).entries()) {
   const id = 100 + i;
   const {minEur,maxEur} = limitsForCurrency(DEFAULT_BETTING_LIMITS,currency);
   await pool.query('INSERT INTO app_user(id,balance,bonus_locked,currency) VALUES ($1,100000,0,$2)', [id,currency]);
   await assert.rejects(createTransfer(id, Math.max(0.000001,Math.round((minEur-0.000001)*1e6)/1e6), key(7000+i), secret));
   await assert.rejects(createTransfer(id, Math.round((maxEur+0.000001)*1e6)/1e6, key(8000+i), secret));
   const c=await createTransfer(id,minEur,key(9000+i),secret); await cancelTransfer(id,c.id);
 }
 await pool.query('DELETE FROM transfer_code_audit WHERE actor_id >= 100');
 await pool.query('DELETE FROM transfer_codes WHERE owner_id >= 100');
 await pool.query('DELETE FROM app_user WHERE id >= 100');
 let created=await createTransfer(1,10,key(1),secret);
 let results=await Promise.all(Array.from({length:40},(_,i)=>redeemTransfer(i+2,created.code,key(100+i),secret)));
 assert.equal(results.filter(r=>r.kind==='ok').length,1);
 let query=await pool.query("SELECT count(*)::int n FROM transfer_code_audit WHERE action='redeemed'"); assert.equal(query.rows[0].n,1);
 for(let i=0;i<20;i++) {
   const c=await createTransfer(1,10,key(1000+i),secret);
   const r=await Promise.all([redeemTransfer(2,c.code,key(2000+i),secret),cancelTransfer(1,c.id)]);
   assert.equal(r.filter(x=>x.kind==='ok').length,1);
 }
 // Même intention concurrente : une réservation, une seule réponse avec code.
 results=await Promise.all(Array.from({length:20},()=>createTransfer(1,10,key(9999),secret)));
 assert.equal(new Set(results.map(x=>x.id)).size,1); assert.equal(results.filter(x=>x.code).length,1);
 await cancelTransfer(1,results[0].id);
 // Échecs simultanés : le compteur persiste et se verrouille exactement à cinq.
 results=await Promise.all(Array.from({length:12},(_,i)=>redeemTransfer(60,'invalid',key(3000+i),secret)));
 assert.equal(results.filter(x=>x.kind==='invalid').length,5); assert.equal(results.filter(x=>x.kind==='blocked').length,7);
 query=await pool.query('SELECT failures,blocked_until>now() AS blocked FROM transfer_code_attempts WHERE user_id=60'); assert.equal(query.rows[0].failures,5); assert.equal(query.rows[0].blocked,true);
 query=await pool.query("SELECT (SELECT sum(balance)::numeric FROM app_user)+(SELECT coalesce(sum(amount),0) FROM transfer_codes WHERE status='new') AS total"); assert.equal(Number(query.rows[0].total),1000);
 query=await pool.query('SELECT count(*)::int n FROM app_user WHERE balance < 0'); assert.equal(query.rows[0].n,0);
 // Une panne de journalisation doit annuler également la réservation et le débit.
 const before = (await pool.query('SELECT balance FROM app_user WHERE id=1')).rows[0].balance;
 await pool.query(`ALTER TABLE transfer_code_audit ADD CONSTRAINT reject_create_test CHECK (action <> 'created') NOT VALID`);
 await assert.rejects(createTransfer(1,10,key(10001),secret));
 assert.equal((await pool.query('SELECT balance FROM app_user WHERE id=1')).rows[0].balance,before);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM transfer_codes WHERE create_key=$1',[key(10001)])).rows[0].n,0);
 await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); console.log('PostgreSQL isolé, connexions simultanées : double usage, annulation/encaissement, idempotence, blocage et conservation OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
