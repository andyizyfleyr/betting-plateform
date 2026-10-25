import { and, desc, eq, sql } from "drizzle-orm";
import { createHash, createHmac, randomBytes } from "crypto";
import { db } from "@/db";
import { acceleratorRounds, appUser, type AcceleratorRoundRow } from "@/db/schema";
import {
  analyzeAcceleratorProfile,
  getGlobalHouseHealth,
  invalidateHouseHealthCache,
} from "./house-brain";

/**
 * Moteur intelligent (« rusé ») du jeu Accelerator Pro :
 * - Jauge ×1.01 → ×2.00 avec engagement SHA-256 par manche (`seedHash`)
 * - Calibration adaptative de la tension selon la santé globale de la banque,
 *   l'anti-martingale, l'anti-micro-scalping (sorties systématiques à ×1.02–×1.08)
 *   et des fins de course haletantes entre ×1.72 et ×1.97 juste avant le jackpot ×2.00.
 */

export const ACCEL_CONFIG = {
  M_MIN: 1.01,
  M_MAX: 2.0,
  ANIM_TO_TEN_SECONDS: 34.0,
  BET_MIN_USD: 1.0,
  BET_MAX_USD: 50.0,
  TTL_MS: 60000,
  COOLDOWN_MS: 0,
  CURRENCY_SYMBOL: "$",
  DECIMALS: 2,
  /** Fenêtre anti-triche resserrée pour honorer la latence réseau sans offrir d'arbitrage gratuit. */
  CASHOUT_LATENCY_WINDOW: 0.18,
  /** Facteur maison de base (~8 % d'avantage maison équilibré). */
  CRASH_HOUSE: 0.92,
} as const;

export const r2 = (v: number) => Math.round(v * 100) / 100;

export function gBaseRate(): number {
  return (ACCEL_CONFIG.M_MAX - ACCEL_CONFIG.M_MIN) / ACCEL_CONFIG.ANIM_TO_TEN_SECONDS;
}

export function nowMs(): number {
  return Date.now();
}

/**
 * Crash point déterministe depuis la graine serveur + calibration dynamique :
 * - Protège contre le micro-scalping à ×1.02–×1.08
 * - Réduit la probabilité brute d'atteindre ×2.00 (~18–26 % au lieu de 49 %)
 *   en créant une zone de suspense réaliste entre ×1.68 et ×1.97.
 */
export function pfCrashFromSeed(
  seedHex: string,
  roundId: number,
  effectiveHouse: number = ACCEL_CONFIG.CRASH_HOUSE,
  microScalpGuard = false
): number {
  const seed = Buffer.from(seedHex, "hex");
  const hmac = createHmac("sha256", seed).update(String(roundId)).digest("hex");
  const u1 = parseInt(hmac.slice(0, 13), 16) / Math.pow(16, 13);
  const u2 = parseInt(hmac.slice(13, 21), 16) / Math.pow(16, 8);

  // Garde anti-micro-scalp : empêche l'exploitation par relâchement instantané à ×1.02
  if (microScalpGuard && u2 < 0.28) {
    return ACCEL_CONFIG.M_MIN;
  }

  let val = effectiveHouse / Math.max(0.0001, 1.0 - u1);

  // Compression haletante de la queue haute : une partie des tirages > 2.00 s'arrête
  // dans la zone rouge de tension [1.72 .. 1.98] juste sous le jackpot ×2.00 !
  if (val >= ACCEL_CONFIG.M_MAX && u2 < 0.52) {
    val = 1.72 + (u2 / 0.52) * 0.26;
  }

  return r2(Math.max(ACCEL_CONFIG.M_MIN, Math.min(ACCEL_CONFIG.M_MAX, val)));
}

async function getUserBalance(uid: number): Promise<number> {
  const [u] = await db.select({ balance: appUser.balance }).from(appUser).where(eq(appUser.id, uid));
  return u?.balance ?? 0;
}

export { getUserBalance };

async function setUserBalance(uid: number, balance: number) {
  await db.update(appUser).set({ balance: r2(balance) }).where(eq(appUser.id, uid));
}

async function getLatestRound(uid: number) {
  const rows = await db
    .select()
    .from(acceleratorRounds)
    .where(eq(acceleratorRounds.userId, uid))
    .orderBy(desc(acceleratorRounds.id))
    .limit(1);
  return rows[0] ?? null;
}

export { getLatestRound };

async function setRoundStatus(rid: number, status: string, extra?: Partial<AcceleratorRoundRow>) {
  await db
    .update(acceleratorRounds)
    .set({ status, endedAt: new Date(), ...extra })
    .where(and(eq(acceleratorRounds.id, rid), eq(acceleratorRounds.status, "active")));
  invalidateHouseHealthCache();
}

export interface StartResult {
  status: "success";
  roundId: number;
  newBalance: number;
  multiplier: number;
  gBase: number;
  mMax: number;
  seedHash: string;
  resumed?: boolean;
}

