import { livePricingMinute } from "@/db/fixtures";
import { isKnownMarket, liveOutcomeProbability, minuteNumber } from "@/lib/markets";

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

export function matchProgress(sport: string, minute: string | null): number {
  if (!minute) return 0;
  if (sport === "football") {
    const m = livePricingMinute(minuteNumber(minute));
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
  redHome?: number | null;
  redAway?: number | null;
  homeForm?: number | null;
  awayForm?: number | null;
  events?: Array<{ type: string; team: string; minute: number; player?: string }> | null;
  matchId?: number | null;
}): number | null {
  const { stake, odds, selection } = params;
  const market = params.market ?? "result";
  const potential = stake * odds;
  const min = minuteNumber(params.minute);
  if (min >= 88) return null;

  const h = params.homeScore ?? 0;
  const a = params.awayScore ?? 0;
  const impliedEntry = clamp(0.95 / Math.max(1.02, odds), 0.02, 0.94);

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
  const progress = matchProgress(params.sport, params.minute);
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
