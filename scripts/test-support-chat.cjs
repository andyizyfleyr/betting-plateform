const Module = require('node:module');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { drizzle } = require('drizzle-orm/pglite');
const { NextRequest } = require('next/server');
const oldLoad = Module._load;
(async () => {
  const pg = new PGlite();
  await pg.exec(`
    CREATE TABLE app_user (id serial primary key, role text not null, notifications boolean not null default true, name text default 'Joueur');
    CREATE TABLE push_devices (token text primary key, user_id integer not null references app_user(id));
    CREATE TABLE push_outbox (token text, event_key text, title text, body text, data jsonb, unique(token,event_key));
    CREATE TABLE support_conversations (id serial primary key, user_id integer not null unique references app_user(id), created_at timestamp default now(), updated_at timestamp default now());
    CREATE TABLE support_messages (id serial primary key, conversation_id integer not null references support_conversations(id), sender_id integer not null references app_user(id), sender_role text not null, client_id text not null, body text not null, created_at timestamp default now(), read_at timestamp, unique(sender_id,client_id));
    CREATE TABLE support_presence (user_id integer primary key references app_user(id), last_seen_at timestamp default now());
    INSERT INTO app_user(id,role,name) VALUES (1,'user','Alice'),(2,'user','Bob'),(3,'admin','Admin');
    INSERT INTO push_devices VALUES ('alice',1),('bob',2),('admin',3);
  `);
  const db = drizzle(pg);
  Module._load = function(name) {
    if (name === '@/db') return { db };
    if (name === '@/db/seed') return { ensureSeeded: async () => {} };
    if (name === '@/lib/session') return { requireUserId: async req => Number(req.headers.get('x-test-user')) || require('next/server').NextResponse.json({error:'no'}, {status:401}) };
    if (name === '@/lib/push-notifications') return { schedulePushNotifications: () => {} };
    if (name === '@/lib/rate-limit') return { checkRateLimit: () => ({allowed:true}) };
    return oldLoad.apply(this, arguments);
  };
  const route = require('../src/app/api/chat/route.ts');
  const get = async (user, query='') => route.GET(new NextRequest('http://localhost/api/chat'+query, {headers:{'x-test-user':String(user)}}));
  const post = async (user, body) => route.POST(new NextRequest('http://localhost/api/chat', {method:'POST',headers:{'x-test-user':String(user),'content-type':'application/json'},body:JSON.stringify(body)}));
  assert.equal((await get(0)).status,401);
  assert.equal((await post(1,{body:'bonjour',clientId:'alice-0001'})).status,200);
  let rows = await pg.query('select * from push_outbox'); assert.equal(rows.rows.length,1); assert.equal(rows.rows[0].token,'admin');
  assert.equal((await post(1,{body:'bonjour',clientId:'alice-0001'})).status,200);
  rows = await pg.query('select * from support_messages'); assert.equal(rows.rows.length,1);
  const adminList = await (await get(3)).json(); assert.equal(adminList.conversations[0].unread,1); const id=adminList.conversations[0].id;
  await get(2,'?view=messages&id='+id); // Bob ne peut pas ouvrir la discussion d’Alice par son ID.
  const bob = await (await get(2,'?view=messages&id='+id)).json(); assert.equal(bob.messages.length,0);
  const adminChat=await (await get(3,'?view=messages&id='+id)).json(); assert.equal(adminChat.messages[0].body,'bonjour'); assert(adminChat.messages[0].read_at);
  assert.equal((await post(3,{body:'Bienvenue',conversationId:id,clientId:'admin-0001'})).status,200);
  const alice=await (await get(1,'?view=messages')).json(); assert.equal(alice.messages.length,2); assert(alice.messages[1].read_at); assert(!('last_seen_at' in alice));
  rows=await pg.query("select token from push_outbox where event_key like 'chat:%' order by token"); assert.deepEqual(rows.rows.map(r=>r.token),['admin','alice']);
  console.log('Messagerie : isolation des comptes, accusés de lecture, confidentialité admin et dédoublonnage OK');
  await pg.close();
})().catch(e => {console.error(e);process.exit(1)});
