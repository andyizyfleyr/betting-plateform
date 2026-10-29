import type { ClientSavedCouponLeg } from "./api";

/** Ne pas remplacer le coupon existant par une liste tronquée ou incompatible. */
export function validateLoadedCoupon(legs: ClientSavedCouponLeg[], maxLegs: number): string | null {
  if (!Array.isArray(legs) || !legs.length) return "Ce coupon ne contient aucune sélection disponible.";
  if (legs.length > maxLegs) return `Ce coupon dépasse la limite de ${maxLegs} sélections.`;
  const events = new Set<string>();
  const sources = new Set<string>();
  for (const leg of legs) {
    if (!leg || (leg.kind !== "sport" && leg.kind !== "prediction") || !leg.uid || !leg.market || !leg.selection || !Number.isFinite(leg.odds) || leg.odds < 1.01) return "Ce coupon contient une sélection invalide.";
    const key = leg.kind === "sport" ? `sport:${leg.matchId}` : `prediction:${leg.questionId}`;
    if ((leg.kind === "sport" && (!leg.matchId || !leg.matchSource)) || (leg.kind === "prediction" && !leg.questionId) || events.has(key)) return "Ce coupon contient une sélection invalide ou en double.";
    events.add(key);
    if (leg.kind === "sport") sources.add(leg.matchSource as string);
  }
  if (sources.size > 1) return "Ce coupon mélange matchs réels et virtuels, ce qui n’est pas autorisé.";
  return null;
}
