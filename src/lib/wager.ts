import { and, eq, gte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { appUser, bets, comboBets, predictionBets } from "@/db/schema";

export const MIN_WAGER_ODDS_SINGLE = 1.3;
export const MIN_WAGER_ODDS_COMBO = 1.4;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface WithdrawalEligibility {
  balance: number;
  bonusLocked: number;
  qualifiedWagered: number;
  bonusRemaining: number;
  withdrawable: number;
}

/**
 * Calcule le solde réellement retirable d'un joueur :
 * - Le bonus d'inscription (`bonusLocked`, ex: 250 €) doit être misé 1× sur des paris réglés
 *   (hors cash-out spéculatif immédiat) à cote ≥ 1,30 (ou ≥ 1,40 en combiné).
 * - Les dépôts réels et les gains au-delà du bonus non débloqué sont immédiatement retirables.
 */
export async function computeWithdrawalEligibility(uid: number): Promise<WithdrawalEligibility> {
  const [[user], [sportSum], [predSum], [comboSum]] = await Promise.all([
    db
      .select({ balance: appUser.balance, bonusLocked: appUser.bonusLocked })
      .from(appUser)
      .where(eq(appUser.id, uid)),
    db
      .select({
        total: sql<number>`COALESCE(SUM(${bets.stake}), 0)::float8`,
      })
      .from(bets)
      .where(
        and(
          eq(bets.userId, uid),
          gte(bets.odds, MIN_WAGER_ODDS_SINGLE),
          ne(bets.status, "pending"),
          ne(bets.status, "cashed")
        )
      ),
    db
      .select({
        total: sql<number>`COALESCE(SUM(${predictionBets.stake}), 0)::float8`,
      })
      .from(predictionBets)
      .where(
        and(
          eq(predictionBets.userId, uid),
          gte(predictionBets.odds, MIN_WAGER_ODDS_SINGLE),
          ne(predictionBets.status, "pending"),
          ne(predictionBets.status, "cashed")
        )
      ),
    db
      .select({
        total: sql<number>`COALESCE(SUM(${comboBets.stake}), 0)::float8`,
      })
      .from(comboBets)
      .where(
        and(
          eq(comboBets.userId, uid),
          gte(comboBets.totalOdds, MIN_WAGER_ODDS_COMBO),
          ne(comboBets.status, "pending"),
          ne(comboBets.status, "cashed")
        )
      ),
  ]);

  const balance = round2(user?.balance ?? 0);
  const bonusLocked = round2(user?.bonusLocked ?? 0);
  const qualifiedWagered = round2(
    (sportSum?.total ?? 0) + (predSum?.total ?? 0) + (comboSum?.total ?? 0)
  );
  const bonusRemaining = round2(Math.max(0, bonusLocked - qualifiedWagered));
  const withdrawable = round2(Math.max(0, balance - bonusRemaining));

  return {
    balance,
    bonusLocked,
    qualifiedWagered,
    bonusRemaining,
    withdrawable,
  };
}
