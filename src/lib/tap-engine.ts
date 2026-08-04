import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { tapHistory } from "@/db/schema";

/**
 * Moteur du jeu Tap Win — port fidèle de tap.php.
 * Constantes, calcul du multiplicateur, crash point, profil joueur et santé système.
 */

export const TAP_CONFIG = {
  BET_MAX_USD: 100,
  INITIAL_MULTIPLIER: 1.0,
  GROWTH_FACTOR: 1.05,
  MAX_MULTIPLIER: 100.0,
  HIGH_BET_THRESHOLD: 1.5,
  MIN_BET: 1,
  CURRENCY_SYMBOL: "$",
  DECIMALS: 2,
} as const;

export interface TapSession {
  active: boolean;
  bet: number;
  multiplier: number;
  clicks: number;
  mMax: number;
  crashPoint: number;
  initialMult: number;
  mFactor: number;
  riskType: string;
}

export interface PlayerProfile {
  type: string;
  correction: number;
  forceCrash: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------- Session en mémoire (un seul utilisateur, id = 1) ----------------

type SessionMap = Record<number, TapSession>;

const g = globalThis as typeof globalThis & { __tapSessions?: SessionMap };

function store(): SessionMap {
  return (g.__tapSessions ??= {});
}

export function getSession(uid: number): TapSession | null {
  return store()[uid] ?? null;
}

export function setSession(uid: number, s: TapSession) {
  store()[uid] = s;
}

export function clearSession(uid: number) {
  delete store()[uid];
}

// ---------------- Calculs ----------------

/** floor(initial * factor^clicks * 100) / 100 — identique à calc_mult_safe(). */
export function calcMultSafe(initial: number, factor: number, clicks: number): number {
  return Math.floor(initial * Math.pow(factor, clicks) * 100) / 100;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Santé du système sur les dernières 24h (ratio gains / mises), cache 5 min. */
const HEALTH_CACHE_MS = 5 * 60 * 1000;
let healthCache: { at: number; value: number } | null = null;

export async function getSystemHealthModifier(): Promise<number> {
  if (healthCache && Date.now() - healthCache.at < HEALTH_CACHE_MS) return healthCache.value;

  const rows = await db
    .select({
      bet: tapHistory.betAmount,
      target: tapHistory.targetMultiplier,
      win: tapHistory.win,
    })
    .from(tapHistory)
    .where(sql`${tapHistory.createdAt} > now() - interval '24 hours'`);

  let totalIn = 0;
  let totalOut = 0;
  for (const r of rows) {
    totalIn += r.bet;
    if (r.win) totalOut += r.bet * r.target - r.bet;
  }
  totalIn = totalIn > 0 ? totalIn : 1;
  const ratio = totalOut / totalIn;

  let modifier = 1.0;
  if (ratio > 1.5) modifier = 0.7;
  else if (ratio > 1.1) modifier = 0.85;
  else if (ratio < 0.6) modifier = 1.1;

  healthCache = { at: Date.now(), value: modifier };
  return modifier;
}

/** Profil joueur sur les 50 dernières parties (streaks + plafond de gains). */
export async function analyzePlayerProfile(
  uid: number,
  currentBetUsd: number
): Promise<PlayerProfile> {
  const rows = await db
    .select({
      bet: tapHistory.betAmount,
      target: tapHistory.targetMultiplier,
      win: tapHistory.win,
    })
    .from(tapHistory)
    .where(eq(tapHistory.userId, uid))
    .orderBy(desc(tapHistory.id))
    .limit(50);

  let recentProfit = 0;
  for (const h of rows) {
    recentProfit += h.win ? h.bet * h.target - h.bet : -h.bet;
  }

  const profile: PlayerProfile = { type: "NORMAL", correction: 1.0, forceCrash: false };

  if (rows.length >= 3 && rows[0].win && rows[1].win && rows[2].win) {
    profile.type = "STREAK_BREAKER";
    profile.correction = 0.6;
  }

  const capThreshold = currentBetUsd >= TAP_CONFIG.HIGH_BET_THRESHOLD ? 100 : 30;
  if (recentProfit > capThreshold) {
    profile.type = "PROFIT_CAP_MED";
    profile.correction = 0.6;
  }
  if (recentProfit > 300) {
    profile.type = "PROFIT_CAP_HIGH";
    profile.forceCrash = true;
  }

  return profile;
}

/** Distribution du point de crash — port de get_smart_crash_value(). */
export function getSmartCrashValue(
  betAmountUsd: number,
  profile: PlayerProfile,
  systemHealth: number
): number {
  if (profile.forceCrash) return 1.0;

  const ranges =
    betAmountUsd >= TAP_CONFIG.HIGH_BET_THRESHOLD
      ? [
          [30, 1.0, 1.0],
          [40, 1.01, 1.5],
          [20, 1.51, 2.5],
          [7, 2.51, 4.0],
          [3, 4.01, 8.0],
        ]
      : [
          [20, 1.0, 1.0],
          [35, 1.01, 1.3],
          [25, 1.31, 2.2],
          [15, 2.21, 5.0],
          [5, 5.01, TAP_CONFIG.MAX_MULTIPLIER],
        ];

  let rand = randInt(1, 100);
  const totalCorrection = profile.correction * systemHealth;
  if (totalCorrection < 1.0) rand = Math.max(1, Math.floor(rand * totalCorrection));
  else if (totalCorrection > 1.0) rand = Math.min(100, Math.ceil(rand * totalCorrection));

  let cumul = 0;
  let rawCrash = 1.0;
  for (const [w, lo, hi] of ranges as number[][]) {
    cumul += w;
    if (rand <= cumul) {
      if (lo === 1.0 && hi === 1.0) rawCrash = 1.0;
      else rawCrash = randInt(lo * 100, hi * 100) / 100;
      break;
    }
  }
  return Math.min(rawCrash, TAP_CONFIG.MAX_MULTIPLIER);
}

// ---------------- Finalisation de manche ----------------

export interface RoundResult {
  bal: number;
  win: number;
}

export async function finalizeRound(
  uid: number,
  s: TapSession,
  win: boolean,
  reason: string,
  balance: number
): Promise<RoundResult> {
  const bet = s.bet;
  const mult = s.multiplier;
  let newBal = balance;
  let winAmount = 0;

  if (win) {
    winAmount = round2(bet * mult);
    newBal = round2(balance + winAmount);
  }

  await db.insert(tapHistory).values({
    userId: uid,
    betAmount: round2(bet),
    targetMultiplier: round2(mult),
    crashMultiplier: round2(s.crashPoint),
    win,
    balanceAfter: newBal,
    description: win ? `${reason} x${mult.toFixed(2)}` : `${reason} x${s.crashPoint.toFixed(2)}`,
  });

  clearSession(uid);
  return { bal: newBal, win: winAmount };
}
