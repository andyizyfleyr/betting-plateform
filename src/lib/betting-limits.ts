import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminSettings } from "@/db/schema";

/** Values are expressed in XOF; conversion uses the platform's EUR pivot. */
export interface BettingLimits {
  minStakeXof: number;
  maxStakeXof: number;
  maxPayoutXof: number;
  maxComboLegs: number;
}

export const DEFAULT_BETTING_LIMITS: BettingLimits = {
  minStakeXof: 100,
  maxStakeXof: 10_000_000,
  maxPayoutXof: 10_000_000,
  maxComboLegs: 30,
};
const KEY = "betting_limits_v1";

export function validateBettingLimits(value: unknown): BettingLimits | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const minStakeXof = Number(v.minStakeXof);
  const maxStakeXof = Number(v.maxStakeXof);
  const maxPayoutXof = Number(v.maxPayoutXof);
  const maxComboLegs = Number(v.maxComboLegs);
  if (![minStakeXof, maxStakeXof, maxPayoutXof, maxComboLegs].every(Number.isSafeInteger)) return null;
  if (minStakeXof < 1 || maxStakeXof < minStakeXof || maxPayoutXof < 1 ||
      maxStakeXof > 1_000_000_000 || maxPayoutXof > 1_000_000_000 ||
      maxComboLegs < 2 || maxComboLegs > 30) return null;
  return { minStakeXof, maxStakeXof, maxPayoutXof, maxComboLegs };
}

export async function getBettingLimits(): Promise<BettingLimits> {
  const [row] = await db.select({ value: adminSettings.value }).from(adminSettings)
    .where(eq(adminSettings.settingKey, KEY)).limit(1);
  return validateBettingLimits(row?.value) ?? DEFAULT_BETTING_LIMITS;
}

export async function saveBettingLimits(limits: BettingLimits): Promise<void> {
  await db.insert(adminSettings).values({ settingKey: KEY, value: { ...limits }, updatedAt: new Date() })
    .onConflictDoUpdate({ target: adminSettings.settingKey, set: { value: { ...limits }, updatedAt: new Date() } });
}
