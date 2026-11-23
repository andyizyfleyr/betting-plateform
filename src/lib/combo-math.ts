export const MIN_COMBO_LEGS = 2;
export const MAX_COMBO_LEGS = 30;
export const MIN_ELIGIBLE_BOOST_ODDS = 1.35;
// Default gain cap in EUR pivot, corresponding to 10,000,000 XOF.
export const MAX_COMBO_PAYOUT = Math.round((10_000_000 / 655.957) * 1_000_000) / 1_000_000;

/**
 * Paramètres du Bonus Combiné (configurables par l'admin, sans redéploiement).
 * Définis ici pour garder combo-math pur (sans dépendance DB) et partagé client/serveur.
 * Le serveur charge la valeur admin via `getComboBoostSettings()` et la passe à
 * `computeComboQuote` ; le client utilise les defaults (quote serveur toujours autoritaire).
 */
export interface ComboBoostConfig {
  enabled: boolean;
  minEligibleOdds: number;
  tiers: Array<{ legs: number; pct: number }>;
}

const DEFAULT_COMBO_BOOST_CONFIG: ComboBoostConfig = {
  enabled: true,
  minEligibleOdds: MIN_ELIGIBLE_BOOST_ODDS,
  tiers: [
    { legs: 3, pct: 3 },
    { legs: 4, pct: 5 },
    { legs: 5, pct: 8 },
    { legs: 6, pct: 12 },
    { legs: 7, pct: 16 },
    { legs: 8, pct: 20 },
  ],
};

