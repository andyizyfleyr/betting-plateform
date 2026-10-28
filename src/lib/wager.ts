import { sql } from "drizzle-orm";
import { db } from "@/db";
import { roundEurPivot } from "@/lib/countries";

export const MIN_WAGER_ODDS_SINGLE = 1.3;
export const MIN_WAGER_ODDS_COMBO = 1.4;

export interface WithdrawalEligibility {
  balance: number;
  bonusLocked: number;
  qualifiedWagered: number;
  bonusRemaining: number;
  withdrawable: number;
}

/**
 * Calcule le solde réellement retirable d'un joueur en UNE SEULE requête SQL :
 * - Le bonus d'inscription (`bonusLocked`, ex: 250 €) doit être misé 1× sur des paris réglés
 *   (hors cash-out spéculatif immédiat) à cote ≥ 1,30 (ou ≥ 1,40 en combiné).
 * - Les dépôts réels et les gains au-delà du bonus non débloqué sont immédiatement retirables.
 * - Arrondi sur le pivot 6 décimales (`roundEurPivot`) pour préserver 100 % des montants locaux
 *   sans perte sur les 19 devises officielles (XOF, XAF, GNF, CDF, NGN, USD, CAD, EUR…).
 */
export async function computeWithdrawalEligibility(uid: number): Promise<WithdrawalEligibility> {
  const res = await db.execute(sql`
    SELECT
      COALESCE(u."balance", 0)::float8 AS balance,
      COALESCE(u."bonus_locked", 0)::float8 AS "bonusLocked",
      (
        COALESCE(
          (
            SELECT SUM(b."stake")::float8
            FROM "bets" b
            WHERE b."user_id" = ${uid}
              AND b."odds" >= ${MIN_WAGER_ODDS_SINGLE}
              AND b."status" NOT IN ('pending', 'cashed', 'void')
          ),
          0
        ) +
        COALESCE(
          (
            SELECT SUM(pb."stake")::float8
            FROM "prediction_bets" pb
            WHERE pb."user_id" = ${uid}
              AND pb."odds" >= ${MIN_WAGER_ODDS_SINGLE}
              AND pb."status" NOT IN ('pending', 'cashed', 'void')
          ),
          0
        ) +
        COALESCE(
          (
            SELECT SUM(cb."stake")::float8
            FROM "combo_bets" cb
            WHERE cb."user_id" = ${uid}
              AND cb."total_odds" >= ${MIN_WAGER_ODDS_COMBO}
              AND cb."status" NOT IN ('pending', 'cashed', 'void')
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
    qualifiedWagered?: number;
  };

  const balance = roundEurPivot(row.balance ?? 0);
  const bonusLocked = roundEurPivot(row.bonusLocked ?? 0);
  const qualifiedWagered = roundEurPivot(row.qualifiedWagered ?? 0);
  const bonusRemaining = roundEurPivot(Math.max(0, bonusLocked - qualifiedWagered));
  const withdrawable = roundEurPivot(Math.max(0, balance - bonusRemaining));

  return {
    balance,
    bonusLocked,
    qualifiedWagered,
    bonusRemaining,
    withdrawable,
  };
}
