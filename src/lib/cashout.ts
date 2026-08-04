/** Calcul du montant de cash-out proposé sur un pari en cours (match live). */

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
