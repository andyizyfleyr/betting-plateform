import { livePricingMinute, type RealMatchLiveStatsInput } from "@/db/fixtures";
import {
  isFirstHalfCompleted,
  isKnownMarket,
  isRealMatchPostIncidentSuspended,
  liveOutcomeProbability,
  minuteNumber,
  realMatchLiveProbability,
  tryEarlyLiveSettle,
  type CustomMarketGroup,
} from "@/lib/markets";

export interface LiveIncidentSnapshot {
  homeScore: number;
  awayScore: number;
  redHome: number;
  redAway: number;
}

const STALE_LIVE_FEED_MAX_MS = 90_000;

/**
 * Vérifie en mémoire (sans I/O) si un match en direct viole les garde-fous anti-but / anti-carton rouge
 * ou si un but / carton rouge est survenu depuis la prise d'empreinte `initialSnap`.
 */
export function checkLiveMatchCashOutGuard(
  effectiveMatch: {
    status: string;
    source?: string | null;
    suspended?: boolean | null;
    lastGoalAt?: Date | string | null;
    externalId?: string | null;
    autoSync?: boolean | null;
    feedSyncedAt?: Date | string | null;
    minute?: string | null;
    homeTeam: string;
    awayTeam: string;
    homeScore?: number | null;
    awayScore?: number | null;
    redHome?: number | null;
    redAway?: number | null;
  },
  nowMs: number,
  initialSnap?: LiveIncidentSnapshot
): { ok: true } | { ok: false; status: 400 | 409; error: string } {
  if (effectiveMatch.status === "finished") {
    return {
      ok: false,
      status: 409,
      error: `Le match ${effectiveMatch.homeTeam} – ${effectiveMatch.awayTeam} vient de se terminer — règlement imminent`,
    };
  }
  if (effectiveMatch.status !== "live") {
    return { ok: true };
  }

  const isManual = effectiveMatch.source === "manual";
  if (
    effectiveMatch.suspended ||
    (isManual &&
      isRealMatchPostIncidentSuspended(
        { status: "live", lastGoalAt: effectiveMatch.lastGoalAt ?? null },
        nowMs
      ))
  ) {
    return {
      ok: false,
      status: 409,
      error:
        "Cash Out momentanément suspendu suite à une action décisive (but ou carton rouge)",
    };
  }

  if (
    isManual &&
    effectiveMatch.externalId &&
    effectiveMatch.autoSync &&
    effectiveMatch.feedSyncedAt
  ) {
    const syncedMs =
      typeof effectiveMatch.feedSyncedAt === "string"
        ? new Date(effectiveMatch.feedSyncedAt).getTime()
        : effectiveMatch.feedSyncedAt.getTime();
    if (Number.isFinite(syncedMs) && nowMs - syncedMs > STALE_LIVE_FEED_MAX_MS) {
      return {
        ok: false,
        status: 409,
        error:
          "Flux direct en cours de resynchronisation — réessayez dans quelques secondes",
      };
    }
  }

  const min = minuteNumber(effectiveMatch.minute ?? null);
  if (min >= (isManual ? 88 : 85)) {
    return {
      ok: false,
      status: 400,
      error: `Fin de match imminente sur ${effectiveMatch.homeTeam} – ${effectiveMatch.awayTeam} — Cash Out verrouillé`,
    };
  }

  if (
    initialSnap &&
    ((effectiveMatch.homeScore ?? 0) !== initialSnap.homeScore ||
      (effectiveMatch.awayScore ?? 0) !== initialSnap.awayScore ||
      (effectiveMatch.redHome ?? 0) !== initialSnap.redHome ||
      (effectiveMatch.redAway ?? 0) !== initialSnap.redAway)
  ) {
    return {
      ok: false,
      status: 409,
      error:
        "Action décisive détectée pendant la validation (but ou carton rouge) — Cash Out suspendu",
    };
  }

  return { ok: true };
}

const CASHOUT_BASE_FACTOR = 0.9;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function impliedYes(oddsYes: number, oddsNo: number) {
  const pYes = 1 / oddsYes;
  const pNo = 1 / oddsNo;
  return pYes / (pYes + pNo);
}