export const COMBO_BOOST_TIERS: ReadonlyArray<{ legs: number; pct: number }> =
  DEFAULT_COMBO_BOOST_CONFIG.tiers;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundPivot(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/** Retourne le pourcentage de Bonus Combiné applicable selon les paliers admin (désactivé → 0). */
export function comboBoostPct(
  eligibleLegsCount: number,
  cfg: ComboBoostConfig = DEFAULT_COMBO_BOOST_CONFIG
): number {
  if (!cfg.enabled) return 0;
  let pct = 0;
  for (const tier of cfg.tiers) {
    if (eligibleLegsCount >= tier.legs) pct = Math.max(pct, tier.pct);
  }
  return pct;
}

export function nextComboBoostTier(
  eligibleLegsCount: number,
  cfg: ComboBoostConfig = DEFAULT_COMBO_BOOST_CONFIG
): { needed: number; pct: number } | null {
  if (!cfg.enabled) return null;
  for (const tier of cfg.tiers) {
    if (eligibleLegsCount < tier.legs) {
      return { needed: tier.legs - eligibleLegsCount, pct: tier.pct };
    }
  }
  return null;
}

export interface ComboQuote {
  baseOdds: number;
  eligibleLegs: number;
  boostPct: number;
  totalOdds: number;
  basePayout: number;
  boostAmount: number;
  potentialWin: number;
  capped: boolean;
}

/** Calcule la cote combinée fixe, le Bonus Combiné sur le bénéfice net et le plafond bookmaker. */
export function computeComboQuote(
  oddsList: number[],
  stake = 10,
  payoutLimit = MAX_COMBO_PAYOUT,
  boost?: ComboBoostConfig
): ComboQuote {
  const cfg = boost ?? DEFAULT_COMBO_BOOST_CONFIG;
  if (oddsList.length === 0) {
    return {
      baseOdds: 1,
      eligibleLegs: 0,
      boostPct: 0,
      totalOdds: 1,
      basePayout: 0,
      boostAmount: 0,
      potentialWin: 0,
      capped: false,
    };
  }

  let rawProduct = 1;
  let eligibleLegs = 0;
  for (const o of oddsList) {
    const clean = Math.max(1.01, o);
    rawProduct *= clean;
    if (clean >= cfg.minEligibleOdds) eligibleLegs += 1;
  }

  const baseOdds = round2(rawProduct);
  const boostPct = comboBoostPct(eligibleLegs, cfg);
  const rawTotalOdds = baseOdds + Math.max(0, baseOdds - 1) * (boostPct / 100);
  const totalOdds = round2(rawTotalOdds);

  const cleanStake = Math.max(0, stake);
  const basePayout = roundPivot(cleanStake * baseOdds);
  const uncappedWin = roundPivot(cleanStake * totalOdds);
  const potentialWin = roundPivot(Math.min(payoutLimit, uncappedWin));
  const boostAmount = roundPivot(Math.max(0, potentialWin - basePayout));

  return {
    baseOdds,
    eligibleLegs,
    boostPct,
    totalOdds,
    basePayout,
    boostAmount,
    potentialWin,
    capped: uncappedWin > payoutLimit,
  };
}

function parseStartsAtMs(iso?: string | null): number {
  if (!iso) return Number.MAX_SAFE_INTEGER;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

/**
 * Classe les sélections d'un pari combiné dans l'ordre chronologique complet :
 *  0) Matchs / sélections TERMINÉS en premier, selon la date et l'heure croissantes
 *  1) Matchs actuellement EN DIRECT, selon la date et l'heure croissantes
 *  2) Matchs / événements À JOUER, selon la date et l'heure croissantes (du plus proche au plus futur)
 */
export function sortComboBetLegsChronologically<
  T extends {
    status: string;
    matchStatus?: string | null;
    matchStartsAt?: string | null;
  },
>(legs: readonly T[]): T[] {
  if (legs.length <= 1) return [...legs];
  return legs
    .map((leg, idx) => {
      const isFinishedLeg =
        leg.status !== "pending" || leg.matchStatus === "finished";
      const phaseRank = isFinishedLeg
        ? 0
        : leg.matchStatus === "live"
          ? 1
          : 2;
      return {
        leg,
        idx,
        phaseRank,
        startsAtMs: parseStartsAtMs(leg.matchStartsAt),
      };
    })
    .sort(
      (a, b) =>
        a.phaseRank - b.phaseRank ||
        a.startsAtMs - b.startsAtMs ||
        a.idx - b.idx
    )
    .map((x) => x.leg);
}

/**
 * Classe les sélections d'un coupon combiné en cours de préparation :
 *  0) Sélections terminées / clôturées selon la date et l'heure croissantes
 *  1) Matchs en direct selon la date et l'heure croissantes
 *  2) Matchs / événements à jouer du plus proche au plus futur
 */
export function sortSlipSelectionsChronologically<
  T extends {
    isLive?: boolean;
    closed?: boolean;
    startsAt?: string | null;
  },
>(legs: readonly T[]): T[] {
  if (legs.length <= 1) return [...legs];
  return legs
    .map((leg, idx) => {
      const phaseRank = leg.closed ? 0 : leg.isLive ? 1 : 2;
      return {
        leg,
        idx,
        phaseRank,
        startsAtMs: parseStartsAtMs(leg.startsAt),
      };
    })
    .sort(
      (a, b) =>
        a.phaseRank - b.phaseRank ||
        a.startsAtMs - b.startsAtMs ||
        a.idx - b.idx
    )
    .map((x) => x.leg);
}

/**
 * Classe les paris en cours dans « Mes paris » exactement selon la même logique chronologique :
 *  0) Tickets dont tous les événements sont déjà terminés (en attente de règlement), par date/heure croissante
 *  1) Combinés déjà entamés comptant au moins un match terminé, par date/heure croissante du match terminé
 *  2) Tickets actuellement EN DIRECT, par date/heure de coup d'envoi croissante
 *  3) Tickets À JOUER, de la date et l'heure la plus proche à la plus éloignée dans le futur
 */
export function sortOngoingBetsChronologically<
  T extends {
    id: number;
    kind: string;
    placedAt: string | Date;
    matchStatus?: string | null;
    matchStartsAt?: string | null;
    legs?: ReadonlyArray<{
      status: string;
      matchStatus?: string | null;
      matchStartsAt?: string | null;
    }>;
  },
>(betsList: readonly T[]): T[] {
  if (betsList.length <= 1) return [...betsList];
  return betsList
    .map((bet, idx) => {
      let phaseRank = 3;
      let primaryMs = parseStartsAtMs(bet.matchStartsAt);
      let secondaryMs = Number.MAX_SAFE_INTEGER;

      if (bet.kind === "combo" && Array.isArray(bet.legs) && bet.legs.length > 0) {
        const finishedTimes: number[] = [];
        const liveTimes: number[] = [];
        const upcomingTimes: number[] = [];

        for (const l of bet.legs) {
          const t = parseStartsAtMs(l.matchStartsAt);
          if (l.status !== "pending" || l.matchStatus === "finished") {
            finishedTimes.push(t);
          } else if (l.matchStatus === "live") {
            liveTimes.push(t);
          } else {
            upcomingTimes.push(t);
          }
        }

        const minOf = (arr: number[]) =>
          arr.length > 0 ? Math.min(...arr) : Number.MAX_SAFE_INTEGER;

        if (finishedTimes.length === bet.legs.length) {
          phaseRank = 0;
          primaryMs = minOf(finishedTimes);
        } else if (finishedTimes.length > 0) {
          phaseRank = 1;
          primaryMs = minOf(finishedTimes);
          secondaryMs =
            liveTimes.length > 0 ? minOf(liveTimes) : minOf(upcomingTimes);
        } else if (liveTimes.length > 0 || bet.matchStatus === "live") {
          phaseRank = 2;
          primaryMs = minOf(liveTimes);
          secondaryMs = minOf(upcomingTimes);
        } else {
          phaseRank = 3;
          primaryMs = minOf(upcomingTimes);
        }
      } else if (bet.matchStatus === "finished") {
        phaseRank = 0;
      } else if (bet.matchStatus === "live") {
        phaseRank = 2;
      } else {
        phaseRank = 3;
      }

      const placedMs =
        bet.placedAt instanceof Date
          ? bet.placedAt.getTime()
          : Date.parse(bet.placedAt) || 0;

      return {
        bet,
        idx,
        phaseRank,
        primaryMs,
        secondaryMs,
        placedMs,
      };
    })
    .sort(
      (a, b) =>
        a.phaseRank - b.phaseRank ||
        a.primaryMs - b.primaryMs ||
        a.secondaryMs - b.secondaryMs ||
        b.placedMs - a.placedMs ||
        b.bet.id - a.bet.id ||
        a.idx - b.idx
    )
    .map((x) => x.bet);
}

