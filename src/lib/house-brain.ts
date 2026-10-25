import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  acceleratorRounds,
  bets,
  predictionBets,
  tapHistory,
} from "@/db/schema";

/**
 * Cerveau global du bookmaker (« House Brain ») :
 * - Surveille en temps réel la santé financière globale de la plateforme (mises vs gains)
 * - Détecte les comportements d'exploitation : Martingale (doublement de mise),
 *   micro-scalping (encaissements systématiques à très basse cote), séries chaudes,
 *   et paris « baleine » disproportionnés.
 * - Calibre finement la variance, la marge de rachat (cash-out) et la résistance
 *   du moteur virtuel tout en respectant strictement les cotes fixes contractuelles.
 */

export interface GlobalHouseHealth {
  totalIn24h: number;
  totalOut24h: number;
  payoutRatio: number; // < 0.88 = maison très confortable, > 0.96 = maison sous pression
  tightness: number; // ∈ [0.78, 1.12] : < 1 resserre le jeu, > 1 détend légèrement
}

export interface SmartPlayerSignal {
  archetype:
    | "NEWBIE"
    | "RECREATIONAL"
    | "MICRO_SCALPER"
    | "MARTINGALE"
    | "HOT_STREAK"
    | "WHALE";
  winStreak: number;
  lossStreak: number;
  recentNetProfit: number;
  avgStake: number;
  stakeSpikeRatio: number;
  lowExitRate: number;
  /** Facteur de prudence ∈ [0.52, 1.08] (< 1 = plus rusé / défensif pour la maison). */
  cautionFactor: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const HOUSE_CACHE_TTL_MS = 20_000;
let houseCache: { at: number; data: GlobalHouseHealth } | null = null;

export function invalidateHouseHealthCache() {
  houseCache = null;
}

/** Calcule l'équilibre financier global sur 24h toutes verticales confondues. */
export async function getGlobalHouseHealth(): Promise<GlobalHouseHealth> {
  if (houseCache && Date.now() - houseCache.at < HOUSE_CACHE_TTL_MS) {
    return houseCache.data;
  }

  const [[sportAgg], [predAgg], [tapAgg], [accelAgg]] = await Promise.all([
    db
      .select({
        staked: sql<number>`COALESCE(SUM(${bets.stake}), 0)::float8`,
        paid: sql<number>`COALESCE(SUM(CASE
          WHEN ${bets.status} = 'won' THEN ${bets.potentialWin}
          WHEN ${bets.status} = 'cashed' THEN COALESCE(${bets.cashOutAmount}, 0)
          ELSE 0 END), 0)::float8`,
      })
      .from(bets)
      .where(sql`${bets.placedAt} > now() - interval '24 hours'`),
    db
      .select({
        staked: sql<number>`COALESCE(SUM(${predictionBets.stake}), 0)::float8`,
        paid: sql<number>`COALESCE(SUM(CASE
          WHEN ${predictionBets.status} = 'won' THEN ${predictionBets.potentialWin}
          WHEN ${predictionBets.status} = 'cashed' THEN COALESCE(${predictionBets.cashOutAmount}, 0)
          ELSE 0 END), 0)::float8`,
      })
      .from(predictionBets)
      .where(sql`${predictionBets.placedAt} > now() - interval '24 hours'`),
    db
      .select({
        staked: sql<number>`COALESCE(SUM(${tapHistory.betAmount}), 0)::float8`,
        paid: sql<number>`COALESCE(SUM(CASE
          WHEN ${tapHistory.win} = true THEN ${tapHistory.betAmount} * ${tapHistory.targetMultiplier}
          ELSE 0 END), 0)::float8`,
      })
      .from(tapHistory)
      .where(sql`${tapHistory.createdAt} > now() - interval '24 hours'`),
    db
      .select({
        staked: sql<number>`COALESCE(SUM(${acceleratorRounds.betAmount}), 0)::float8`,
        paid: sql<number>`COALESCE(SUM(CASE
          WHEN ${acceleratorRounds.status} = 'cashed' THEN ${acceleratorRounds.betAmount} * COALESCE(${acceleratorRounds.cashoutMultiplier}, 1)
          ELSE 0 END), 0)::float8`,
      })
      .from(acceleratorRounds)
      .where(sql`${acceleratorRounds.startedAt} > now() - interval '24 hours'`),
  ]);

  const totalIn24h =
    (sportAgg?.staked ?? 0) +
    (predAgg?.staked ?? 0) +
    (tapAgg?.staked ?? 0) +
    (accelAgg?.staked ?? 0);
  const totalOut24h =
    (sportAgg?.paid ?? 0) +
    (predAgg?.paid ?? 0) +
    (tapAgg?.paid ?? 0) +
    (accelAgg?.paid ?? 0);

  // Ancre minimale de 80 € pour éviter les sur-réactions à froid sur les toutes premières mises
  const payoutRatio = (totalOut24h + 30) / (totalIn24h + 40);

  let tightness = 1.0;
  if (payoutRatio > 1.15) tightness = 0.78;
  else if (payoutRatio > 0.98) tightness = 0.86;
  else if (payoutRatio > 0.9) tightness = 0.94;
  else if (payoutRatio < 0.65 && totalIn24h > 50) tightness = 1.06;

  const data: GlobalHouseHealth = {
    totalIn24h,
    totalOut24h,
    payoutRatio,
    tightness,
  };
  houseCache = { at: Date.now(), data };
  return data;
}

/**
 * Analyse comportementale fine d'un joueur sur une série d'historiques récents
 * (ordonnés du plus récent au plus ancien).
 */
export function buildSmartPlayerSignal(
  recentRounds: Array<{ stake: number; multiplier: number; won: boolean }>,
  currentStake: number
): SmartPlayerSignal {
  if (recentRounds.length < 3) {
    return {
      archetype: "NEWBIE",
      winStreak: recentRounds.filter((r) => r.won).length,
      lossStreak: 0,
      recentNetProfit: 0,
      avgStake: currentStake,
      stakeSpikeRatio: 1,
      lowExitRate: 0,
      cautionFactor: currentStake > 25 ? 0.86 : 1.04,
    };
  }

  let winStreak = 0;
  for (const r of recentRounds) {
    if (r.won) winStreak++;
    else break;
  }

  let lossStreak = 0;
  for (const r of recentRounds) {
    if (!r.won) lossStreak++;
    else break;
  }

  let recentNetProfit = 0;
  let totalStake = 0;
  let lowExitWins = 0;
  let totalWins = 0;

  for (const r of recentRounds) {
    totalStake += r.stake;
    if (r.won) {
      totalWins++;
      recentNetProfit += r.stake * (r.multiplier - 1);
      if (r.multiplier <= 1.18) lowExitWins++;
    } else {
      recentNetProfit -= r.stake;
    }
  }

  const avgStake = totalStake / recentRounds.length;
  const stakeSpikeRatio = avgStake > 0 ? currentStake / avgStake : 1;
  const lowExitRate = totalWins >= 3 ? lowExitWins / totalWins : 0;

  // Détection Martingale : série de défaites suivie d'une mise >= 1.85× la moyenne ou précédente
  const prevStake = recentRounds[0]?.stake ?? currentStake;
  const isMartingale =
    (lossStreak >= 1 && currentStake >= prevStake * 1.85 && currentStake >= 5) ||
    (stakeSpikeRatio >= 2.4 && currentStake >= 10);

  const isMicroScalper = totalWins >= 4 && lowExitRate >= 0.65;
  const isWhale = currentStake >= 40 || (stakeSpikeRatio >= 3.2 && currentStake >= 15);
  const isHotStreak = winStreak >= 3 || recentNetProfit >= Math.max(35, avgStake * 4.5);

  let archetype: SmartPlayerSignal["archetype"] = "RECREATIONAL";
  let cautionFactor = 0.97;

  if (isMartingale) {
    archetype = "MARTINGALE";
    cautionFactor = 0.62;
  } else if (isMicroScalper) {
    archetype = "MICRO_SCALPER";
    cautionFactor = 0.66;
  } else if (isWhale) {
    archetype = "WHALE";
    cautionFactor = 0.7;
  } else if (isHotStreak) {
    archetype = "HOT_STREAK";
    cautionFactor = clamp(0.76 - (winStreak - 3) * 0.05, 0.56, 0.78);
  } else if (lossStreak >= 4 && currentStake <= avgStake * 1.15 && currentStake <= 15) {
    // Respiration psychologique légère sur petite mise après série noire (évite la frustration brute)
    cautionFactor = 1.04;
  }

  if (recentNetProfit > 120) {
    cautionFactor = Math.min(cautionFactor, 0.6);
  }

  return {
    archetype,
    winStreak,
    lossStreak,
    recentNetProfit,
    avgStake,
    stakeSpikeRatio,
    lowExitRate,
    cautionFactor: clamp(cautionFactor, 0.52, 1.08),
  };
}

/** Profil joueur rapide côté Accelerator (25 dernières manches). */
export async function analyzeAcceleratorProfile(
  uid: number,
  currentStake: number
): Promise<SmartPlayerSignal> {
  const rows = await db
    .select({
      betAmount: acceleratorRounds.betAmount,
      cashoutMultiplier: acceleratorRounds.cashoutMultiplier,
      status: acceleratorRounds.status,
    })
    .from(acceleratorRounds)
    .where(eq(acceleratorRounds.userId, uid))
    .orderBy(desc(acceleratorRounds.id))
    .limit(25);

  const mapped = rows
    .filter((r) => r.status !== "active")
    .map((r) => ({
      stake: Number(r.betAmount) || 1,
      multiplier: Number(r.cashoutMultiplier) || 1,
      won: r.status === "cashed",
    }));

  return buildSmartPlayerSignal(mapped, currentStake);
}
