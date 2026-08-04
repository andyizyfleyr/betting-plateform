import { and, desc, eq } from "drizzle-orm";
import { createHash, createHmac, randomBytes } from "crypto";
import { db } from "@/db";
import { acceleratorRounds, appUser, type AcceleratorRoundRow } from "@/db/schema";

/**
 * Moteur du jeu Accelerator Pro — port fidèle de accelerator.php.
 * Jauge ×1.01 → ×2.00, provably fair (HMAC-SHA256), état des manches en base.
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
} as const;

/** Arrondi homogène à 2 décimales (half-up) — r2() du PHP. */
export const r2 = (v: number) => Math.round(v * 100) / 100;

/** Vitesse de montée : (2.00 - 1.01) / 34 ≈ 0.0291176 par seconde. */
export function gBaseRate(): number {
  return (ACCEL_CONFIG.M_MAX - ACCEL_CONFIG.M_MIN) / ACCEL_CONFIG.ANIM_TO_TEN_SECONDS;
}

export function nowMs(): number {
  return Date.now();
}

/** Crash point provably fair — pf_crash_from_seed(). */
export function pfCrashFromSeed(seedHex: string, roundId: number): number {
  const seed = Buffer.from(seedHex, "hex");
  const hmac = createHmac("sha256", seed).update(String(roundId)).digest("hex");
  const slice = hmac.slice(0, 13);
  const int = parseInt(slice, 16);
  const ratio = int / Math.pow(16, 13);
  const val = 0.7 / (1.0 - ratio);
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

async function setRoundStatus(rid: number, status: string, extra?: Partial<AcceleratorRoundRow>) {
  await db
    .update(acceleratorRounds)
    .set({ status, endedAt: new Date(), ...extra })
    .where(and(eq(acceleratorRounds.id, rid), eq(acceleratorRounds.status, "active")));
}

export interface StartResult {
  status: "success";
  roundId: number;
  newBalance: number;
  multiplier: number;
  gBase: number;
  mMax: number;
  seedHash: string;
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

/** Démarre une manche : vérifie/abandonne l'ancienne, débite la mise, calcule le crash. */
export async function startRound(uid: number, betInput: number): Promise<StartResult | { status: "error"; message: string }> {
  const betUsd = Math.min(ACCEL_CONFIG.BET_MAX_USD, Math.max(ACCEL_CONFIG.BET_MIN_USD, betInput));

  const balance = await getUserBalance(uid);
  if (betUsd > balance) return { status: "error", message: "Solde insuffisant" };

  const latest = await getLatestRound(uid);
  if (latest && latest.status === "active") {
    const stale = nowMs() - Number(latest.lastMs) > ACCEL_CONFIG.TTL_MS;
    if (!stale) return { status: "error", message: "Une manche est déjà en cours" };
    await setRoundStatus(latest.id, "crashed");
  }

  await setUserBalance(uid, balance - betUsd);

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

  const crash = pfCrashFromSeed(seedHex, row.id);
  await db.update(acceleratorRounds).set({ crashPoint: crash }).where(eq(acceleratorRounds.id, row.id));

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

/** Avance le multiplicateur en fonction du temps réel écoulé. Retourne "crashed" si dépassé. */
export async function advanceRound(row: AcceleratorRoundRow, reason: "tap" | "tap_final"): Promise<AdvanceResult> {
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

/** Encaissement : avance l'état, vérifie le crash, puis paie (jackpot si ×2.00). */
export async function cashoutRound(row: AcceleratorRoundRow): Promise<CashoutResult> {
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

  if (cur >= crash) {
    await setRoundStatus(rid, "postcrashed", { currentMultiplier: r2(crash) });
    const bal = await getUserBalance(uid);
    return { status: "postcrashed", multiplier: r2(crash), newBalance: bal, winAmount: 0, roundId: rid, jackpot: false };
  }

  const mMax = Number(row.mMax);
  const jackpot = cur >= mMax - 1e-9;
  const mult = jackpot ? mMax : cur;
  const win = r2(Number(row.betAmount) * mult);

  const balance = await getUserBalance(uid);
  await setUserBalance(uid, balance + win);

  await db
    .update(acceleratorRounds)
    .set({ cashoutMultiplier: mult, status: "cashed", endedAt: new Date(), currentMultiplier: mult })
    .where(and(eq(acceleratorRounds.id, rid), eq(acceleratorRounds.status, "active")));

  return {
    status: "cashed",
    multiplier: mult,
    newBalance: r2(balance + win),
    winAmount: win,
    roundId: rid,
    jackpot,
  };
}

/** Manche active la plus récente (ou null). */
export async function getActiveRound(uid: number): Promise<AcceleratorRoundRow | null> {
  const latest = await getLatestRound(uid);
  if (latest && latest.status === "active") return latest;
  return null;
}
