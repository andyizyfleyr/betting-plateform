import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { appUser, bets, matches, type MatchRow } from "@/db/schema";
import { settlePendingCombos } from "@/lib/combo";
import {
  closingOddsFor,
  customMarketOdds,
  isKnownMarket,
  marketSettle,
  minuteNumber,
  realMatchSettle,
  tryEarlyLiveSettle,
} from "@/lib/markets";
import { recordSettledBetMl } from "@/lib/ml-engine";
import { sanitizeMatchEvents } from "@/lib/match-events";
import {
  getRealMatchSettlementMode,
  type RealMatchSettlementMode,
} from "@/lib/real-sports-feed";

/** Délai anti-VAR après un but sur match réel avant un règlement anticipé lié aux buts (90 s). */
const REAL_LIVE_GOAL_CONFIRM_MS = 90_000;

/**
 * Règlement déterministe d'un pari sportif :
 * - match réel (`source === "manual"`) : réglé strictement depuis le score officiel (zéro RNG) ;
 * - match virtuel (`source === "virtual"`) : réglé depuis le score et la chronologie simulée.
 */
function resolveBet(
  bet: { market: string; selection: string },
  match: MatchRow
): { won: boolean; voided: boolean } {
  if (match.feedStatusNote === "VOIDED") return { won: false, voided: true };
  const home = match.homeScore ?? 0;
  const away = match.awayScore ?? 0;
  if (!isKnownMarket(bet.market)) return { won: false, voided: true };
  const cleanEvents = sanitizeMatchEvents(match.events, home, away);
  if (match.source === "manual") {
    return realMatchSettle(
      bet.market,
      bet.selection,
      home,
      away,
      cleanEvents,
      match.id,
      match.htHomeScore ?? null,
      match.htAwayScore ?? null
    );
  }
  return marketSettle(bet.market, bet.selection, home, away, cleanEvents, match.id);
}

/**
 * Évalue si un pari sur un match en direct (`status === "live"`) peut être réglé immédiatement :
 * - marchés 1ère mi-temps dès que la 1re période est terminée (`MT` ou `≥ 46'`) ;
 * - marchés dont le seuil de buts est déjà irréversiblement franchi (avec garde-fou anti-VAR 90 s sur match réel).
 */
