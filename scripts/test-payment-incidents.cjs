const Module = require('node:module');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { drizzle } = require('drizzle-orm/pglite');
const { NextRequest, NextResponse } = require('next/server');
const oldLoad = Module._load;
(async () => {
  const pg = new PGlite();
  await pg.exec(`
    CREATE TABLE app_user (id integer primary key, role text, balance float8);
    CREATE TABLE deposits (id integer primary key,status text,provider text,created_at timestamp,updated_at timestamp);
    CREATE TABLE withdrawals (id integer primary key,status text,method text,created_at timestamp,processed_at timestamp);
    CREATE TABLE payment_incident_reviews (kind text,payment_id integer,state text,note text,updated_by integer,updated_at timestamp,primary key(kind,payment_id));
    CREATE TABLE payment_incident_actions (id serial primary key,kind text,payment_id integer,state text,note text,actor_id integer,created_at timestamp default now());
    INSERT INTO app_user VALUES(1,'user',100),(2,'admin',200);
    INSERT INTO deposits VALUES(1,'pending_review','mobile_money',now(),now());
    INSERT INTO withdrawals VALUES(2,'pending','mobile_money',now()-interval '25 hours',null);
  `);
  const db=drizzle(pg);
  Module._load=function(name){
    if(name==='@/db')return {db};
    if(name==='@/db/seed')return {ensureSeeded:async()=>{}};
    if(name==='@/lib/session')return {requireUserId:async req=>Number(req.headers.get('x-user')) || NextResponse.json({error:'unauthorized'},{status:401})};
    return oldLoad.apply(this,arguments);
  };
  const route=require('../src/app/api/admin/payment-incidents/route.ts');
  const req=(method,user,body)=>new NextRequest('http://localhost/api/admin/payment-incidents',{method,headers:{'x-user':String(user),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await route.GET(req('GET',1))).status,403);
  assert.equal((await route.PATCH(req('PATCH',1,{kind:'deposit',id:1,state:'resolved'}))).status,403);
  const list=await (await route.GET(req('GET',2))).json(); assert.equal(list.incidents.length,2);
  assert.equal((await route.PATCH(req('PATCH',2,{kind:'deposit',id:999,state:'resolved'}))).status,404);
  assert.equal((await route.PATCH(req('PATCH',2,{kind:'deposit',id:1,state:'investigating',note:'Contrôle'}))).status,200);
  assert.equal((await route.PATCH(req('PATCH',2,{kind:'deposit',id:1,state:'resolved',note:'Vérifié'}))).status,200);
  const records=await pg.query('select * from payment_incident_actions order by id'); assert.equal(records.rows.length,2); assert.equal(records.rows[0].actor_id,2);
  const balance=await pg.query('select balance from app_user order by id'); assert.deepEqual(balance.rows.map(x=>x.balance),[100,200]);
  const deposit=await pg.query('select status from deposits where id=1'); assert.equal(deposit.rows[0].status,'pending_review');
  console.log('Incidents : accès admin, suivi audité, absence de mutation financière OK'); await pg.close();
})().catch(e=>{console.error(e);process.exit(1)});
