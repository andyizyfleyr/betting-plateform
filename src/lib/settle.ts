import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appUser, bets, matches, type MatchRow } from "@/db/schema";
import { settlePendingCombos } from "@/lib/combo";
import { closingOddsFor, customMarketOdds, isKnownMarket, marketSettle, realMatchSettle } from "@/lib/markets";
import { recordSettledBetMl } from "@/lib/ml-engine";

/**
 * Règlement déterministe d'un pari sportif :
 * - match réel (`source === "manual"`) : réglé strictement depuis le score officiel (zéro RNG) ;
 * - match virtuel (`source === "virtual"`) : réglé depuis le score et la chronologie simulée.
 */
function resolveBet(
  bet: { market: string; selection: string },
  match: MatchRow
): { won: boolean; voided: boolean } {
  const home = match.homeScore ?? 0;
  const away = match.awayScore ?? 0;
  if (!isKnownMarket(bet.market)) return { won: false, voided: true };
  if (match.source === "manual") {
    return realMatchSettle(bet.market, bet.selection, home, away, match.events ?? null, match.id);
  }
  return marketSettle(bet.market, bet.selection, home, away, match.events ?? null, match.id);
}

/**
 * Cote de clôture d'un pari au moment du règlement (CLV tracking) :
 * - match réel (`source === "manual"`) = cote officielle de l'admin ou cote du ticket ;
 * - match virtuel = prix du modèle probabiliste virtuel au coup de sifflet final.
 */
function closingOddsForBet(bet: { market: string; selection: string; odds?: number }, match: MatchRow): number | null {
  if (match.source === "manual") {
    if (match.markets && match.markets.length > 0) {
      const custom = customMarketOdds(match.markets, bet.market, bet.selection);
      if (custom != null) return custom;
    }
    if (bet.market === "result") {
      if (bet.selection === "home") return match.oddsHome;
      if (bet.selection === "draw") return match.oddsDraw;
      if (bet.selection === "away") return match.oddsAway;
    }
    return bet.odds ?? null;
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
      events: match.events ?? null,
      matchId: match.id,
    }
  );
}

async function settleRows(
  rows: Array<{ bet: (typeof bets.$inferSelect) & { id: number; userId: number }; match: MatchRow | null }>
) {
  for (const { bet, match } of rows) {
    if (!match) continue;
    const { won, voided } = resolveBet(bet, match);

    const payoutMultiplier = bet.payoutMultiplier ?? 1;
    const stakeReturned = bet.stakeReturned ?? 0;
    const payout = voided
      ? Math.round(bet.stake * 100) / 100 // remboursement intégral de la mise (ex. DNB nul)
      : won
        ? Math.round((bet.stake * bet.odds * payoutMultiplier + stakeReturned) * 100) / 100
        : 0;

    // CLV : capture de la cote de clôture au moment du règlement.
    const closingOdds = closingOddsForBet(bet, match);
    const nowMs = Date.now();
    const rawFinishedMs = match.finishedAt ? match.finishedAt.getTime() : nowMs;
    const minSettledMs = bet.placedAt ? bet.placedAt.getTime() + 1_000 : 0;
    const settledAt = new Date(Math.min(nowMs, Math.max(minSettledMs, rawFinishedMs)));

    await db
      .update(bets)
      .set({
        status: voided ? "void" : won ? "won" : "lost",
        ...(voided ? { potentialWin: payout } : {}),
        settledAt,
        ...(closingOdds != null ? { closingOdds } : {}),
      })
      .where(eq(bets.id, bet.id));

    if (payout > 0) {
      await db
        .update(appUser)
        .set({ balance: sql`${appUser.balance} + ${payout}` })
        .where(eq(appUser.id, bet.userId));
    }

    // Apprentissage en ligne ML réservé aux matchs virtuels pour ne jamais biaiser le calibrateur virtuel
    if (!voided && match.source === "virtual") {
      try {
        await recordSettledBetMl({
          userId: bet.userId,
          market: bet.market,
          odds: bet.odds,
          stake: bet.stake,
          won,
          payout,
        });
      } catch (mlErr) {
        console.error("[ml online bet update]", mlErr);
      }
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