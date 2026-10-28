import { eurToLocal, getCurrencyConfig, localToEur, type CurrencyCode } from "./countries";

export interface BettingLimits {
  minStakeXof: number;
  maxStakeXof: number;
  maxPayoutXof: number;
  maxComboLegs: number;
}
export const DEFAULT_BETTING_LIMITS: BettingLimits = {
  minStakeXof: 100, maxStakeXof: 10_000_000, maxPayoutXof: 10_000_000, maxComboLegs: 30,
};
export function validateBettingLimits(value: unknown): BettingLimits | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const minStakeXof = Number(v.minStakeXof), maxStakeXof = Number(v.maxStakeXof);
  const maxPayoutXof = Number(v.maxPayoutXof), maxComboLegs = Number(v.maxComboLegs);
  if (![minStakeXof, maxStakeXof, maxPayoutXof, maxComboLegs].every(Number.isSafeInteger)) return null;
  if (minStakeXof < 1 || maxStakeXof < minStakeXof || maxPayoutXof < maxStakeXof ||
      maxStakeXof > 1_000_000_000 || maxPayoutXof > 1_000_000_000 || maxComboLegs < 2 || maxComboLegs > 30) return null;
  return { minStakeXof, maxStakeXof, maxPayoutXof, maxComboLegs };
}
/** Convertit les limites en unités locales représentables, puis en EUR pivot. */
export function limitsForCurrency(limits: BettingLimits, currency: CurrencyCode) {
  const minLocal = Math.max(getCurrencyConfig(currency).decimals === 0 ? 1 : 0.01, eurToLocal(localToEur(limits.minStakeXof, "XOF"), currency));
  const maxLocal = eurToLocal(localToEur(limits.maxStakeXof, "XOF"), currency);
  return { minLocal, maxLocal, minEur: localToEur(minLocal, currency), maxEur: localToEur(maxLocal, currency),
    maxPayoutEur: localToEur(limits.maxPayoutXof, "XOF") };
}
