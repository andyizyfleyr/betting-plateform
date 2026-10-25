import { isKnownMarket, liveOutcomeProbability, minuteNumber } from "@/lib/markets";

const CASHOUT_HOUSE_FACTOR = 0.92;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function impliedYes(oddsYes: number, oddsNo: number) {
  const pYes = 1 / oddsYes;
  const pNo = 1 / oddsNo;
  return pYes / (pYes + pNo);
}

export function matchProgress(sport: string, minute: string | null): number {
  if (!minute) return 0;
  if (sport === "football") {
    const m = minuteNumber(minute);
    return Math.min(m / 90, 0.97);
  }
  return 0;
}

/**
 * Valeur de cash-out réaliste fondée sur la probabilité live réelle de l'issue
 * (compatible avec l'ensemble des 14 marchés sportifs).
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
  redHome?: number | null;
  redAway?: number | null;
  homeForm?: number | null;
  awayForm?: number | null;
}): number | null {
  const { stake, odds, selection } = params;
  const market = params.market ?? "result";
  const potential = stake * odds;
  const min = minuteNumber(params.minute);
  if (min >= 89) return null;

  const h = params.homeScore ?? 0;
  const a = params.awayScore ?? 0;

  if (params.homeTeam && params.awayTeam && isKnownMarket(market)) {
    const liveProb = liveOutcomeProbability(
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
      }
    );
    if (liveProb == null || liveProb < 0.015) return null;

    const rawOffer = potential * liveProb * CASHOUT_HOUSE_FACTOR;
    if (rawOffer < stake * 0.06) return null;
    return round2(Math.min(potential * 0.96, Math.max(0.05, rawOffer)));
  }

  // Repli si marché personnalisé admin
  if (market !== "result") return null;
  const progress = matchProgress(params.sport, params.minute);
  const impliedP0 = odds > 1 ? Math.min(0.9, 0.95 / odds) : 0.33;
  const leader = h > a ? "home" : a > h ? "away" : "draw";
  const aligned = selection === leader;
  const estProb = aligned
    ? impliedP0 + (0.92 - impliedP0) * progress
    : impliedP0 * (1 - 0.85 * progress);
  const offer = potential * estProb * CASHOUT_HOUSE_FACTOR;
  if (offer < stake * 0.06) return null;
  return round2(Math.min(potential * 0.96, Math.max(0.05, offer)));
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

  let pOwn: number;
  if (options && options.length >= 2) {
    const weights = options.map((o) => (o.odds > 0 ? 1 / o.odds : 0));
    const totalW = weights.reduce((a, b) => a + b, 0) || 1;
    const idx = options.findIndex((o) => o.key === selection);
    pOwn = idx >= 0 ? weights[idx] / totalW : Math.min(0.9, 0.94 / Math.max(1.05, params.odds));
  } else {
    const pYes = impliedYes(currentOddsYes, currentOddsNo);
    pOwn = selection === "yes" ? pYes : 1 - pYes;
  }

  // Valeur juste pondérée par la probabilité actuelle et une légère décote de rachat
  const fairNow = potentialWin * pOwn * CASHOUT_HOUSE_FACTOR;
  const timeBoost = 0.92 + 0.08 * progress;
  const value = fairNow * timeBoost;

  const min = Math.min(0.05, stake * 0.15);
  return round2(Math.min(Math.max(value, min), potentialWin * 0.96));
}
