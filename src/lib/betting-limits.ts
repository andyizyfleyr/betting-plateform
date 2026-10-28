import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminSettings } from "@/db/schema";

import { DEFAULT_BETTING_LIMITS, validateBettingLimits, type BettingLimits } from "./betting-limits-shared";
export { DEFAULT_BETTING_LIMITS, validateBettingLimits, type BettingLimits } from "./betting-limits-shared";
const KEY = "betting_limits_v1";

export async function getBettingLimits(): Promise<BettingLimits> {
  const [row] = await db.select({ value: adminSettings.value }).from(adminSettings)
    .where(eq(adminSettings.settingKey, KEY)).limit(1);
  return validateBettingLimits(row?.value) ?? DEFAULT_BETTING_LIMITS;
}

export async function saveBettingLimits(limits: BettingLimits): Promise<void> {
  await db.insert(adminSettings).values({ settingKey: KEY, value: { ...limits }, updatedAt: new Date() })
    .onConflictDoUpdate({ target: adminSettings.settingKey, set: { value: { ...limits }, updatedAt: new Date() } });
}
