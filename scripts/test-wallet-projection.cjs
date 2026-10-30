const assert = require('node:assert/strict');
const Module = require('node:module');
const { PGlite } = require('@electric-sql/pglite');
const { drizzle } = require('drizzle-orm/pglite');
const original = Module._load;
(async () => {
  const pg = new PGlite();
  await pg.exec(`
    CREATE TABLE deposits (id serial primary key, user_id int, provider text, provider_ref text, amount float8, status text, created_at timestamp, idempotency_key text);
    CREATE TABLE withdrawals (id serial primary key, user_id int, method text, destination text, status text, admin_note text, amount float8, created_at timestamp);
    CREATE TABLE bets (id serial primary key, user_id int, market text, selection text, home_team text, away_team text, selection_label text, odds float8, stake float8, status text, placed_at timestamp, settled_at timestamp, potential_win float8, cash_out_amount float8);
    CREATE TABLE prediction_bets (id serial primary key, user_id int, question text, selection_label text, stake float8, status text, placed_at timestamp, settled_at timestamp, potential_win float8, cash_out_amount float8);
    CREATE TABLE combo_bets (id serial primary key, user_id int, legs jsonb, total_odds float8, stake float8, status text, placed_at timestamp, settled_at timestamp, potential_win float8, cash_out_amount float8);
    CREATE TABLE tap_history (id serial primary key, user_id int, win boolean, bet_amount float8, target_multiplier float8, crash_multiplier float8, created_at timestamp);
    CREATE TABLE accelerator_rounds (id serial primary key, user_id int, status text, cashout_multiplier float8, bet_amount float8, crash_point float8, ended_at timestamp, created_at timestamp);
    CREATE TABLE wallet_adjustments (id serial primary key, user_id int, amount float8, reason text, created_at timestamp);
    INSERT INTO deposits(user_id,provider,provider_ref,amount,status,created_at,idempotency_key)
      SELECT 1,'stripe','ref-'||n,1,'credited',now() - n*interval '1 minute','secret-not-needed' FROM generate_series(1,40) n;
    INSERT INTO deposits(user_id,provider,provider_ref,amount,status,created_at) VALUES (2,'stripe','private',999,'credited',now());
    INSERT INTO withdrawals(user_id,method,destination,status,amount,created_at) VALUES (1,'paypal','destination','approved',3,now()), (1,'paypal','destination','pending',2,now());
    INSERT INTO combo_bets(user_id,legs,total_odds,stake,status,placed_at,potential_win)
      VALUES(1, '[{"kind":"sport","title":"A"},{"kind":"sport","title":"B"}]', 3, 1, 'pending',now(),3);
  `);
  const db = drizzle(pg);
  Module._load = function(name) {
    if (name === '@/db') return {db};
    if (name === '@/db/seed') return {ensureSeeded: async () => {}};
    if (name === '@/lib/session') return {requireUserId: async () => 1};
    if (name === '@/lib/sync-throttle') return {syncAllSettlementsThrottled: async () => {}};
    if (name === '@/lib/wager') return {computeWithdrawalEligibility: async () => ({balance:10,withdrawable:10,bonusLocked:0,qualifiedWagered:0,bonusRemaining:0})};
    return original.apply(this, arguments);
  };
  const {GET} = require('../src/app/api/wallet/route.ts');
  const {NextRequest} = require('next/server');
  const response = await GET(new NextRequest('https://example.com/api/wallet'));
  assert.equal(response.status,200);
  const result = await response.json();
  assert.equal(result.summary.totalDeposited,40); // dépasse les 35 dernières lignes
  assert.equal(result.summary.totalWithdrawn,3);
  assert.equal(result.summary.pendingWithdrawals,2);
  assert.equal(result.balance,10);
  assert(result.entries.some(e => e.title === 'Mise Pari combiné (2 sél.)'));
  assert(!JSON.stringify(result).includes('private'));
  const rows = await pg.query('select * from combo_bets where user_id=1');
  const projected = await pg.query("select id, total_odds, stake, status, placed_at, settled_at, potential_win, cash_out_amount, jsonb_array_length(legs) as leg_count from combo_bets where user_id=1");
  console.log('Wallet : totaux complets, séparation utilisateurs et nombre de jambes SQL vérifiés (PGlite).');
  console.log(`Exemple de ligne combiné : ${Buffer.byteLength(JSON.stringify(rows.rows))} → ${Buffer.byteLength(JSON.stringify(projected.rows))} octets JSON (simulation locale, pas une mesure Neon).`);
  await pg.close();
})().catch(e => { console.error(e); process.exitCode=1; });