export function matchProgress(
  sport: string,
  minute: string | null,
  isReal = false
): number {
  if (!minute) return 0;
  if (sport === "football") {
    const m = livePricingMinute(minuteNumber(minute), { isReal });
    return Math.min(m / 90, 0.97);
  }
  return 0;
}

/**
 * Cash-out bookmaker intelligent (« rusé ») :
 * - Calcule la probabilité exacte live de l'issue sur la grille bivariée
 * - Applique un spread asymétrique :
 *   • Pari en position favorable (pLive > pInitiale) : propose un gain garanti
 *     attractif pour inciter le joueur à sécuriser tôt (verrouillant la marge maison).
 *   • Pari en difficulté (pLive < pInitiale) : pénalité convexe de risque (pLive^1.14)
 *     et spread accru en fin de match ou en cas d'infériorité numérique.
 */
export function computeCashOut(params: {
  stake: number;
  odds: number;
  sport: string;
  minute: string | null;
  market?: string;
  selection: string;
  homeTeam?: string;
  awayTeam?: string;
  homeScore: number | null;
  awayScore: number | null;
  htHomeScore?: number | null;
  htAwayScore?: number | null;
  redHome?: number | null;
  redAway?: number | null;
  homeForm?: number | null;
  awayForm?: number | null;
  events?: Array<{ type: string; team: string; minute: number; player?: string }> | null;
  matchId?: number | null;
  source?: string | null;
  externalId?: string | null;
  autoSync?: boolean | null;
  oddsHome?: number | null;
  oddsDraw?: number | null;
  oddsAway?: number | null;
  realStats?: RealMatchLiveStatsInput | null;
  markets?: CustomMarketGroup[] | null;
}): number | null {
  const { stake, odds, selection } = params;
  const market = params.market ?? "result";
  const potential = stake * odds;
  const min = minuteNumber(params.minute);
  const isManual = params.source === "manual";
  if (min >= (isManual ? 88 : 85)) return null;
  if (
    (market === "ht_result" || market === "ht_total_ou") &&
    isFirstHalfCompleted(params.minute, "live")
  ) {
    return null;
  }

  const h = params.homeScore ?? 0;
  const a = params.awayScore ?? 0;
  const typedEvents =
    (params.events as Array<{
      type: "goal" | "red";
      team: "home" | "away";
      minute: number;
      player?: string;
    }> | null) ?? null;

  // Dès qu'une issue est déjà tranchée mathématiquement, le pari part au règlement (plus de cash-out)
  if (
    tryEarlyLiveSettle(market, selection, {
      source: isManual ? "manual" : "virtual",
      status: "live",
      minute: params.minute,
      homeScore: h,
      awayScore: a,
      htHomeScore: params.htHomeScore ?? null,
      htAwayScore: params.htAwayScore ?? null,
      events: typedEvents,
      matchId: params.matchId ?? 0,
    }) != null
  ) {
    return null;
  }

  const impliedEntry = clamp(0.95 / Math.max(1.02, odds), 0.02, 0.94);

  if (
    params.homeTeam &&
    params.awayTeam &&
    (isManual ? Boolean(params.oddsHome && params.oddsAway) : isKnownMarket(market))
  ) {
    const liveProb = isManual
      ? realMatchLiveProbability(
          {
            id: params.matchId ?? 0,
            sport: params.sport,
            homeTeam: params.homeTeam,
            awayTeam: params.awayTeam,
            status: "live",
            minute: params.minute,
            startsAt: new Date(0),
            homeScore: h,
            awayScore: a,
            htHomeScore: params.htHomeScore ?? null,
            htAwayScore: params.htAwayScore ?? null,
            oddsHome: params.oddsHome ?? 2.2,
            oddsDraw: params.oddsDraw ?? null,
            oddsAway: params.oddsAway ?? 3.0,
            redHome: params.redHome ?? 0,
            redAway: params.redAway ?? 0,
            externalId: params.externalId ?? null,
            autoSync: params.autoSync ?? true,
            events: typedEvents,
            realStats: params.realStats ?? null,
            markets: params.markets ?? null,
          },
          market,
          selection
        )
      : liveOutcomeProbability(
          market,
          selection,
          params.homeTeam,
          params.awayTeam,
          h,
          a,
          min,
          {
            homeForm: params.homeForm ?? 1,
            awayForm: params.awayForm ?? 1,
            redHome: params.redHome ?? 0,
            redAway: params.redAway ?? 0,
            events: params.events ?? null,
            matchId: params.matchId ?? 0,
          }
        );
    if (liveProb == null || liveProb < 0.02) return null;

    const lateVolatilityCut = min >= 75 ? 0.94 : min >= 60 ? 0.97 : 1.0;
    const redCardCut = (params.redHome ?? 0) + (params.redAway ?? 0) > 0 ? 0.96 : 1.0;

    let effectiveProb = liveProb;
    let spread = CASHOUT_BASE_FACTOR * lateVolatilityCut * redCardCut;

    if (liveProb < impliedEntry) {
      // Position perdante : décote convexe empêchant de sortir à bon compte après un but encaissé
      effectiveProb = Math.pow(liveProb, 1.14);
      spread *= 0.95;
    } else if (liveProb > impliedEntry * 1.25 && liveProb < 0.92) {
      // Position gagnante mais non acquise : offre psychologiquement tentante au-dessus de la mise
      spread = Math.min(0.91, spread * 1.01);
    }

    const rawOffer = potential * effectiveProb * spread;
    if (rawOffer < stake * 0.07) return null;
    return round2(clamp(rawOffer, 0.05, potential * 0.94));
  }

  // Repli si marché personnalisé admin
  if (market !== "result") return null;
  const progress = matchProgress(params.sport, params.minute, isManual);
  const leader = h > a ? "home" : a > h ? "away" : "draw";
  const aligned = selection === leader;
  const estProb = aligned
    ? impliedEntry + (0.9 - impliedEntry) * progress
    : Math.pow(impliedEntry * (1 - 0.85 * progress), 1.12);
  const offer = potential * estProb * CASHOUT_BASE_FACTOR;
  if (offer < stake * 0.07) return null;
  return round2(clamp(offer, 0.05, potential * 0.94));
}

