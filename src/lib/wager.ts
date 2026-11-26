import { sql } from "drizzle-orm";
import { db } from "@/db";
import { roundEurPivot } from "@/lib/countries";
import { depositBonusSettings } from "@/lib/deposit-bonus";

/** Cotes mini de mise pour le déblocage du bonus (configurables admin). */
export function minWagerOddsSingle(): number {
  const s = depositBonusSettings();
  return s.enabled ? s.minOddsSingle : 1.01;
}
export function minWagerOddsCombo(): number {
  const s = depositBonusSettings();
  return s.enabled ? s.minOddsCombo : 1.01;
}
/** Multiplicateur de mise appliqué au bonus (4× par défaut). */
export function wagerMultiplier(): number {
  const s = depositBonusSettings();
  return s.enabled ? s.wagerMultiplier : 0;
}

export interface WithdrawalEligibility {
  balance: number;
  /** Bonus encore verrouillé (non retirable). */
  bonusLocked: number;
  /** Total des bonus de dépôt accordés. */
  bonusGranted: number;
  /** Mises à réaliser pour débloquer le bonus (`multiplicateur × bonus accordé`). */
  wagerRequired: number;
  qualifiedWagered: number;
  /** Mises restantes avant déblocage (en montant misé, pas en bonus). */
  wagerRemaining: number;
  bonusRemaining: number;
  withdrawable: number;
}

/**
 * Calcule le solde réellement retirable d'un joueur en UNE SEULE requête SQL :
 * - Le bonus de dépôt (50 % / 75 % / 100 %) est crédité sur le solde mais reste
 *   verrouillé jusqu'à ce que le joueur ait misé `4 × bonus` sur des paris réglés
 *   à cote ≥ 1,30 (ou ≥ 1,40 en combiné), placés après l'attribution du bonus.
 * - L'argent du joueur (dépôts et gains) reste retirable à tout moment.
 * - Arrondi sur le pivot 6 décimales (`roundEurPivot`) pour préserver 100 % des
 *   montants locaux sans perte sur les 19 devises officielles.
 */
export async function computeWithdrawalEligibility(uid: number): Promise<WithdrawalEligibility> {
  const minSingle = minWagerOddsSingle();
  const minCombo = minWagerOddsCombo();
  const multiplier = wagerMultiplier();

  const res = await db.execute(sql`
    SELECT
      COALESCE(u."balance", 0)::float8 AS balance,
      COALESCE(u."bonus_locked", 0)::float8 AS "bonusLocked",
      COALESCE(u."bonus_granted", 0)::float8 AS "bonusGranted",
      u."bonus_wager_start" AS "wagerStart",
      (
        COALESCE(
          (
            SELECT SUM(b."stake")::float8
            FROM "bets" b
            WHERE b."user_id" = ${uid}
              AND b."odds" >= ${minSingle}
              AND b."status" NOT IN ('pending', 'cashed', 'void')
              AND (u."bonus_wager_start" IS NULL OR b."placed_at" >= u."bonus_wager_start")
          ),
          0
        ) +
        COALESCE(
          (
            SELECT SUM(pb."stake")::float8
            FROM "prediction_bets" pb
            WHERE pb."user_id" = ${uid}
              AND pb."odds" >= ${minSingle}
              AND pb."status" NOT IN ('pending', 'cashed', 'void')
              AND (u."bonus_wager_start" IS NULL OR pb."placed_at" >= u."bonus_wager_start")
          ),
          0
        ) +
        COALESCE(
          (
            SELECT SUM(cb."stake")::float8
            FROM "combo_bets" cb
            WHERE cb."user_id" = ${uid}
              AND cb."total_odds" >= ${minCombo}
              AND cb."status" NOT IN ('pending', 'cashed', 'void')
              AND (u."bonus_wager_start" IS NULL OR cb."placed_at" >= u."bonus_wager_start")
          ),
          0
        )
      )::float8 AS "qualifiedWagered"
    FROM "app_user" u
    WHERE u."id" = ${uid}
    LIMIT 1
  `);

  const row = (res.rows?.[0] ?? {}) as {
    balance?: number;
    bonusLocked?: number;
    bonusGranted?: number;
    qualifiedWagered?: number;
  };

  const balance = roundEurPivot(row.balance ?? 0);
  const granted = roundEurPivot(row.bonusGranted ?? 0);
  const qualifiedWagered = roundEurPivot(row.qualifiedWagered ?? 0);
  const wagerRequired = roundEurPivot(granted * multiplier);
  const wagerRemaining = roundEurPivot(Math.max(0, wagerRequired - qualifiedWagered));
  const unlocked = granted > 0 && wagerRequired > 0 && qualifiedWagered + 1e-6 >= wagerRequired;
  const storedLocked = roundEurPivot(row.bonusLocked ?? 0);
  const bonusLocked = unlocked ? 0 : storedLocked;

  // Le déblocage est persisté pour que les transferts et le séquestre cessent
  // immédiatement de protéger un bonus déjà débloqué.
  if (unlocked && storedLocked > 0) {
    await db.execute(sql`
      UPDATE "app_user" SET "bonus_locked" = 0
      WHERE "id" = ${uid} AND "bonus_locked" > 0
    `);
  }

  const withdrawable = roundEurPivot(Math.max(0, balance - bonusLocked));

  return {
    balance,
    bonusLocked,
    bonusGranted: granted,
    wagerRequired,
    qualifiedWagered,
    wagerRemaining,
    bonusRemaining: bonusLocked,
    withdrawable,
  };
}
