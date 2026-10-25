import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appUser, bets, matches, type MatchRow } from "@/db/schema";
import { settlePendingCombos } from "@/lib/combo";
import { closingOddsFor, customMarketOdds, isKnownMarket, marketWin } from "@/lib/markets";

/**
 * Règlement déterministe d'un pari sportif depuis le score final du match.
 * Un marché inconnu (jamais coté côté serveur) est remboursé (void-like).
 */
function resolveBet(bet: { market: string; selection: string }, home: number, away: number): { won: boolean; voided: boolean } {
  if (!isKnownMarket(bet.market)) return { won: false, voided: true };
  return { won: marketWin(bet.market, bet.selection, home, away), voided: false };
}

/**
 * Cote de clôture d'un pari au moment du règlement (CLV tracking) :
 * - match manuel = dernier prix du marché personnalisé saisi par l'admin ;
 * - sinon = prix du modèle probabiliste au coup de sifflet final.
 */
function closingOddsForBet(bet: { market: string; selection: string }, match: MatchRow): number | null {
  if (match.source === "manual" && match.markets && match.markets.length > 0) {
    const custom = customMarketOdds(match.markets, bet.market, bet.selection);
    if (custom != null) return custom;
  }
  return closingOddsFor(
    bet.market,
    bet.selection,
    match.homeTeam,
    match.awayTeam,
    match.homeScore ?? 0,
    match.awayScore ?? 0,
    {
      homeForm: match.homeForm ?? 1,
      awayForm: match.awayForm ?? 1,
      redHome: match.redHome ?? 0,
      redAway: match.redAway ?? 0,
    }
  );
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

    // CLV : capture de la cote de clôture au moment du règlement.
    const closingOdds = closingOddsForBet(bet, match);

    await db
      .update(bets)
      .set({
        status: voided ? "won" : won ? "won" : "lost",
        ...(closingOdds != null ? { closingOdds } : {}),
      })
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
  await settlePendingCombos();
}

/** Règle les paris « pending » d'un match précis (après clôture manuelle par l'admin). */
export async function settleMatchBets(matchId: number) {
  const rows = await db
    .select({ bet: bets, match: matches })
    .from(bets)
    .leftJoin(matches, eq(bets.matchId, matches.id))
    .where(and(eq(bets.status, "pending"), eq(bets.matchId, matchId)));
  await settleRows(rows);
  await settlePendingCombos();
}