export interface AdvanceResult {
  status: "ok" | "synced" | "crashed";
  multiplier: number;
  newBalance?: number;
  roundId?: number;
}

export interface CashoutResult {
  status: "cashed" | "crashed" | "postcrashed";
  multiplier: number;
  newBalance: number;
  winAmount: number;
  roundId: number;
  jackpot: boolean;
}

export async function startRound(
  uid: number,
  betInput: number
): Promise<StartResult | { status: "error"; message: string }> {
  const betUsd = Math.min(ACCEL_CONFIG.BET_MAX_USD, Math.max(ACCEL_CONFIG.BET_MIN_USD, betInput));

  const balance = await getUserBalance(uid);
  if (betUsd > balance) return { status: "error", message: "Solde insuffisant" };

  const latest = await getLatestRound(uid);
  if (latest && latest.status === "active") {
    const stale = nowMs() - Number(latest.lastMs) > ACCEL_CONFIG.TTL_MS;
    if (!stale) {
      return {
        status: "success",
        roundId: latest.id,
        newBalance: await getUserBalance(uid),
        multiplier: Number(latest.currentMultiplier),
        gBase: Number(latest.gBase),
        mMax: Number(latest.mMax),
        seedHash: latest.seedHash ?? "",
        resumed: true,
      };
    }
    await setRoundStatus(latest.id, "crashed");
  }

  await setUserBalance(uid, balance - betUsd);

  const [health, signal] = await Promise.all([
    getGlobalHouseHealth(),
    analyzeAcceleratorProfile(uid, betUsd),
  ]);

  // Calibration dynamique du facteur maison dans [0.78 .. 0.95]
  const rawHouse = ACCEL_CONFIG.CRASH_HOUSE * Math.min(1.03, signal.cautionFactor * health.tightness);
  const effectiveHouse = Math.min(0.95, Math.max(0.78, rawHouse));
  const microScalpGuard = signal.archetype === "MICRO_SCALPER" || signal.lowExitRate >= 0.6;

  const gBase = gBaseRate();
  const seedHex = randomBytes(32).toString("hex");
  const seedHash = createHash("sha256").update(seedHex).digest("hex");

  const [row] = await db
    .insert(acceleratorRounds)
    .values({
      userId: uid,
      betAmount: r2(betUsd),
      gBase,
      mMax: ACCEL_CONFIG.M_MAX,
      startedAt: new Date(),
      lastMs: nowMs(),
      currentMultiplier: ACCEL_CONFIG.M_MIN,
      crashPoint: ACCEL_CONFIG.M_MIN,
      status: "active",
      serverSeed: seedHex,
      seedHash,
    })
    .returning();

  const crash = pfCrashFromSeed(seedHex, row.id, effectiveHouse, microScalpGuard);
  await db
    .update(acceleratorRounds)
    .set({ crashPoint: crash })
    .where(eq(acceleratorRounds.id, row.id));

  return {
    status: "success",
    roundId: row.id,
    newBalance: r2(balance - betUsd),
    multiplier: ACCEL_CONFIG.M_MIN,
    gBase,
    mMax: ACCEL_CONFIG.M_MAX,
    seedHash,
  };
}

export interface HoldStartResult {
  status: "ok" | "crashed" | "error";
  multiplier?: number;
  roundId?: number;
  message?: string;
}

export async function holdStartRound(uid: number): Promise<HoldStartResult> {
  const row = await getActiveRound(uid);
  if (!row) return { status: "error", message: "Aucune partie en cours" };

  const now = nowMs();
  const crash = Number(row.crashPoint);
  if (ACCEL_CONFIG.M_MIN >= crash - 1e-9) {
    await setRoundStatus(row.id, "crashed", { currentMultiplier: r2(crash) });
    return { status: "crashed", multiplier: r2(crash), roundId: row.id };
  }

  await db
    .update(acceleratorRounds)
    .set({ lastMs: now, currentMultiplier: ACCEL_CONFIG.M_MIN })
    .where(and(eq(acceleratorRounds.id, row.id), eq(acceleratorRounds.status, "active")));

  return { status: "ok", multiplier: ACCEL_CONFIG.M_MIN, roundId: row.id };
}

export async function advanceRound(
  row: AcceleratorRoundRow,
  reason: "tap" | "tap_final"
): Promise<AdvanceResult> {
  const rid = row.id;
  const now = nowMs();
  const last = Number(row.lastMs);
  const dtMs = now - last;

  let cur = Number(row.currentMultiplier);
  const rate = Number(row.gBase);

  if (dtMs > ACCEL_CONFIG.TTL_MS) {
    await setRoundStatus(rid, "crashed");
    return { status: "crashed", multiplier: r2(cur), roundId: rid };
  }

  cur = Math.min(Number(row.mMax), cur + rate * (Math.max(0, dtMs) / 1000));
  cur = r2(cur);

  await db
    .update(acceleratorRounds)
    .set({ currentMultiplier: cur, lastMs: now })
    .where(and(eq(acceleratorRounds.id, rid), eq(acceleratorRounds.status, "active")));

  const crash = Number(row.crashPoint);
  if (cur >= crash) {
    await setRoundStatus(rid, "crashed", { currentMultiplier: crash });
    return { status: "crashed", multiplier: r2(crash), roundId: rid };
  }

  return { status: reason === "tap" ? "ok" : "synced", multiplier: cur, roundId: rid };
}

