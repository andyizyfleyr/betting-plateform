import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appUser, bets, matches, type MatchRow } from "@/db/schema";
import { isKnownMarket, marketWin } from "@/lib/markets";

/**
 * Règlement déterministe d'un pari sportif depuis le score final du match.
 * Un marché inconnu (jamais coté côté serveur) est remboursé (void-like).
 */
function resolveBet(bet: { market: string; selection: string }, home: number, away: number): { won: boolean; voided: boolean } {
  if (!isKnownMarket(bet.market)) return { won: false, voided: true };
  return { won: marketWin(bet.market, bet.selection, home, away), voided: false };
}

async function settleRows(
  rows: Array<{ bet: (typeof bets.$inferSelect) & { id: number; userId: number }; match: MatchRow | null }>
) {
  for (const { bet, match } of rows) {
    if (!match) continue;
    const home = match.homeScore ?? 0;
    const away = match.awayScore ?? 0;
    const { won, voided } = resolveBet(bet, home, away);

    const payoutMultiplier = bet.payoutMultiplier ?? 1;
    const stakeReturned = bet.stakeReturned ?? 0;
    const payout = voided
      ? bet.stake // remboursement
      : won
        ? Math.round((bet.stake * bet.odds * payoutMultiplier + stakeReturned) * 100) / 100
        : 0;

    await db
      .update(bets)
      .set({ status: voided ? "won" : won ? "won" : "lost" })
      .where(eq(bets.id, bet.id));

    if (payout > 0) {
      await db
        .update(appUser)
        .set({ balance: sql`${appUser.balance} + ${payout}` })
        .where(eq(appUser.id, bet.userId));
    }
  }
}

/** Règle tous les paris « pending » dont le match est terminé. */
export async function settleFinishedBets() {
  const rows = await db
    .select({ bet: bets, match: matches })
    .from(bets)
    .leftJoin(matches, eq(bets.matchId, matches.id))
    .where(and(eq(bets.status, "pending"), eq(matches.status, "finished")));
  await settleRows(rows);
}

/** Règle les paris « pending » d'un match précis (après clôture manuelle par l'admin). */
export async function settleMatchBets(matchId: number) {
  const rows = await db
    .select({ bet: bets, match: matches })
    .from(bets)
    .leftJoin(matches, eq(bets.matchId, matches.id))
    .where(and(eq(bets.status, "pending"), eq(bets.matchId, matchId)));
  await settleRows(rows);
}