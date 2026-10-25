import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { tapHistory } from "@/db/schema";
import {
  buildSmartPlayerSignal,
  getGlobalHouseHealth,
  invalidateHouseHealthCache,
} from "./house-brain";

/**
 * Moteur intelligent (« rusé ») du jeu Tap Win :
 * - Détecte en temps réel le micro-scalping (sorties systématiques à 1 clic / ×1.05),
 *   les montantes type Martingale, les séries chaudes et les grosses mises.
 * - Calibre dynamiquement la distribution des points de crash et les « near-misses »
 *   psychologiques (ex. ×1.95, ×2.90, ×4.85) tout en préservant l'API exacte du jeu.
 */

export const TAP_CONFIG = {
  BET_MAX_USD: 100,
  INITIAL_MULTIPLIER: 1.0,
  GROWTH_FACTOR: 1.05,
  MAX_MULTIPLIER: 100.0,
  HIGH_BET_THRESHOLD: 2.5,
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
  lowExitRate: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

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

/** floor(initial * factor^clicks * 100) / 100 — identique à calc_mult_safe(). */
export function calcMultSafe(initial: number, factor: number, clicks: number): number {
  return Math.floor(initial * Math.pow(factor, clicks) * 100) / 100;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Santé globale unifiée (24h toutes verticales confondues). */
export async function getSystemHealthModifier(): Promise<number> {
  const health = await getGlobalHouseHealth();
  return health.tightness;
}

/** Profil joueur intelligent sur les 40 dernières parties. */
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
    .limit(40);

  const signal = buildSmartPlayerSignal(
    rows.map((r) => ({
      stake: r.bet,
      multiplier: r.target,
      won: r.win,
    })),
    currentBetUsd
  );

  // Plafond absolu anti-fuite de banque sur profit cumulé excessif
  const forceCrash =
    signal.recentNetProfit > 280 ||
    (signal.archetype === "MARTINGALE" && signal.stakeSpikeRatio >= 4 && Math.random() < 0.55);

  return {
    type: signal.archetype,
    correction: signal.cautionFactor,
    forceCrash,
    lowExitRate: signal.lowExitRate,
  };
}

/** Distribution rusée du point de crash avec near-misses psychologiques. */
export function getSmartCrashValue(
  betAmountUsd: number,
  profile: PlayerProfile,
  systemHealth: number
): number {
  if (profile.forceCrash) return 1.0;

  // Anti-bot 1-clic (×1.05) : si le joueur scalpe systématiquement les tout petits multiplicateurs,
  // on relève la probabilité de crash instantané à ×1.00 pour neutraliser l'espérance positive.
  if (profile.type === "MICRO_SCALPER" || profile.lowExitRate >= 0.65) {
    if (Math.random() < 0.44) return 1.0;
  }

  const isHeavyBet =
    betAmountUsd >= TAP_CONFIG.HIGH_BET_THRESHOLD * 3 ||
    profile.type === "MARTINGALE" ||
    profile.type === "WHALE";

  // Poids [poids, minMult, maxMult]
  const ranges: Array<[number, number, number]> = isHeavyBet
    ? [
        [32, 1.0, 1.0],
        [38, 1.04, 1.48],
        [20, 1.49, 2.35],
        [8, 2.36, 3.95],
        [2, 3.96, 7.5],
      ]
    : betAmountUsd >= TAP_CONFIG.HIGH_BET_THRESHOLD
      ? [
          [24, 1.0, 1.0],
          [36, 1.04, 1.55],
          [24, 1.56, 2.65],
          [12, 2.66, 4.9],
          [4, 4.91, 12.0],
        ]
      : [
          [18, 1.0, 1.0],
          [32, 1.05, 1.45],
          [28, 1.46, 2.45],
          [16, 2.46, 5.4],
          [6, 5.41, 24.0],
        ];

  let rand = randInt(1, 100);
  const totalCorrection = profile.correction * systemHealth;
  if (totalCorrection < 1.0) rand = Math.max(1, Math.floor(rand * totalCorrection));
  else if (totalCorrection > 1.0) rand = Math.min(100, Math.ceil(rand * totalCorrection));

  let cumul = 0;
  let rawCrash = 1.0;
  for (const [w, lo, hi] of ranges) {
    cumul += w;
    if (rand <= cumul) {
      if (lo === 1.0 && hi === 1.0) {
        rawCrash = 1.0;
      } else {
        rawCrash = randInt(Math.round(lo * 100), Math.round(hi * 100)) / 100;
      }
      break;
    }
  }

  // Effet « near-miss » juste avant les paliers psychologiques ronds (×2.00, ×3.00, ×5.00)
  if (rawCrash > 1.98 && rawCrash <= 2.08 && Math.random() < 0.65) {
    rawCrash = randInt(188, 198) / 100;
  } else if (rawCrash > 2.98 && rawCrash <= 3.12 && Math.random() < 0.6) {
    rawCrash = randInt(284, 297) / 100;
  }

  return Math.min(rawCrash, TAP_CONFIG.MAX_MULTIPLIER);
}

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
  invalidateHouseHealthCache();
  return { bal: newBal, win: winAmount };
}