export async function cashoutRound(
  row: AcceleratorRoundRow,
  clientMult?: number | null
): Promise<CashoutResult> {
  const uid = row.userId;
  const rid = row.id;
  const now = nowMs();
  const last = Number(row.lastMs);
  const dtMs = now - last;

  let cur = Number(row.currentMultiplier);
  const rate = Number(row.gBase);
  if (dtMs > ACCEL_CONFIG.TTL_MS) {
    await setRoundStatus(rid, "crashed");
    const bal = await getUserBalance(uid);
    return { status: "crashed", multiplier: r2(cur), newBalance: bal, winAmount: 0, roundId: rid, jackpot: false };
  }

  cur = Math.min(Number(row.mMax), cur + rate * (Math.max(0, dtMs) / 1000));
  cur = r2(cur);
  await db
    .update(acceleratorRounds)
    .set({ currentMultiplier: cur, lastMs: now })
    .where(and(eq(acceleratorRounds.id, rid), eq(acceleratorRounds.status, "active")));

  const crash = Number(row.crashPoint);

  let eff = cur;
  const cm = clientMult ?? null;
  if (
    cm != null &&
    cm >= ACCEL_CONFIG.M_MIN - 1e-9 &&
    cm <= ACCEL_CONFIG.M_MAX + 1e-9 &&
    cm >= cur - ACCEL_CONFIG.CASHOUT_LATENCY_WINDOW
  ) {
    eff = Math.min(cm, cur);
  }
  eff = r2(eff);

  if (eff >= crash) {
    await setRoundStatus(rid, "postcrashed", { currentMultiplier: r2(crash) });
    const bal = await getUserBalance(uid);
    return { status: "postcrashed", multiplier: r2(crash), newBalance: bal, winAmount: 0, roundId: rid, jackpot: false };
  }

  const mMax = Number(row.mMax);
  const jackpot = eff >= mMax - 1e-9;
  const mult = jackpot ? mMax : eff;
  const win = r2(Number(row.betAmount) * mult);

  const flipped = await db
    .update(acceleratorRounds)
    .set({ cashoutMultiplier: mult, status: "cashed", endedAt: new Date(), currentMultiplier: mult })
    .where(and(eq(acceleratorRounds.id, rid), eq(acceleratorRounds.status, "active")));

  if ((flipped.rowCount ?? 0) === 0) {
    const state = await db
      .select({ status: acceleratorRounds.status })
      .from(acceleratorRounds)
      .where(eq(acceleratorRounds.id, rid))
      .limit(1);
    const bal = await getUserBalance(uid);
    if (state[0]?.status === "cashed") {
      return { status: "cashed", multiplier: mult, newBalance: bal, winAmount: win, roundId: rid, jackpot };
    }
    return { status: "postcrashed", multiplier: r2(crash), newBalance: bal, winAmount: 0, roundId: rid, jackpot: false };
  }

  const balance = await getUserBalance(uid);
  await setUserBalance(uid, balance + win);
  invalidateHouseHealthCache();

  return {
    status: "cashed",
    multiplier: mult,
    newBalance: r2(balance + win),
    winAmount: win,
    roundId: rid,
    jackpot,
  };
}

export async function getActiveRound(uid: number): Promise<AcceleratorRoundRow | null> {
  const latest = await getLatestRound(uid);
  if (latest && latest.status === "active") return latest;
  return null;
}

/**
 * Clôture automatiquement toute manche Accelerator abandonnée (onglet fermé ou
 * perte réseau au-delà de TTL_MS) afin que l'historique du portefeuille reste
 * exact même si le joueur ne rouvre jamais la page /accelerator.
 */
export async function expireStaleAcceleratorRounds(now = nowMs()): Promise<void> {
  const cutoff = now - ACCEL_CONFIG.TTL_MS;
  const res = await db
    .update(acceleratorRounds)
    .set({
      status: "crashed",
      endedAt: sql`to_timestamp((${acceleratorRounds.lastMs} + ${ACCEL_CONFIG.TTL_MS}) / 1000.0)`,
    })
    .where(
      and(
        eq(acceleratorRounds.status, "active"),
        sql`${acceleratorRounds.lastMs} < ${cutoff}`
      )
    );
  if ((res.rowCount ?? 0) > 0) {
    invalidateHouseHealthCache();
  }
}
