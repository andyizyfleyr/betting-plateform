export const MIN_COMBO_LEGS = 2;
export const MAX_COMBO_LEGS = 8;
export const MIN_ELIGIBLE_BOOST_ODDS = 1.35;
export const MAX_COMBO_ODDS = 500;
export const MAX_COMBO_PAYOUT = 10_000;

export const COMBO_BOOST_TIERS: ReadonlyArray<{ legs: number; pct: number }> = [
  { legs: 3, pct: 3 },
  { legs: 4, pct: 5 },
  { legs: 5, pct: 8 },
  { legs: 6, pct: 12 },
  { legs: 7, pct: 16 },
  { legs: 8, pct: 20 },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Retourne le pourcentage de Bonus Combiné applicable au nombre de sélections éligibles (cote ≥ 1,35). */
export function comboBoostPct(eligibleLegsCount: number): number {
  if (eligibleLegsCount >= 8) return 20;
  if (eligibleLegsCount === 7) return 16;
  if (eligibleLegsCount === 6) return 12;
  if (eligibleLegsCount === 5) return 8;
  if (eligibleLegsCount === 4) return 5;
  if (eligibleLegsCount === 3) return 3;
  return 0;
}

export function nextComboBoostTier(eligibleLegsCount: number): { needed: number; pct: number } | null {
  for (const tier of COMBO_BOOST_TIERS) {
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
export function computeComboQuote(oddsList: number[], stake = 10): ComboQuote {
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
    if (clean >= MIN_ELIGIBLE_BOOST_ODDS) eligibleLegs += 1;
  }

  const baseOdds = round2(Math.min(MAX_COMBO_ODDS, rawProduct));
  const boostPct = comboBoostPct(eligibleLegs);
  const rawTotalOdds = baseOdds + Math.max(0, baseOdds - 1) * (boostPct / 100);
  const totalOdds = round2(Math.min(MAX_COMBO_ODDS, rawTotalOdds));

  const cleanStake = Math.max(0, stake);
  const basePayout = round2(cleanStake * baseOdds);
  const uncappedWin = round2(cleanStake * totalOdds);
  const potentialWin = round2(Math.min(MAX_COMBO_PAYOUT, uncappedWin));
  const boostAmount = round2(Math.max(0, potentialWin - basePayout));

  return {
    baseOdds,
    eligibleLegs,
    boostPct,
    totalOdds,
    basePayout,
    boostAmount,
    potentialWin,
    capped: uncappedWin > MAX_COMBO_PAYOUT || rawTotalOdds > MAX_COMBO_ODDS,
  };
}
