#!/usr/bin/env node
// Essai ponctuel de rotation simulée, uniquement en preview sur cette branche.
// Transactions annulées, tables TEMP uniquement ; aucune donnée applicative lue.
const PILOT_BRANCH = 'arena/65f0a495-betting-plateform';
let stage = 'configuration';

function normalizeConnection(value) {
  const text = value.trim();
  const copiedCommand = /^psql\s+'([^'\r\n]+)'\s*$/.exec(text);
  return copiedCommand ? copiedCommand[1] : text;
}
function endpointId(value) {
  let u;
  try { u = new URL(normalizeConnection(value)); } catch { throw Error('format'); }
  if (!['postgres:', 'postgresql:'].includes(u.protocol)) throw Error('scheme');
  const host = u.hostname.toLowerCase();
  if (!host.endsWith('.neon.tech')) throw Error('host');
  const endpoint = host.split('.')[0].replace(/-pooler$/, '');
  if (!/^ep-[a-z0-9-]+$/.test(endpoint)) throw Error('endpoint');
  if (!['require', 'verify-ca', 'verify-full'].includes(u.searchParams.get('sslmode'))) throw Error('ssl');
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
    // Routeur fictif en mémoire : il ne change aucune configuration applicative.
    let active = 'source';
    let paused = true;
    const writeBet = async (side, id, stake) => {
      if (paused || side !== active) throw Error('write fenced');
      const db = side === 'source' ? source : target;
      await db.query('UPDATE rotation_pilot_account SET cents = cents - $1 WHERE id = 1', [stake]);
      await db.query('INSERT INTO rotation_pilot_bet VALUES ($1, 1, $2)', [id, stake]);
    };
    const expectFenced = async (side) => {
      try { await writeBet(side, 99, 1); } catch (err) {
        if (err.message === 'write fenced') return;
        throw err;
      }
      throw Error('fence failed');
    };
    await expectFenced('source');
    active = 'target'; paused = false;
    await expectFenced('source');
    await writeBet('target', 2, 200);
    // L'échec d'une opération après bascule ne doit laisser aucune écriture partielle.
    await target.query('SAVEPOINT simulated_failure');
    await target.query('UPDATE rotation_pilot_account SET cents = cents - 300 WHERE id = 1');
    await target.query('ROLLBACK TO SAVEPOINT simulated_failure');
    const after = await target.query('SELECT cents FROM rotation_pilot_account WHERE id = 1');
    if (after.rows.length !== 1 || after.rows[0].cents !== 8800) throw Error('rollback mismatch');
    // Retour fictif : pause, recopier les nouvelles données avant réactivation source.
    paused = true;
    await expectFenced('target');
    const finalAccount = await target.query('SELECT id, cents FROM rotation_pilot_account ORDER BY id');
    const finalBets = await target.query('SELECT id, account_id, stake FROM rotation_pilot_bet ORDER BY id');
    await source.query('DELETE FROM rotation_pilot_bet');
    await source.query('DELETE FROM rotation_pilot_account');
    for (const r of finalAccount.rows) await source.query('INSERT INTO rotation_pilot_account VALUES ($1, $2)', [r.id, r.cents]);
    for (const r of finalBets.rows) await source.query('INSERT INTO rotation_pilot_bet VALUES ($1, $2, $3)', [r.id, r.account_id, r.stake]);
    const returned = await source.query('SELECT a.cents, count(b.id)::integer AS bets, sum(b.stake)::integer AS stakes FROM rotation_pilot_account a JOIN rotation_pilot_bet b ON b.account_id=a.id GROUP BY a.cents');
    if (returned.rows.length !== 1 || returned.rows[0].cents !== 8800 || returned.rows[0].bets !== 2 || returned.rows[0].stakes !== 1200) throw Error('return mismatch');
    active = 'source'; paused = false;
    await expectFenced('target');
    await writeBet('source', 3, 100);
    const verified = await source.query('SELECT a.cents, count(b.id)::integer AS bets, sum(b.stake)::integer AS stakes FROM rotation_pilot_account a JOIN rotation_pilot_bet b ON b.account_id=a.id GROUP BY a.cents');
    if (verified.rows.length !== 1 || verified.rows[0].cents !== 8700 || verified.rows[0].bets !== 3 || verified.rows[0].stakes !== 1300) throw Error('final mismatch');
  } finally {
    if (targetTx) await target.query('ROLLBACK').catch(() => {});
    if (sourceTx) await source.query('ROLLBACK').catch(() => {});
  }
  for (const db of [source, target]) {
    const gone = await db.query("SELECT to_regclass('pg_temp.rotation_pilot_account') AS account, to_regclass('pg_temp.rotation_pilot_bet') AS bet");
    if (gone.rows[0].account !== null || gone.rows[0].bet !== null) throw Error('temporary tables remain');
  }
}

// Compteurs du flux PostgreSQL côté client, après connexion : octets applicatifs,
// non le trafic réseau facturé (TLS, établissement et comptabilité Neon exclus).
function streamCounters(client) {
  const stream = client.connection?.stream;
  if (!stream || !Number.isSafeInteger(stream.bytesRead) || !Number.isSafeInteger(stream.bytesWritten)) return null;
  return { read: stream.bytesRead, written: stream.bytesWritten };
}
function counterDelta(before, after) {
  if (!before || !after || after.read < before.read || after.written < before.written) return null;
  return { read: after.read - before.read, written: after.written - before.written };
}

async function main(env = process.env) {
  if (!validateEnv(env)) return;
  const { Client } = require('pg');
  const source = new Client({ connectionString: normalizeConnection(env.DATABASE_URL), connectionTimeoutMillis: 8000, query_timeout: 8000 });
  const target = new Client({ connectionString: normalizeConnection(env.NEON_PILOT_URL), connectionTimeoutMillis: 8000, query_timeout: 8000 });
  try {
    stage = 'connexion source'; await source.connect();
    stage = 'connexion cible'; await target.connect();
    const beforeSource = streamCounters(source), beforeTarget = streamCounters(target);
    stage = 'simulation'; await simulate(source, target);
    const sourceBytes = counterDelta(beforeSource, streamCounters(source));
    const targetBytes = counterDelta(beforeTarget, streamCounters(target));
    if (sourceBytes && targetBytes) {
      console.log(`NEON_ROTATION_PILOT_PROTOCOL_BYTES source reçus=${sourceBytes.read} envoyés=${sourceBytes.written} cible reçus=${targetBytes.read} envoyés=${targetBytes.written} ; octets PostgreSQL client, hors TLS et connexions, pas quota Neon.`);
    } else {
      console.log('NEON_ROTATION_PILOT_PROTOCOL_BYTES indisponible ; aucun quota Neon mesuré.');
    }
    console.log('NEON_ROTATION_PILOT_V1 OK : copie, bascule, écritures, annulation et retour fictifs ; tables temporaires nettoyées.');
  } finally {
    await target.end().catch(() => {});
    await source.end().catch(() => {});
  }
}
if (require.main === module) main().catch((err) => { const code = ['format','scheme','host','endpoint','ssl','missing','same endpoint'].includes(err?.message) ? err.message : 'connexion ou simulation'; console.error(`NEON_ROTATION_PILOT_V1 FAILED : étape ${stage}, catégorie ${code} ; aucune donnée ni URL affichée.`); process.exitCode = 1; });
module.exports = { endpointId, validateEnv, simulate, main, PILOT_BRANCH, counterDelta };