export function predictionProgress(placedAt: Date, resolvesAt: Date, now = Date.now()): number {
  const total = resolvesAt.getTime() - placedAt.getTime();
  if (total <= 0) return 1;
  return Math.min(Math.max((now - placedAt.getTime()) / total, 0), 1);
}

export function computePredictionCashOut(params: {
  stake: number;
  odds: number;
  potentialWin: number;
  placedAt: Date;
  resolvesAt: Date;
  currentOddsYes: number;
  currentOddsNo: number;
  options?: Array<{ key: string; label: string; odds: number }> | null;
  selection: string;
}): number {
  const {
    stake,
    potentialWin,
    selection,
    currentOddsYes,
    currentOddsNo,
    options,
    placedAt,
    resolvesAt,
  } = params;
  const progress = predictionProgress(placedAt, resolvesAt);
  const entryImplied = clamp(0.94 / Math.max(1.03, params.odds), 0.02, 0.94);

  let pOwn: number;
  if (options && options.length >= 2) {
    const weights = options.map((o) => (o.odds > 0 ? 1 / o.odds : 0));
    const totalW = weights.reduce((a, b) => a + b, 0) || 1;
    const idx = options.findIndex((o) => o.key === selection);
    pOwn = idx >= 0 ? weights[idx] / totalW : entryImplied;
  } else {
    const pYes = impliedYes(currentOddsYes, currentOddsNo);
    pOwn = selection === "yes" ? pYes : 1 - pYes;
  }

  const effectiveP = pOwn < entryImplied ? Math.pow(pOwn, 1.12) : pOwn;
  const spread = 0.87 + 0.05 * progress;
  const value = potentialWin * effectiveP * spread;

  const min = Math.min(0.05, stake * 0.12);
  return round2(clamp(value, min, potentialWin * 0.94));
}
