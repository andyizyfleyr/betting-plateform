const assert = require('node:assert/strict');
const Module = require('node:module');
const { PGlite } = require('@electric-sql/pglite');
const { drizzle } = require('drizzle-orm/pglite');
const original = Module._load;
(async () => {
  const pg = new PGlite();
  await pg.exec(`
    CREATE TABLE bets (id serial primary key,user_id int,status text,placed_at timestamp,settled_at timestamp);
    CREATE TABLE prediction_bets (id serial primary key,user_id int,status text,placed_at timestamp,settled_at timestamp);
    CREATE TABLE combo_bets (id serial primary key,user_id int,status text,placed_at timestamp,settled_at timestamp);
    INSERT INTO bets (user_id,status,placed_at,settled_at) SELECT 1,'won','2026-01-01 10:00:00.123456','2026-01-02 10:00:00.123456' FROM generate_series(1,23);
    INSERT INTO prediction_bets (user_id,status,placed_at,settled_at) SELECT 1,'lost','2026-01-01 10:00:00.123456','2026-01-02 10:00:00.123456' FROM generate_series(1,22);
    INSERT INTO combo_bets (user_id,status,placed_at,settled_at) SELECT 1,'cashed','2026-01-01 10:00:00.123456','2026-01-02 10:00:00.123456' FROM generate_series(1,21);
    INSERT INTO bets (user_id,status,placed_at,settled_at) VALUES (2,'won',now(),now()),(1,'pending',now(),null);
  `);
  const db=drizzle(pg);
  Module._load = function(name) { if(name==='@/db') return {db}; return original.apply(this,arguments); };
  const {getFinishedBetPageKeys,decodeHistoryCursor}=require('../src/lib/bet-pagination.ts');
  let cursor=null; const collected=[];
  do {
    const page=await getFinishedBetPageKeys(1,cursor);
    assert(page.keys.length <= 20);
    collected.push(...page.keys.map(k=>`${k.kind}:${k.id}`));
    cursor=page.nextCursor ? decodeHistoryCursor(page.nextCursor) : null;
    if(page.nextCursor) assert(cursor);
  } while(cursor);
  assert.equal(collected.length,66); assert.equal(new Set(collected).size,66);
  assert.equal(decodeHistoryCursor('incorrect!'),null);
  assert.equal(decodeHistoryCursor(Buffer.from(JSON.stringify({decision:'wrong'})).toString('base64url')),null);
  console.log('Pagination paris : 66 lignes sur 3 tables, égalités et microsecondes, limite 20 et isolation utilisateur OK (PGlite).');
  await pg.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
