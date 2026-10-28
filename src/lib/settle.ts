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
import {
  recordSettledBetsBatchMl,
  type SettledBetMlInput,
} from "@/lib/ml-engine";
import { invalidateHouseHealthCache } from "@/lib/house-brain";
import { normalizeRealLiveMinuteLabel } from "@/lib/live-clock";
import {
  ensurePendingBetFlags,
  notifyBetsSettledOrMutated,
} from "@/lib/active-state-cache";
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

  const effMinLabel = isManual ? normalizeRealLiveMinuteLabel(match, nowMs) : match.minute;
  const decision = tryEarlyLiveSettle(bet.market, bet.selection, {
    source: isManual ? "manual" : "virtual",
    status: match.status,
    minute: effMinLabel,
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
  const isSecondHalfInPlay = minuteNumber(effMinLabel) >= 46;
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
  if (rows.length === 0) return;

  interface PlannedSettlement {
    betId: number;
    userId: number;
    market: string;
    odds: number;
    stake: number;
    won: boolean;
    voided: boolean;
    status: "won" | "lost" | "void";
    potentialWin: number;
    payout: number;
    settledAtIso: string;
    closingOdds: number | null;
    isVirtual: boolean;
  }

  const nowMs = Date.now();
  const planned = new Map<number, PlannedSettlement>();

  for (const { bet, match, overrideDecision } of rows) {
    if (!match) continue;
    const { won, voided } = overrideDecision ?? resolveBet(bet, match);

    const payoutMultiplier = bet.payoutMultiplier ?? 1;
    const stakeReturned = bet.stakeReturned ?? 0;
    const payout = voided
      ? Math.round(bet.stake * 1_000_000) / 1_000_000
      : won
        ? Math.round((bet.stake * bet.odds * payoutMultiplier + stakeReturned) * 1_000_000) / 1_000_000
        : 0;

    const closingOdds = closingOddsForBet(bet, match);
    const rawFinishedMs = match.finishedAt ? match.finishedAt.getTime() : nowMs;
    const minSettledMs = bet.placedAt ? bet.placedAt.getTime() + 1_000 : 0;
    const settledAt = new Date(Math.min(nowMs, Math.max(minSettledMs, rawFinishedMs)));

    planned.set(bet.id, {
      betId: bet.id,
      userId: bet.userId,
      market: bet.market,
      odds: bet.odds,
      stake: bet.stake,
      won,
      voided,
      status: voided ? "void" : won ? "won" : "lost",
      potentialWin: voided ? payout : bet.potentialWin,
      payout,
      settledAtIso: settledAt.toISOString(),
      closingOdds,
      isVirtual: match.source === "virtual",
    });
  }

  const batch = [...planned.values()];
  if (batch.length === 0) return;

  // Règlement atomique en UNE SEULE requête SQL CTE :
  // - met à jour tous les paris `pending` en un seul `UPDATE ... FROM (VALUES ...)`
  // - agrège par `user_id` et crédite tous les soldes gagnants/remboursés d'un seul coup
  const valuesTuples = sql.join(
    batch.map(
      (p) =>
        sql`(${p.betId}::int, ${p.status}::text, ${p.potentialWin}::float8, ${p.payout}::float8, ${p.settledAtIso}::timestamptz::timestamp, ${p.closingOdds}::float8)`
    ),
    sql`, `
  );

  const res = await db.execute(sql`
    WITH updated AS (
      UPDATE "bets" AS b
      SET
        "status" = v.status,
        "potential_win" = v.potential_win,
        "settled_at" = v.settled_at,
        "closing_odds" = COALESCE(v.closing_odds, b."closing_odds")
      FROM (VALUES ${valuesTuples}) AS v(id, status, potential_win, payout, settled_at, closing_odds)
      WHERE b."id" = v.id
        AND b."status" = 'pending'
      RETURNING b."id", b."user_id", v.payout
    ),
    credited AS (
      UPDATE "app_user" AS u
      SET "balance" = ROUND((u."balance" + agg.total_payout)::numeric, 6)::float8
      FROM (
        SELECT "user_id", SUM(payout)::float8 AS total_payout
        FROM updated
        WHERE payout > 0
        GROUP BY "user_id"
      ) AS agg
      WHERE u."id" = agg."user_id"
      RETURNING u."id"
    )
    SELECT "id" FROM updated
  `);

  const updatedIds = new Set<number>(
    (res.rows ?? []).map((r) => Number((r as { id: number | string }).id))
  );
  if (updatedIds.size === 0) return;

  const affectedUsers = [
    ...new Set(batch.filter((p) => updatedIds.has(p.betId)).map((p) => p.userId)),
  ];
  notifyBetsSettledOrMutated(affectedUsers);
  invalidateHouseHealthCache();

  // Apprentissage en ligne ML par lot unique (réservé aux matchs virtuels)
  const mlItems: SettledBetMlInput[] = [];
  for (const p of batch) {
    if (updatedIds.has(p.betId) && !p.voided && p.isVirtual) {
      mlItems.push({
        userId: p.userId,
        market: p.market,
        odds: p.odds,
        stake: p.stake,
        won: p.won,
        payout: p.payout,
      });
    }
  }

  if (mlItems.length > 0) {
    try {
      await recordSettledBetsBatchMl(mlItems);
    } catch (mlErr) {
      console.error("[ml online bet batch update]", mlErr);
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
  const flags = await ensurePendingBetFlags();
  if (!flags.hasPendingSportBets && !flags.hasPendingComboBets) {
    return;
  }

  if (flags.hasPendingSportBets) {
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
  }

  if (flags.hasPendingComboBets) {
    await settlePendingCombos();
  }
}

/** Règle en lot unique les paris « pending » de plusieurs matchs terminés en 1 seule lecture + 1 seule écriture CTE. */
export async function settleMatchesBetsBatch(
  matchIds: number[],
  opts?: { skipCombos?: boolean }
) {
  const uniqueIds = [...new Set(matchIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (uniqueIds.length === 0) return;

  const rows = await db
    .select({ bet: bets, match: matches })
    .from(bets)
    .leftJoin(matches, eq(bets.matchId, matches.id))
    .where(and(eq(bets.status, "pending"), inArray(bets.matchId, uniqueIds)));
  if (rows.length > 0) {
    await settleRows(rows);
  }
  if (!opts?.skipCombos) {
    await settlePendingCombos();
  }
}

/** Règle les paris « pending » d'un match précis (après clôture manuelle par l'admin ou fin live). */
export async function settleMatchBets(
  matchId: number,
  opts?: { skipCombos?: boolean }
) {
  await settleMatchesBetsBatch([matchId], opts);
}

/** Rembourse intégralement (void) tous les paris simples et sélections combinées d'un match annulé/reporté en 1 seule requête SQL CTE. */
export async function voidMatchBets(matchId: number) {
  await db.execute(sql`
    WITH voided AS (
      UPDATE "bets"
      SET
        "status" = 'void',
        "potential_win" = ROUND(("stake")::numeric, 6)::float8,
        "settled_at" = now()
      WHERE "match_id" = ${matchId}
        AND "status" = 'pending'
      RETURNING "user_id", "potential_win"
    )
    UPDATE "app_user" AS u
    SET "balance" = u."balance" + agg.refund
    FROM (
      SELECT "user_id", SUM("potential_win")::float8 AS refund
      FROM voided
      WHERE "potential_win" > 0
      GROUP BY "user_id"
    ) AS agg
    WHERE u."id" = agg."user_id"
  `);

  invalidateHouseHealthCache();
  await settlePendingCombos();
}
