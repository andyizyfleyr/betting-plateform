/** Calcul du montant de cash-out proposé sur un pari en cours (match live ou prédiction). */

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Probabilité implicite de « Oui » (normalisée, hors marge) — même source que lib/predictions. */
function impliedYes(oddsYes: number, oddsNo: number) {
  const pYes = 1 / oddsYes;
  const pNo = 1 / oddsNo;
  return pYes / (pYes + pNo);
}

export function matchProgress(sport: string, minute: string | null): number {
  if (!minute) return 0;
  if (sport === "football") {
    const m = parseInt(minute, 10);
    if (Number.isNaN(m)) return 0;
    return Math.min(m / 90, 0.97);
  }
  return 0;
}

/**
 * Valeur de cash-out réaliste :
 * - si la sélection est en train de gagner → proche du gain potentiel en fin de match
 * - si elle perd → décote forte qui s'aggrave avec le temps
 */
export function computeCashOut(params: {
  stake: number;
  odds: number;
  sport: string;
  minute: string | null;
  selection: string;
  homeScore: number | null;
  awayScore: number | null;
}): number {
  const { stake, odds, selection } = params;
  const progress = matchProgress(params.sport, params.minute);
  const potential = stake * odds;

  const leader =
    (params.homeScore ?? 0) > (params.awayScore ?? 0)
      ? "home"
      : (params.awayScore ?? 0) > (params.homeScore ?? 0)
        ? "away"
        : "draw";
  const aligned = selection === leader;

  const base = potential * (0.35 + 0.6 * progress) * 0.92;

  let value: number;
  if (aligned) {
    // La sélection mène : la valeur grimpe vers le gain potentiel
    value = Math.min(base, potential * 0.97);
  } else {
    // La sélection perd : forte décote, de pire en pire avec la progression
    const decay = Math.max(0.06, 0.4 - 0.34 * progress);
    value = Math.min(base, potential * 0.55) * decay;
  }

  const clamped = Math.min(Math.max(value, 0.05), potential * 0.97);
  return Math.round(clamped * 100) / 100;
}

/** Progression d'une prédiction : 0 = vient d'être placée, 1 = résolution atteinte. */
export function predictionProgress(placedAt: Date, resolvesAt: Date, now = Date.now()): number {
  const total = resolvesAt.getTime() - placedAt.getTime();
  if (total <= 0) return 1;
  return Math.min(Math.max((now - placedAt.getTime()) / total, 0), 1);
}

/**
 * Valeur de cash-out d'une prédiction Oui/Non :
 * - monte avec la progression du temps (plus on approche de la résolution, plus elle vaut) ;
 * - monte si votre côté est favori au marché courant (implied probability) ;
 * - décote si votre côté est outsider.
 */
export function computePredictionCashOut(params: {
  stake: number;
  odds: number;
  potentialWin: number;
  placedAt: Date;
  resolvesAt: Date;
  currentOddsYes: number;
  currentOddsNo: number;
  selection: "yes" | "no";
}): number {
  const { stake, potentialWin, selection, currentOddsYes, currentOddsNo, placedAt, resolvesAt } = params;
  const progress = predictionProgress(placedAt, resolvesAt);

  const pYes = impliedYes(currentOddsYes, currentOddsNo);
  const pOwn = selection === "yes" ? pYes : 1 - pYes;

  // Base : gain potentiel × progression temporelle.
  const base = potentialWin * (0.12 + 0.62 * progress);

  // Modulateur selon la position du marché : favori → proche du gain potentiel.
  const favFactor = pOwn >= 0.5 ? 0.82 + (pOwn - 0.5) * 0.9 : 0.38 + pOwn * 0.5;
  const dogFactor = pOwn >= 0.5 ? 0.4 : 0.16 + pOwn * 0.32;

  const value = pOwn >= 0.5
    ? Math.min(base * favFactor, potentialWin * 0.96)
    : base * dogFactor;

  // On ne cashe jamais plus que le gain potentiel, ni moins que le solde virtuel plancher.
  const min = Math.min(0.05, stake * 0.25);
  return round2(Math.min(Math.max(value, min), potentialWin * 0.96));
}
