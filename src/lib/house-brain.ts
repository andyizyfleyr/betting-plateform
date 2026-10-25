import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  acceleratorRounds,
  bets,
  comboBets,
  predictionBets,
  tapHistory,
} from "@/db/schema";
import { predictBatchUserMlRisk } from "./ml-engine";

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

  const [[sportAgg], [predAgg], [comboAgg], [tapAgg], [accelAgg]] = await Promise.all([
    db
      .select({
        staked: sql<number>`COALESCE(SUM(${bets.stake}), 0)::float8`,
        paid: sql<number>`COALESCE(SUM(CASE
          WHEN ${bets.status} = 'won' THEN ${bets.potentialWin}
          WHEN ${bets.status} = 'cashed' THEN COALESCE(${bets.cashOutAmount}, 0)
          WHEN ${bets.status} = 'void' THEN ${bets.stake}
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
          WHEN ${predictionBets.status} = 'void' THEN ${predictionBets.stake}
          ELSE 0 END), 0)::float8`,
      })
      .from(predictionBets)
      .where(sql`${predictionBets.placedAt} > now() - interval '24 hours'`),
    db
      .select({
        staked: sql<number>`COALESCE(SUM(${comboBets.stake}), 0)::float8`,
        paid: sql<number>`COALESCE(SUM(CASE
          WHEN ${comboBets.status} = 'won' THEN ${comboBets.potentialWin}
          WHEN ${comboBets.status} = 'cashed' THEN COALESCE(${comboBets.cashOutAmount}, 0)
          WHEN ${comboBets.status} = 'void' THEN ${comboBets.stake}
          ELSE 0 END), 0)::float8`,
      })
      .from(comboBets)
      .where(sql`${comboBets.placedAt} > now() - interval '24 hours'`),
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
    (comboAgg?.staked ?? 0) +
    (tapAgg?.staked ?? 0) +
    (accelAgg?.staked ?? 0);
  const totalOut24h =
    (sportAgg?.paid ?? 0) +
    (predAgg?.paid ?? 0) +
    (comboAgg?.paid ?? 0) +
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

/**
 * Détecteur multi-dimensionnel de patterns de paris sportifs par utilisateur :
 * Repère automatiquement les stratégies répétitives (« 100 % Domicile », « 100 % Favoris »,
 * « 100 % Over / Under », Martingale après perte, séries gagnantes ou profits nets élevés)
 * et retourne un coefficient de vigilance ∈ [1.0, 2.15] appliqué au bouclier de risque du match.
 */
export async function computeUserPatternRiskWeights(
  userIds: number[]
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  const uniqueIds = [...new Set(userIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (uniqueIds.length === 0) return result;

  const recent = await db
    .select({
      userId: bets.userId,
      market: bets.market,
      selection: bets.selection,
      stake: bets.stake,
      odds: bets.odds,
      status: bets.status,
      potentialWin: bets.potentialWin,
      cashOutAmount: bets.cashOutAmount,
    })
    .from(bets)
    .where(inArray(bets.userId, uniqueIds))
    .orderBy(desc(bets.id))
    .limit(Math.min(400, uniqueIds.length * 25));

  const byUser = new Map<number, typeof recent>();
  for (const r of recent) {
    const arr = byUser.get(r.userId) ?? [];
    if (arr.length < 22) {
      arr.push(r);
      byUser.set(r.userId, arr);
    }
  }

  for (const uid of uniqueIds) {
    const list = byUser.get(uid) ?? [];
    if (list.length < 4) {
      result.set(uid, 1.0);
      continue;
    }

    let totalStake = 0;
    let homeLeanStake = 0;
    let awayLeanStake = 0;
    let overLeanStake = 0;
    let underLeanStake = 0;
    let heavyFavStake = 0;
    let settledNet = 0;
    let winStreak = 0;
    let streakOpen = true;

    for (const b of list) {
      totalStake += b.stake;

      if (
        (b.market === "result" && b.selection === "home") ||
        (b.market === "double_chance" && b.selection === "1X") ||
        (b.market === "result_total" && b.selection === "home_over") ||
        b.market === "home_to_nil"
      ) {
        homeLeanStake += b.stake;
      } else if (
        (b.market === "result" && b.selection === "away") ||
        (b.market === "double_chance" && b.selection === "X2") ||
        (b.market === "result_total" && b.selection === "away_over") ||
        b.market === "away_to_nil"
      ) {
        awayLeanStake += b.stake;
      }

      if (b.selection.endsWith("_over") || (b.market === "btts" && b.selection === "oui")) {
        overLeanStake += b.stake;
      } else if (
        b.selection.endsWith("_under") ||
        b.selection === "under" ||
        (b.market === "btts" && b.selection === "non")
      ) {
        underLeanStake += b.stake;
      }

      if (b.odds <= 1.72) {
        heavyFavStake += b.stake;
      }

      if (b.status !== "pending") {
        const won = b.status === "won";
        const out = won
          ? b.potentialWin
          : b.status === "cashed"
            ? (b.cashOutAmount ?? 0)
            : 0;
        settledNet += out - b.stake;
        if (streakOpen) {
          if (won) winStreak++;
          else streakOpen = false;
        }
      }
    }

    const denom = Math.max(1, totalStake);
    const maxDirectionalShare = Math.max(
      homeLeanStake / denom,
      awayLeanStake / denom,
      overLeanStake / denom,
      underLeanStake / denom,
      (heavyFavStake / denom) * 0.92
    );

    let weight = 1.0;

    // 1. Pattern systématique (ex. spam Domicile, spam Favoris, spam Over)
    if (list.length >= 5 && maxDirectionalShare >= 0.7) {
      weight += clamp((maxDirectionalShare - 0.65) * 1.9, 0.15, 0.65);
    }

    // 2. Martingale / escalade brusque de mise après une perte
    const latest = list[0];
    const avgStake = totalStake / list.length;
    const prevSettled = list.find((x, idx) => idx > 0 && x.status !== "pending");
    if (
      latest &&
      ((prevSettled?.status === "lost" && latest.stake >= prevSettled.stake * 1.8) ||
        (latest.stake >= avgStake * 2.3 && latest.stake >= 15))
    ) {
      weight += 0.45;
    }

    // 3. Extraction nette positive ou série chaude
    if (settledNet > 25) {
      weight += clamp(settledNet / 180, 0.1, 0.55);
    }
    if (winStreak >= 3) {
      weight += clamp((winStreak - 2) * 0.12, 0.12, 0.36);
    }

    result.set(uid, clamp(weight, 1.0, 2.15));
  }

  // Fusionne le score heuristique avec l'inférence du Modèle 1 ML (`sharp_detector` Logistic SGD)
  try {
    const mlMap = await predictBatchUserMlRisk(uniqueIds);
    for (const [uid, ml] of mlMap.entries()) {
      const prev = result.get(uid) ?? 1.0;
      result.set(uid, clamp(Math.max(prev, ml.riskWeight), 1.0, 2.25));
    }
  } catch {
    // En cas d'indisponibilité transitoire, conserve les poids heuristiques
  }

  return result;
}