export function resolveEarlyLiveMatchBet(
  bet: { market: string; selection: string },
  match: MatchRow,
  realSettlementMode: RealMatchSettlementMode = "auto",
  nowMs = Date.now()
): { won: boolean; voided: boolean } | null {
  if (match.status !== "live") return null;
  if (match.feedStatusNote === "VOIDED") return { won: false, voided: true };
  if (match.feedStatusNote?.startsWith("POSTPONED")) return null;

  const isManual = match.source === "manual";
  if (isManual && realSettlementMode !== "auto") return null;

  const home = match.homeScore ?? 0;
  const away = match.awayScore ?? 0;
  const cleanEvents = sanitizeMatchEvents(match.events, home, away);

  const decision = tryEarlyLiveSettle(bet.market, bet.selection, {
    source: isManual ? "manual" : "virtual",
    status: match.status,
    minute: match.minute,
    homeScore: home,
    awayScore: away,
    htHomeScore: match.htHomeScore ?? match.realStats?.htHomeScore ?? null,
    htAwayScore: match.htAwayScore ?? match.realStats?.htAwayScore ?? null,
    events: cleanEvents,
    matchId: match.id,
  });

  if (!decision) return null;

  // Sur un match réel, si la décision dépend d'un but inscrit :
  // - en 2e période (`>= 46'`), les marchés purement 1ère MT (`ht_result`, `ht_total_ou`, `ht_ft`)
  //   sont déjà figés par le coup de sifflet de la pause (insensibles à la VAR de 2e période) ;
  // - pour tout autre règlement anticipé lié à un but récent, on exige 90 s de stabilité anti-VAR.
  const isSecondHalfInPlay = minuteNumber(match.minute) >= 46;
  const isPureFirstHalfMarket =
    bet.market === "ht_result" || bet.market === "ht_total_ou" || bet.market === "ht_ft";

  if (isManual && decision.dependsOnGoals && !(isSecondHalfInPlay && isPureFirstHalfMarket)) {
    if (match.suspended) return null;
    if (match.lastGoalAt && nowMs - match.lastGoalAt.getTime() < REAL_LIVE_GOAL_CONFIRM_MS) {
      return null;
    }
  }

  return { won: decision.won, voided: decision.voided };
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
  rows: Array<{
    bet: (typeof bets.$inferSelect) & { id: number; userId: number };
    match: MatchRow | null;
    overrideDecision?: { won: boolean; voided: boolean };
  }>
) {
  for (const { bet, match, overrideDecision } of rows) {
    if (!match) continue;
    const { won, voided } = overrideDecision ?? resolveBet(bet, match);

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

    const [updated] = await db
      .update(bets)
      .set({
        status: voided ? "void" : won ? "won" : "lost",
        ...(voided ? { potentialWin: payout } : {}),
        settledAt,
        ...(closingOdds != null ? { closingOdds } : {}),
      })
      .where(and(eq(bets.id, bet.id), eq(bets.status, "pending")))
      .returning({ id: bets.id });

    if (!updated) continue;

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

/**
 * Règle automatiquement :
 * 1. tous les paris « pending » dont le match est terminé (`finished`) ;
 * 2. tous les paris « pending » sur un match en direct (`live`) dont l'issue est déjà
 *    définitivement acquise ou perdue (notamment les marchés 1ère mi-temps dès `MT` / `≥ 46'`).
 */
export async function settleFinishedBets() {
  const rows = await db
    .select({ bet: bets, match: matches })
    .from(bets)
    .leftJoin(matches, eq(bets.matchId, matches.id))
    .where(
      and(
        eq(bets.status, "pending"),
        inArray(matches.status, ["finished", "live"])
      )
    );

  if (rows.length > 0) {
    const hasLiveManual = rows.some(
      (r) => r.match?.status === "live" && r.match?.source === "manual"
    );
    const realMode: RealMatchSettlementMode = hasLiveManual
      ? await getRealMatchSettlementMode()
      : "auto";
    const nowMs = Date.now();

    const toSettle: Array<{
      bet: (typeof bets.$inferSelect) & { id: number; userId: number };
      match: MatchRow | null;
      overrideDecision?: { won: boolean; voided: boolean };
    }> = [];

    for (const r of rows) {
      if (!r.match) continue;
      if (r.match.status === "finished") {
        toSettle.push(r);
      } else if (r.match.status === "live") {
        const early = resolveEarlyLiveMatchBet(r.bet, r.match, realMode, nowMs);
        if (early) {
          toSettle.push({ ...r, overrideDecision: early });
        }
      }
    }

    if (toSettle.length > 0) {
      await settleRows(toSettle);
    }
  }

  await settlePendingCombos();
}

/** Règle les paris « pending » d'un match précis (après clôture manuelle par l'admin ou fin live). */
export async function settleMatchBets(
  matchId: number,
  opts?: { skipCombos?: boolean }
) {
  const rows = await db
    .select({ bet: bets, match: matches })
    .from(bets)
    .leftJoin(matches, eq(bets.matchId, matches.id))
    .where(and(eq(bets.status, "pending"), eq(bets.matchId, matchId)));
  if (rows.length > 0) {
    await settleRows(rows);
  }
  if (!opts?.skipCombos) {
    await settlePendingCombos();
  }
}

/** Rembourse intégralement (void) tous les paris simples et sélections combinées d'un match annulé/reporté. */
export async function voidMatchBets(matchId: number) {
  const pendingRows = await db
    .select()
    .from(bets)
    .where(and(eq(bets.status, "pending"), eq(bets.matchId, matchId)));

  const now = new Date();
  for (const bet of pendingRows) {
    const refund = Math.round(bet.stake * 100) / 100;
    const [updated] = await db
      .update(bets)
      .set({
        status: "void",
        potentialWin: refund,
        settledAt: now,
      })
      .where(and(eq(bets.id, bet.id), eq(bets.status, "pending")))
      .returning({ id: bets.id });

    if (updated && refund > 0) {
      await db
        .update(appUser)
        .set({ balance: sql`${appUser.balance} + ${refund}` })
        .where(eq(appUser.id, bet.userId));
    }
  }

  await settlePendingCombos();
}
