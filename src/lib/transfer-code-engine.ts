import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrencyConfig, roundEurPivot } from "@/lib/countries";
import { DEFAULT_BETTING_LIMITS, limitsForCurrency, validateBettingLimits } from "@/lib/betting-limits-shared";
import { MIN_WAGER_ODDS_COMBO, MIN_WAGER_ODDS_SINGLE } from "@/lib/wager";
import { generateTransferCode, hashTransferCode, encryptTransferCode } from "@/lib/transfer-code-crypto";
import { isValidTransferCode } from "@/lib/transfer-code";

// Tous les résultats retournés par ces fonctions proviennent de transactions validées.
type User = { id: number; balance: number; bonus_locked: number; currency: string };
type Code = { id: string; owner_id: number; amount: string; status: string; redeemed_by: number | null; redeem_key: string | null };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const rows = <T>(result: { rows: unknown[] }) => result.rows as T[];

async function lockUser(tx: Tx, uid: number): Promise<User> {
  const [user] = rows<User>(await tx.execute(sql`SELECT id, balance, bonus_locked, currency FROM app_user WHERE id = ${uid} FOR UPDATE`));
  if (!user) throw new Error("Compte introuvable");
  return user;
}
function validKey(key: string) { return /^[a-zA-Z0-9:_-]{16,128}$/.test(key); }
function secretValid(secret: string) { return /^[a-fA-F0-9]{64}$/.test(secret); }

/** Une clé réessayée ne révèle jamais de nouveau le code ; elle permet d'annuler la réservation. */
export async function createTransfer(uid: number, amountInput: number, key: string, secret: string) {
  if (!validKey(key) || !secretValid(secret) || !Number.isFinite(amountInput) || amountInput <= 0 || roundEurPivot(amountInput) !== amountInput) throw new Error("Demande invalide");
  return db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);
    const user = await lockUser(tx, uid);
    const [existing] = rows<Code>(await tx.execute(sql`SELECT id, owner_id, amount, status, redeemed_by, redeem_key FROM transfer_codes WHERE owner_id=${uid} AND create_key=${key}`));
    if (existing) {
      if (Number(existing.amount) !== amountInput) throw new Error("Clé déjà utilisée pour un autre montant");
      return { id: existing.id, status: existing.status, amount: Number(existing.amount), balance: user.balance, code: null };
    }
    const cfg = getCurrencyConfig(user.currency);
    const [settings] = rows<{ value: unknown }>(await tx.execute(sql`SELECT value FROM admin_settings WHERE setting_key='betting_limits_v1'`));
    const limits = limitsForCurrency(validateBettingLimits(settings?.value) ?? DEFAULT_BETTING_LIMITS, cfg.code);
    const min = limits.minEur;
    const max = limits.maxEur;
    if (amountInput < min || amountInput > max) throw new Error("Montant hors limites");
    // Le verrou utilisateur sérialise les débits ; le bonus est recalculé dans la même transaction.
    const [wager] = rows<{ total: number }>(await tx.execute(sql`SELECT (
      COALESCE((SELECT SUM(stake) FROM bets WHERE user_id=${uid} AND odds >= ${MIN_WAGER_ODDS_SINGLE} AND status NOT IN ('pending','cashed','void')),0) +
      COALESCE((SELECT SUM(stake) FROM prediction_bets WHERE user_id=${uid} AND odds >= ${MIN_WAGER_ODDS_SINGLE} AND status NOT IN ('pending','cashed','void')),0) +
      COALESCE((SELECT SUM(stake) FROM combo_bets WHERE user_id=${uid} AND total_odds >= ${MIN_WAGER_ODDS_COMBO} AND status NOT IN ('pending','cashed','void')),0)
    )::float8 AS total`));
    const lockedBonus = Math.max(0, Number(user.bonus_locked) - Number(wager.total));
    if (amountInput > roundEurPivot(Math.max(0, Number(user.balance) - lockedBonus))) throw new Error("Solde transférable insuffisant");
    const code = generateTransferCode();
    const hash = hashTransferCode(code, secret);
    const ciphertext = encryptTransferCode(code, secret, uid);
    const [debited] = rows<{ balance: number }>(await tx.execute(sql`UPDATE app_user SET balance=ROUND((balance-${amountInput})::numeric,6)::float8 WHERE id=${uid} AND balance >= ${amountInput} RETURNING balance`));
    if (!debited) throw new Error("Solde transférable insuffisant");
    const [created] = rows<{ id: string }>(await tx.execute(sql`INSERT INTO transfer_codes(owner_id,code_hash,code_ciphertext,create_key,amount) VALUES (${uid},${hash},${ciphertext},${key},${amountInput}) RETURNING id`));
    await tx.execute(sql`INSERT INTO transfer_code_audit(transfer_id,actor_id,action,amount) VALUES (${created.id},${uid},'created',${amountInput})`);
    return { id: created.id, status: "new", amount: amountInput, balance: debited.balance, code };
  });
}

