#!/usr/bin/env node
// Essai ponctuel de rotation simulée, uniquement en preview sur cette branche.
// Transactions annulées, tables TEMP uniquement ; aucune donnée applicative lue.
const PILOT_BRANCH = 'arena/65f0a495-betting-plateform';
let stage = 'configuration';

function endpointId(value) {
  const u = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(u.protocol)) throw Error('invalid');
  const host = u.hostname.toLowerCase();
  if (!host.endsWith('.neon.tech')) throw Error('invalid');
  const endpoint = host.split('.')[0].replace(/-pooler$/, '');
  if (!/^ep-[a-z0-9-]+$/.test(endpoint)) throw Error('invalid');
  if (!['require', 'verify-ca', 'verify-full'].includes(u.searchParams.get('sslmode'))) throw Error('invalid');
  return endpoint;
}

function validateEnv(env) {
  // Ce test ne doit jamais s'exécuter dans un build de production ou une autre branche.
  if (env.VERCEL !== '1' || env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_COMMIT_REF !== PILOT_BRANCH) return false;
  if (!env.DATABASE_URL || !env.NEON_PILOT_URL) throw Error('missing');
  stage = 'validation source';
  const sourceId = endpointId(env.DATABASE_URL);
  stage = 'validation cible';
  const targetId = endpointId(env.NEON_PILOT_URL);
  stage = 'comparaison endpoints';
  if (sourceId === targetId) throw Error('same endpoint');
  return true;
}

async function simulate(source, target) {
  let sourceTx = false, targetTx = false;
  try {
    await source.query('BEGIN'); sourceTx = true;
    await target.query('BEGIN'); targetTx = true;
    for (const db of [source, target]) {
      await db.query("SET LOCAL statement_timeout = '5s'");
      await db.query("SET LOCAL idle_in_transaction_session_timeout = '20s'");
      await db.query('CREATE TEMP TABLE rotation_pilot_account (id integer PRIMARY KEY, cents integer NOT NULL CHECK (cents >= 0)) ON COMMIT DROP');
      await db.query('CREATE TEMP TABLE rotation_pilot_bet (id integer PRIMARY KEY, account_id integer NOT NULL REFERENCES rotation_pilot_account(id), stake integer NOT NULL) ON COMMIT DROP');
    }
    await source.query('INSERT INTO rotation_pilot_account VALUES (1, 10000)');
    await source.query('UPDATE rotation_pilot_account SET cents = cents - 1000 WHERE id = 1');
    await source.query('INSERT INTO rotation_pilot_bet VALUES (1, 1, 1000)');
    // La « pause » et la copie concernent uniquement ces tables de session fictives.
    const account = await source.query('SELECT id, cents FROM rotation_pilot_account ORDER BY id');
    const bet = await source.query('SELECT id, account_id, stake FROM rotation_pilot_bet ORDER BY id');
    if (account.rows.length !== 1 || bet.rows.length !== 1 || account.rows[0].cents !== 9000 || bet.rows[0].stake !== 1000) throw Error('source mismatch');
    for (const r of account.rows) await target.query('INSERT INTO rotation_pilot_account VALUES ($1, $2)', [r.id, r.cents]);
    for (const r of bet.rows) await target.query('INSERT INTO rotation_pilot_bet VALUES ($1, $2, $3)', [r.id, r.account_id, r.stake]);
    const copied = await target.query('SELECT a.cents, b.stake FROM rotation_pilot_account a JOIN rotation_pilot_bet b ON b.account_id=a.id');
    if (copied.rows.length !== 1 || copied.rows[0].cents !== 9000 || copied.rows[0].stake !== 1000) throw Error('copy mismatch');
    // Simule une écriture après bascule puis son annulation suite à une erreur.
    await target.query('SAVEPOINT simulated_failure');
    await target.query('UPDATE rotation_pilot_account SET cents = cents - 200 WHERE id = 1');
    await target.query('ROLLBACK TO SAVEPOINT simulated_failure');
    const restored = await target.query('SELECT cents FROM rotation_pilot_account WHERE id = 1');
    if (restored.rows.length !== 1 || restored.rows[0].cents !== 9000) throw Error('rollback mismatch');
  } finally {
    if (targetTx) await target.query('ROLLBACK').catch(() => {});
    if (sourceTx) await source.query('ROLLBACK').catch(() => {});
  }
  for (const db of [source, target]) {
    const gone = await db.query("SELECT to_regclass('pg_temp.rotation_pilot_account') AS account, to_regclass('pg_temp.rotation_pilot_bet') AS bet");
    if (gone.rows[0].account !== null || gone.rows[0].bet !== null) throw Error('temporary tables remain');
  }
}

async function main(env = process.env) {
  if (!validateEnv(env)) return;
  const { Client } = require('pg');
  const source = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 8000, query_timeout: 8000 });
  const target = new Client({ connectionString: env.NEON_PILOT_URL, connectionTimeoutMillis: 8000, query_timeout: 8000 });
  try {
    stage = 'connexion source'; await source.connect();
    stage = 'connexion cible'; await target.connect();
    stage = 'simulation'; await simulate(source, target);
    console.log('NEON_ROTATION_PILOT_V1 OK : connexion aux deux endpoints, copie et annulation fictives ; tables temporaires nettoyées.');
  } finally {
    await target.end().catch(() => {});
    await source.end().catch(() => {});
  }
}
if (require.main === module) main().catch(() => { console.error(`NEON_ROTATION_PILOT_V1 FAILED : étape ${stage}, aucune donnée ni URL affichée.`); process.exitCode = 1; });
module.exports = { endpointId, validateEnv, simulate, main, PILOT_BRANCH };