/** Un utilisateur ne peut créditer son propre code ; échecs et blocage sont persistés. */
export async function redeemTransfer(uid: number, code: string, key: string, secret: string) {
  if (!validKey(key) || !secretValid(secret)) throw new Error("Demande invalide");
  return db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);
    const user = await lockUser(tx, uid);
    await tx.execute(sql`INSERT INTO transfer_code_attempts(user_id) VALUES (${uid}) ON CONFLICT DO NOTHING`);
    const [attempt] = rows<{ failures: number; blocked: boolean }>(await tx.execute(sql`SELECT failures, COALESCE(blocked_until > now(),false) AS blocked FROM transfer_code_attempts WHERE user_id=${uid} FOR UPDATE`));
    if (attempt.blocked) {
      await tx.execute(sql`INSERT INTO transfer_code_audit(actor_id,action) VALUES (${uid},'blocked')`);
      return { kind: "blocked" as const };
    }
    // Les formats erronés comptent aussi comme des essais, sans stocker la saisie.
    const normalized = /^[\d\s-]+$/.test(code) ? code.replace(/[\s-]/g, "") : "";
    const hash = isValidTransferCode(normalized) ? hashTransferCode(normalized, secret) : "invalid";
    const [prior] = rows<{ code_hash: string; amount: string }>(await tx.execute(sql`SELECT code_hash, amount FROM transfer_codes WHERE redeemed_by=${uid} AND redeem_key=${key}`));
    if (prior?.code_hash === hash) return { kind: "ok" as const, amount: Number(prior.amount), balance: user.balance, duplicate: true };
    const [row] = prior ? [] : rows<Code>(await tx.execute(sql`SELECT id,owner_id,amount,status,redeemed_by,redeem_key FROM transfer_codes WHERE code_hash=${hash} FOR UPDATE`));
    if (row && row.status === 'used' && row.redeemed_by === uid && row.redeem_key === key) return { kind: "ok" as const, amount: Number(row.amount), balance: user.balance, duplicate: true };
    if (!row || row.status !== 'new' || row.owner_id === uid) {
      await tx.execute(sql`UPDATE transfer_code_attempts SET failures=CASE WHEN blocked_until IS NOT NULL AND blocked_until <= now() THEN 1 ELSE failures+1 END, blocked_until=CASE WHEN (CASE WHEN blocked_until IS NOT NULL AND blocked_until <= now() THEN 1 ELSE failures+1 END) >= 5 THEN now()+interval '15 minutes' ELSE NULL END WHERE user_id=${uid}`);
      await tx.execute(sql`INSERT INTO transfer_code_audit(actor_id,action) VALUES (${uid},'failed')`);
      return { kind: "invalid" as const };
    }
    await tx.execute(sql`UPDATE transfer_codes SET status='used', redeemed_by=${uid}, redeem_key=${key}, updated_at=now() WHERE id=${row.id}`);
    const [credited] = rows<{ balance: number }>(await tx.execute(sql`UPDATE app_user SET balance=ROUND((balance+${Number(row.amount)})::numeric,6)::float8 WHERE id=${uid} RETURNING balance`));
    await tx.execute(sql`UPDATE transfer_code_attempts SET failures=0,blocked_until=NULL WHERE user_id=${uid}`);
    await tx.execute(sql`INSERT INTO transfer_code_audit(transfer_id,actor_id,action,amount) VALUES (${row.id},${uid},'redeemed',${Number(row.amount)})`);
    return { kind: "ok" as const, amount: Number(row.amount), balance: credited.balance, duplicate: false };
  });
}

export async function cancelTransfer(uid: number, id: string) {
  if (!/^\d{1,18}$/.test(id)) throw new Error("Demande invalide");
  return db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);
    const user = await lockUser(tx, uid);
    const [row] = rows<Code>(await tx.execute(sql`SELECT id,owner_id,amount,status,redeemed_by,redeem_key FROM transfer_codes WHERE id=${id} AND owner_id=${uid} FOR UPDATE`));
    if (!row || row.status === 'used') return { kind: "invalid" as const };
    if (row.status === 'cancelled') return { kind: "ok" as const, balance: user.balance, duplicate: true };
    await tx.execute(sql`UPDATE transfer_codes SET status='cancelled',updated_at=now() WHERE id=${id}`);
    const [refunded] = rows<{ balance: number }>(await tx.execute(sql`UPDATE app_user SET balance=ROUND((balance+${Number(row.amount)})::numeric,6)::float8 WHERE id=${uid} RETURNING balance`));
    await tx.execute(sql`INSERT INTO transfer_code_audit(transfer_id,actor_id,action,amount) VALUES (${id},${uid},'cancelled',${Number(row.amount)})`);
    return { kind: "ok" as const, balance: refunded.balance, duplicate: false };
  });
}
