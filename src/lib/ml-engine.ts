import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { expectedGoalsRaw } from "@/db/fixtures";
import {
  appUser,
  bets,
  comboBets,
  matches,
  mlModels,
  type MatchRow,
} from "@/db/schema";
import { buildLiveMarkets, buildMarkets, minuteNumber } from "@/lib/markets";
import {
  computeSegmentMarginMultiplier,
  defaultGlickoClubsState,
  defaultMarketCalibratorState,
  defaultSharpModelState,
  extractSharpFeatures,
  hydrateMlRuntimeCaches,
  normClubKey,
  onlineSgdStepSharp,
  predictSharpProbability,
  segmentKeyOf,
  SHARP_FEATURE_KEYS,
  SHARP_FEATURE_LABELS,
  PRIOR_SHARP_WEIGHTS,
  updateGlickoPairFromMatch,
  type BetSampleForFeatures,
  type ClubGlickoRating,
  type GlickoClubsState,
  type MarketCalibratorState,
  type RecommenderMetaState,
  type SharpModelState,
} from "@/lib/ml-weights";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

const ML_CACHE_TTL_MS = 25_000;

interface InMemoryMlBundle {
  loadedAt: number;
  sharp: SharpModelState;
  sharpMeta: { version: number; samplesCount: number; updatedAt: Date };
  calibrator: MarketCalibratorState;
  calibratorMeta: { version: number; samplesCount: number; updatedAt: Date };
  glicko: GlickoClubsState;
  glickoMeta: { version: number; samplesCount: number; updatedAt: Date };
  recommender: RecommenderMetaState;
  recommenderMeta: { version: number; samplesCount: number; updatedAt: Date };
}

let mlBundle: InMemoryMlBundle | null = null;
let mlLoadPromise: Promise<InMemoryMlBundle> | null = null;
let lastPersistAt = 0;

function defaultRecommenderState(): RecommenderMetaState {
  return {
    leaguePopularity: {
      "Ligue des Champions": 18,
      "Premier League": 16,
      "Ligue 1": 15,
      Liga: 13,
      "Serie A": 11,
      Bundesliga: 11,
    },
    marketPopularity: {
      result: 32,
      total_ou: 22,
      btts: 18,
      double_chance: 14,
      result_total: 10,
    },
    avgPreferredOdds: 2.05,
    totalAnalysedBets: 0,
  };
}

/**
 * Charge en mémoire les 4 modèles ML depuis PostgreSQL (ou déclenche l'amorçage
 * automatique sur l'historique existant lors du tout premier démarrage).
 */
export async function ensureMlLoaded(forceReload = false): Promise<InMemoryMlBundle> {
  if (!forceReload && mlBundle && Date.now() - mlBundle.loadedAt < ML_CACHE_TTL_MS) {
    return mlBundle;
  }
  if (mlLoadPromise) {
    return mlLoadPromise;
  }

  mlLoadPromise = (async () => {
    try {
      const rows = await db.select().from(mlModels);
      if (rows.length < 4) {
        return await retrainAllMlModels();
      }

      const byKey = new Map(rows.map((r) => [r.modelKey, r]));
      const sharpRow = byKey.get("sharp_detector");
      const calRow = byKey.get("market_calibrator");
      const glickoRow = byKey.get("glicko_clubs");
      const recRow = byKey.get("recommender_meta");

      const sharp = {
        ...defaultSharpModelState(),
        ...((sharpRow?.state as Partial<SharpModelState> | undefined) ?? {}),
      };
      const calibrator = {
        ...defaultMarketCalibratorState(),
        ...((calRow?.state as Partial<MarketCalibratorState> | undefined) ?? {}),
      };
      const glicko = {
        ...defaultGlickoClubsState(),
        ...((glickoRow?.state as Partial<GlickoClubsState> | undefined) ?? {}),
      };
      const recommender = {
        ...defaultRecommenderState(),
        ...((recRow?.state as Partial<RecommenderMetaState> | undefined) ?? {}),
      };

      hydrateMlRuntimeCaches({ calibrator, glicko });

      const nowDate = new Date();
      mlBundle = {
        loadedAt: Date.now(),
        sharp,
        sharpMeta: {
          version: sharpRow?.version ?? 1,
          samplesCount: sharpRow?.samplesCount ?? 0,
          updatedAt: sharpRow?.updatedAt ?? nowDate,
        },
        calibrator,
        calibratorMeta: {
          version: calRow?.version ?? 1,
          samplesCount: calRow?.samplesCount ?? 0,
          updatedAt: calRow?.updatedAt ?? nowDate,
        },
        glicko,
        glickoMeta: {
          version: glickoRow?.version ?? 1,
          samplesCount: glickoRow?.samplesCount ?? 0,
          updatedAt: glickoRow?.updatedAt ?? nowDate,
        },
        recommender,
        recommenderMeta: {
          version: recRow?.version ?? 1,
          samplesCount: recRow?.samplesCount ?? 0,
          updatedAt: recRow?.updatedAt ?? nowDate,
        },
      };
      return mlBundle;
    } finally {
      mlLoadPromise = null;
    }
  })();

  return mlLoadPromise;
}

async function upsertMlModelRow(
  modelKey: string,
  version: number,
  samplesCount: number,
  brierScore: number,
  logLoss: number,
  state: Record<string, unknown>
): Promise<void> {
  const now = new Date();
  await db
    .insert(mlModels)
    .values({
      modelKey,
      version,
      samplesCount,
      brierScore: round4(brierScore),
      logLoss: round4(logLoss),
      state,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: mlModels.modelKey,
      set: {
        version,
        samplesCount,
        brierScore: round4(brierScore),
        logLoss: round4(logLoss),
        state,
        updatedAt: now,
      },
    });
}

/**
 * APPRENTISSAGE EN LIGNE — Modèle 3 (`glicko_clubs`) :
 * Appelé automatiquement dès qu'un match se termine dans `engine.ts`.
 */
export async function recordMatchFinishedMl(match: {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}): Promise<void> {
  const bundle = await ensureMlLoaded();
  const hKey = normClubKey(match.homeTeam);
  const aKey = normClubKey(match.awayTeam);
  const { lambdaHome, lambdaAway } = expectedGoalsRaw(match.homeTeam, match.awayTeam);

  const upd = updateGlickoPairFromMatch(
    bundle.glicko.clubs[hKey],
    bundle.glicko.clubs[aKey],
    match.homeScore,
    match.awayScore,
    lambdaHome,
    lambdaAway
  );

  bundle.glicko.clubs[hKey] = upd.homeNext;
  bundle.glicko.clubs[aKey] = upd.awayNext;
  bundle.glicko.emaBrier = round4(0.95 * bundle.glicko.emaBrier + 0.05 * upd.brierSample);
  bundle.glicko.emaLogLoss = round4(0.95 * bundle.glicko.emaLogLoss + 0.05 * upd.logLossSample);
  bundle.glickoMeta.samplesCount += 1;
  bundle.glickoMeta.updatedAt = new Date();

  hydrateMlRuntimeCaches({ glicko: bundle.glicko });

  await upsertMlModelRow(
    "glicko_clubs",
    bundle.glickoMeta.version,
    bundle.glickoMeta.samplesCount,
    bundle.glicko.emaBrier,
    bundle.glicko.emaLogLoss,
    bundle.glicko as unknown as Record<string, unknown>
  );
}

/**
 * APPRENTISSAGE EN LIGNE — Modèles 1 (`sharp_detector`) & 2 (`market_calibrator`) :
 * Appelé automatiquement à chaque règlement de pari dans `settle.ts`.
 */
export async function recordSettledBetMl(params: {
  userId: number;
  market: string;
  odds: number;
  stake: number;
  won: boolean;
  payout: number;
}): Promise<void> {
  const bundle = await ensureMlLoaded();
  const odds = Math.max(1.01, params.odds);
  const pPred = clamp(0.93 / odds, 0.015, 0.97);
  const yWin = params.won ? 1 : 0;

  // 1. Mise à jour bayésienne incrémentale du segment de marché (Modèle 2)
  const segKey = segmentKeyOf(params.market, odds);
  const prevSeg = bundle.calibrator.segments[segKey] ?? {
    n: 0,
    sumPredProb: 0,
    sumWins: 0,
    staked: 0,
    paid: 0,
    marginMult: 1.0,
  };
  const decay = 0.992;
  const nextSeg = {
    n: round4(prevSeg.n * decay + 1),
    sumPredProb: round4(prevSeg.sumPredProb * decay + pPred),
    sumWins: round4(prevSeg.sumWins * decay + yWin),
    staked: round2(prevSeg.staked * decay + params.stake),
    paid: round2(prevSeg.paid * decay + params.payout),
    marginMult: 1.0,
  };
  nextSeg.marginMult = computeSegmentMarginMultiplier(nextSeg);
  bundle.calibrator.segments[segKey] = nextSeg;

  const brierMkt = (pPred - yWin) * (pPred - yWin);
  const logLossMkt = -(yWin * Math.log(pPred) + (1 - yWin) * Math.log(1 - pPred));
  bundle.calibrator.emaBrier = round4(0.95 * bundle.calibrator.emaBrier + 0.05 * brierMkt);
  bundle.calibrator.emaLogLoss = round4(0.95 * bundle.calibrator.emaLogLoss + 0.05 * logLossMkt);
  bundle.calibratorMeta.samplesCount += 1;
  bundle.calibratorMeta.updatedAt = new Date();

  hydrateMlRuntimeCaches({ calibrator: bundle.calibrator });

  // 2. Descente de gradient en ligne sur le profil du joueur (Modèle 1)
  const userRows = await db
    .select({
      market: bets.market,
      selection: bets.selection,
      stake: bets.stake,
      odds: bets.odds,
      closingOdds: bets.closingOdds,
      status: bets.status,
      potentialWin: bets.potentialWin,
      cashOutAmount: bets.cashOutAmount,
      riskFlag: bets.riskFlag,
      placedAt: bets.placedAt,
    })
    .from(bets)
    .where(eq(bets.userId, params.userId))
    .orderBy(desc(bets.id))
    .limit(22);

  if (userRows.length >= 4) {
    const samples: BetSampleForFeatures[] = userRows.map((r) => ({
      market: r.market,
      selection: r.selection,
      stake: r.stake,
      odds: r.odds,
      closingOdds: r.closingOdds,
      status: r.status,
      potentialWin: r.potentialWin,
      cashOutAmount: r.cashOutAmount,
      riskFlag: r.riskFlag,
      placedAtMs: r.placedAt ? r.placedAt.getTime() : Date.now(),
    }));
    const features = extractSharpFeatures(samples.slice(1));
    const netReturn = params.payout - params.stake;
    const softTarget = clamp(0.5 + netReturn / Math.max(8, params.stake * 2.2), 0.05, 0.95);
    bundle.sharp = onlineSgdStepSharp(bundle.sharp, features, softTarget);
    bundle.sharpMeta.samplesCount += 1;
    bundle.sharpMeta.updatedAt = new Date();
  }

  // Persistance régulée (évite d'écrire 15 fois dans la même milliseconde sur un match très parié)
  const now = Date.now();
  if (now - lastPersistAt > 800) {
    lastPersistAt = now;
    await Promise.all([
      upsertMlModelRow(
        "market_calibrator",
        bundle.calibratorMeta.version,
        bundle.calibratorMeta.samplesCount,
        bundle.calibrator.emaBrier,
        bundle.calibrator.emaLogLoss,
        bundle.calibrator as unknown as Record<string, unknown>
      ),
      upsertMlModelRow(
        "sharp_detector",
        bundle.sharpMeta.version,
        bundle.sharpMeta.samplesCount,
        bundle.sharp.emaBrier,
        bundle.sharp.emaLogLoss,
        bundle.sharp as unknown as Record<string, unknown>
      ),
    ]);
  }
}

/**
 * RÉ-ENTRAÎNEMENT BATCH COMPLET DES 4 MODÈLES ML :
 * Rejoue l'historique réel PostgreSQL (`matches`, `bets`, `combo_bets`) pour
 * recalibrer les poids SGD, les segments bayésiens, les ratings Glicko-2 et
 * les priors collaboratifs de recommandation.
 */
export async function retrainAllMlModels(): Promise<InMemoryMlBundle> {
  const [existingModels, finishedMatches, settledBetsRows, recentCombos] = await Promise.all([
    db.select().from(mlModels),
    db
      .select({
        homeTeam: matches.homeTeam,
        awayTeam: matches.awayTeam,
        homeScore: matches.homeScore,
        awayScore: matches.awayScore,
        finishedAt: matches.finishedAt,
        startsAt: matches.startsAt,
      })
      .from(matches)
      .where(eq(matches.status, "finished"))
      .orderBy(asc(matches.startsAt))
      .limit(300),
    db
      .select({
        id: bets.id,
        userId: bets.userId,
        league: bets.league,
        market: bets.market,
        selection: bets.selection,
        stake: bets.stake,
        odds: bets.odds,
        closingOdds: bets.closingOdds,
        status: bets.status,
        potentialWin: bets.potentialWin,
        cashOutAmount: bets.cashOutAmount,
        riskFlag: bets.riskFlag,
        placedAt: bets.placedAt,
      })
      .from(bets)
      .where(inArray(bets.status, ["won", "lost", "cashed"]))
      .orderBy(asc(bets.id))
      .limit(800),
    db
      .select({
        legs: comboBets.legs,
        stake: comboBets.stake,
        baseOdds: comboBets.baseOdds,
      })
      .from(comboBets)
      .orderBy(desc(comboBets.id))
      .limit(200),
  ]);

  const prevVersions = new Map(existingModels.map((m) => [m.modelKey, m.version]));
  const nextVer = (k: string) => (prevVersions.get(k) ?? 0) + 1;

  // ── 1. Entraînement Glicko-2 Attaque / Défense sur tous les matchs terminés ──
  const glickoState = defaultGlickoClubsState();
  let gBrierSum = 0;
  let gLogSum = 0;
  let gCount = 0;

  for (const m of finishedMatches) {
    if (m.homeScore == null || m.awayScore == null) continue;
    const hKey = normClubKey(m.homeTeam);
    const aKey = normClubKey(m.awayTeam);
    const { lambdaHome, lambdaAway } = expectedGoalsRaw(m.homeTeam, m.awayTeam);
    const upd = updateGlickoPairFromMatch(
      glickoState.clubs[hKey],
      glickoState.clubs[aKey],
      m.homeScore,
      m.awayScore,
      lambdaHome,
      lambdaAway
    );
    glickoState.clubs[hKey] = upd.homeNext;
    glickoState.clubs[aKey] = upd.awayNext;
    gBrierSum += upd.brierSample;
    gLogSum += upd.logLossSample;
    gCount++;
  }
  if (gCount > 0) {
    glickoState.emaBrier = round4(gBrierSum / gCount);
    glickoState.emaLogLoss = round4(gLogSum / gCount);
  }

  // ── 2. Entraînement de l'Auto-Calibrateur Bayésien de Marché ──
  const calState = defaultMarketCalibratorState();
  let cBrierSum = 0;
  let cLogSum = 0;
  let cCount = 0;

  for (const b of settledBetsRows) {
    const odds = Math.max(1.01, b.odds);
    const pPred = clamp(0.93 / odds, 0.015, 0.97);
    const won = b.status === "won" ? 1 : b.status === "cashed" ? 0.5 : 0;
    const payout =
      b.status === "won" ? b.potentialWin : b.status === "cashed" ? (b.cashOutAmount ?? 0) : 0;

    const segKey = segmentKeyOf(b.market, odds);
    const prev = calState.segments[segKey] ?? {
      n: 0,
      sumPredProb: 0,
      sumWins: 0,
      staked: 0,
      paid: 0,
      marginMult: 1.0,
    };
    prev.n = round4(prev.n * 0.996 + 1);
    prev.sumPredProb = round4(prev.sumPredProb * 0.996 + pPred);
    prev.sumWins = round4(prev.sumWins * 0.996 + won);
    prev.staked = round2(prev.staked * 0.996 + b.stake);
    prev.paid = round2(prev.paid * 0.996 + payout);
    prev.marginMult = computeSegmentMarginMultiplier(prev);
    calState.segments[segKey] = prev;

    const yBin = b.status === "won" ? 1 : 0;
    cBrierSum += (pPred - yBin) * (pPred - yBin);
    cLogSum += -(yBin * Math.log(pPred) + (1 - yBin) * Math.log(1 - pPred));
    cCount++;
  }
  if (cCount > 0) {
    calState.emaBrier = round4(cBrierSum / cCount);
    calState.emaLogLoss = round4(cLogSum / cCount);
  }

  // ── 3. Entraînement supervisé multi-époques du Détecteur IA « Sharp » (Logistic SGD) ──
  let sharpState = defaultSharpModelState();
  const byUser = new Map<number, BetSampleForFeatures[]>();
  for (const b of settledBetsRows) {
    const arr = byUser.get(b.userId) ?? [];
    arr.push({
      market: b.market,
      selection: b.selection,
      stake: b.stake,
      odds: b.odds,
      closingOdds: b.closingOdds,
      status: b.status,
      potentialWin: b.potentialWin,
      cashOutAmount: b.cashOutAmount,
      riskFlag: b.riskFlag,
      placedAtMs: b.placedAt ? b.placedAt.getTime() : Date.now(),
    });
    byUser.set(b.userId, arr);
  }

  const trainingPairs: Array<{ x: number[]; y: number }> = [];
  for (const [, seq] of byUser.entries()) {
    if (seq.length < 5) continue;
    for (let idx = 4; idx < seq.length; idx++) {
      // Fenêtre passée (ordonnée du plus récent au plus ancien comme attendu par extractSharpFeatures)
      const pastWindow = seq.slice(Math.max(0, idx - 18), idx).reverse();
      const x = extractSharpFeatures(pastWindow);
      // Cible supervisée : rentabilité future sur les 1 à 4 paris suivants
      const horizon = seq.slice(idx, Math.min(seq.length, idx + 4));
      let st = 0;
      let pa = 0;
      for (const h of horizon) {
        st += h.stake;
        if (h.status === "won") pa += h.potentialWin;
        else if (h.status === "cashed") pa += h.cashOutAmount ?? 0;
      }
      const futureRoi = st > 0 ? (pa - st) / st : -0.07;
      const y = futureRoi > 0.06 ? 1 : futureRoi > -0.04 ? 0.55 : 0;
      trainingPairs.push({ x, y });
    }
  }

  if (trainingPairs.length > 0) {
    // 3 époques de SGD régularisé pour une convergence douce et stable
    for (let epoch = 0; epoch < 3; epoch++) {
      for (const sample of trainingPairs) {
        sharpState = onlineSgdStepSharp(sharpState, sample.x, sample.y);
      }
    }
  }

  // ── 4. Apprentissage des Priors Collaboratifs du Moteur de Recommandation (Modèle 4) ──
  const recState = defaultRecommenderState();
  let sumOdds = 0;
  let oddsN = 0;

  for (const b of settledBetsRows) {
    if (b.league) {
      recState.leaguePopularity[b.league] = (recState.leaguePopularity[b.league] ?? 2) + 1;
    }
    recState.marketPopularity[b.market] = (recState.marketPopularity[b.market] ?? 2) + 1;
    sumOdds += clamp(b.odds, 1.1, 8.0);
    oddsN++;
  }
  for (const cb of recentCombos) {
    for (const leg of cb.legs ?? []) {
      if (leg.league) {
        recState.leaguePopularity[leg.league] = (recState.leaguePopularity[leg.league] ?? 2) + 1;
      }
      if (leg.market) {
        recState.marketPopularity[leg.market] = (recState.marketPopularity[leg.market] ?? 2) + 1;
      }
      if (leg.odds) {
        sumOdds += clamp(leg.odds, 1.1, 8.0);
        oddsN++;
      }
    }
  }
  if (oddsN > 0) {
    recState.avgPreferredOdds = round2(sumOdds / oddsN);
  }
  recState.totalAnalysedBets = settledBetsRows.length + recentCombos.length;

  hydrateMlRuntimeCaches({ calibrator: calState, glicko: glickoState });

  const sharpVer = nextVer("sharp_detector");
  const calVer = nextVer("market_calibrator");
  const glickoVer = nextVer("glicko_clubs");
  const recVer = nextVer("recommender_meta");

  await Promise.all([
    upsertMlModelRow(
      "sharp_detector",
      sharpVer,
      trainingPairs.length,
      sharpState.emaBrier,
      sharpState.emaLogLoss,
      sharpState as unknown as Record<string, unknown>
    ),
    upsertMlModelRow(
      "market_calibrator",
      calVer,
      cCount,
      calState.emaBrier,
      calState.emaLogLoss,
      calState as unknown as Record<string, unknown>
    ),
    upsertMlModelRow(
      "glicko_clubs",
      glickoVer,
      gCount,
      glickoState.emaBrier,
      glickoState.emaLogLoss,
      glickoState as unknown as Record<string, unknown>
    ),
    upsertMlModelRow(
      "recommender_meta",
      recVer,
      recState.totalAnalysedBets,
      0.185,
      0.54,
      recState as unknown as Record<string, unknown>
    ),
  ]);

  const nowDate = new Date();
  mlBundle = {
    loadedAt: Date.now(),
    sharp: sharpState,
    sharpMeta: { version: sharpVer, samplesCount: trainingPairs.length, updatedAt: nowDate },
    calibrator: calState,
    calibratorMeta: { version: calVer, samplesCount: cCount, updatedAt: nowDate },
    glicko: glickoState,
    glickoMeta: { version: glickoVer, samplesCount: gCount, updatedAt: nowDate },
    recommender: recState,
    recommenderMeta: {
      version: recVer,
      samplesCount: recState.totalAnalysedBets,
      updatedAt: nowDate,
    },
  };

  return mlBundle;
}

/**
 * INFÉRENCE LOT — Modèle 1 (`sharp_detector`) :
 * Calcule la probabilité IA `P(Sharp)` et le poids de vigilance `riskWeight ∈ [1.0, 2.25]`
 * pour une liste d'utilisateurs actifs.
 */
export async function predictBatchUserMlRisk(
  userIds: number[]
): Promise<Map<number, { pSharp: number; riskWeight: number; maxStake: number; topFactor: string }>> {
  const out = new Map<
    number,
    { pSharp: number; riskWeight: number; maxStake: number; topFactor: string }
  >();
  const unique = [...new Set(userIds.filter((u) => Number.isFinite(u) && u > 0))];
  if (unique.length === 0) return out;

  const bundle = await ensureMlLoaded();
  const rows = await db
    .select({
      userId: bets.userId,
      market: bets.market,
      selection: bets.selection,
      stake: bets.stake,
      odds: bets.odds,
      closingOdds: bets.closingOdds,
      status: bets.status,
      potentialWin: bets.potentialWin,
      cashOutAmount: bets.cashOutAmount,
      riskFlag: bets.riskFlag,
      placedAt: bets.placedAt,
    })
    .from(bets)
    .where(inArray(bets.userId, unique))
    .orderBy(desc(bets.id))
    .limit(Math.min(500, unique.length * 25));

  const byUser = new Map<number, BetSampleForFeatures[]>();
  for (const r of rows) {
    const arr = byUser.get(r.userId) ?? [];
    if (arr.length < 22) {
      arr.push({
        market: r.market,
        selection: r.selection,
        stake: r.stake,
        odds: r.odds,
        closingOdds: r.closingOdds,
        status: r.status,
        potentialWin: r.potentialWin,
        cashOutAmount: r.cashOutAmount,
        riskFlag: r.riskFlag,
        placedAtMs: r.placedAt ? r.placedAt.getTime() : Date.now(),
      });
      byUser.set(r.userId, arr);
    }
  }

  for (const uid of unique) {
    const hist = byUser.get(uid) ?? [];
    if (hist.length < 3) {
      out.set(uid, {
        pSharp: 0.16,
        riskWeight: 1.0,
        maxStake: 500,
        topFactor: "Profil récréatif neuf",
      });
      continue;
    }
    const feats = extractSharpFeatures(hist);
    const pred = predictSharpProbability(feats, bundle.sharp);
    const pSharp = pred.probability;
    const riskWeight = round2(clamp(1.0 + Math.max(0, pSharp - 0.2) * 1.55, 1.0, 2.25));
    const maxStake = Math.round(
      clamp(500 * (1 - 0.72 * Math.max(0, pSharp - 0.22)), 120, 500)
    );
    out.set(uid, {
      pSharp,
      riskWeight,
      maxStake,
      topFactor: SHARP_FEATURE_LABELS[pred.topFactorKey],
    });
  }

  return out;
}

/* ──────────────────────────────────────────────────────────────────────────
 *  MODÈLE 4 : Recommandation Personnalisée IA (Hybride Collaboratif + Contenu)
 * ────────────────────────────────────────────────────────────────────────── */

export interface MlRecommendedPick {
  matchId: number;
  league: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  minute: string | null;
  startsAt: string;
  market: string;
  marketLabel: string;
  selection: string;
  selectionLabel: string;
  odds: number;
  matchScorePct: number; // affinité IA 74..98 %
  reason: string;
}

export interface MlSmartComboSuggestion {
  title: string;
  reason: string;
  legs: MlRecommendedPick[];
  combinedOdds: number;
}

const RECOMMENDABLE_MARKETS = new Set([
  "result",
  "double_chance",
  "total_ou",
  "btts",
  "result_total",
]);

const MARKET_SHORT_REASON: Record<string, string> = {
  result: "1N2",
  double_chance: "Double chance",
  total_ou: "Plus/Moins buts",
  btts: "Les 2 marquent",
  result_total: "Résultat & Buts",
};

export async function getPersonalizedRecommendations(uid: number | null): Promise<{
  personalized: boolean;
  preferredOdds: number;
  favoriteLeague: string | null;
  picks: MlRecommendedPick[];
  smartCombo: MlSmartComboSuggestion | null;
}> {
  const bundle = await ensureMlLoaded();

  const openMatches = await db
    .select()
    .from(matches)
    .where(inArray(matches.status, ["live", "upcoming"]))
    .orderBy(
      asc(sql`CASE ${matches.status} WHEN 'live' THEN 0 ELSE 1 END`),
      asc(matches.startsAt)
    )
    .limit(6);

  if (openMatches.length === 0) {
    return {
      personalized: false,
      preferredOdds: bundle.recommender.avgPreferredOdds,
      favoriteLeague: null,
      picks: [],
      smartCombo: null,
    };
  }

  // Embedding personnel du joueur fusionné par shrinkage bayésien avec les priors globaux
  const leagueWeights: Record<string, number> = { ...bundle.recommender.leaguePopularity };
  const marketWeights: Record<string, number> = { ...bundle.recommender.marketPopularity };
  let targetOdds = bundle.recommender.avgPreferredOdds || 2.05;
  let userSampleCount = 0;
  let topUserLeague: string | null = null;

  if (uid) {
    const userBets = await db
      .select({
        league: bets.league,
        market: bets.market,
        odds: bets.odds,
        stake: bets.stake,
      })
      .from(bets)
      .where(eq(bets.userId, uid))
      .orderBy(desc(bets.id))
      .limit(35);

    if (userBets.length > 0) {
      userSampleCount = userBets.length;
      const userLeagueCounts: Record<string, number> = {};
      let wOddsSum = 0;
      let wStakeSum = 0;

      for (const ub of userBets) {
        const w = Math.min(5, Math.max(1, Math.log1p(ub.stake)));
        if (ub.league) {
          leagueWeights[ub.league] = (leagueWeights[ub.league] ?? 1) + 6 * w;
          userLeagueCounts[ub.league] = (userLeagueCounts[ub.league] ?? 0) + w;
        }
        marketWeights[ub.market] = (marketWeights[ub.market] ?? 1) + 6 * w;
        wOddsSum += clamp(ub.odds, 1.25, 5.5) * w;
        wStakeSum += w;
      }

      if (wStakeSum > 0) {
        const userAvgOdds = wOddsSum / wStakeSum;
        const alpha = clamp(userBets.length / 10, 0.25, 0.88);
        targetOdds = round2(alpha * userAvgOdds + (1 - alpha) * targetOdds);
      }

      const sortedLeagues = Object.entries(userLeagueCounts).sort((a, b) => b[1] - a[1]);
      if (sortedLeagues.length > 0) {
        topUserLeague = sortedLeagues[0][0];
      }
    }
  }

  const maxLeagueW = Math.max(1, ...Object.values(leagueWeights));
  const maxMarketW = Math.max(1, ...Object.values(marketWeights));

  const candidates: Array<MlRecommendedPick & { rawScore: number }> = [];

  for (const m of openMatches) {
    if (m.status === "live" && (m.suspended || minuteNumber(m.minute) >= 82)) continue;

    const formOpts = {
      homeForm: m.homeForm ?? 1,
      awayForm: m.awayForm ?? 1,
      redHome: m.redHome ?? 0,
      redAway: m.redAway ?? 0,
    };

    const groups =
      m.source === "manual" && m.markets && m.markets.length > 0
        ? m.markets
        : m.status === "live"
          ? buildLiveMarkets(
              m.homeTeam,
              m.awayTeam,
              m.homeScore ?? 0,
              m.awayScore ?? 0,
              minuteNumber(m.minute),
              formOpts
            )
          : buildMarkets(m.homeTeam, m.awayTeam, formOpts);

    // Bonus léger si un des clubs est en dynamique Glicko positive
    const hClub = bundle.glicko.clubs[normClubKey(m.homeTeam)];
    const aClub = bundle.glicko.clubs[normClubKey(m.awayTeam)];
    const formMomentum = Math.max(
      hClub ? Math.abs(hClub.attack - 1) : 0,
      aClub ? Math.abs(aClub.attack - 1) : 0
    );

    const leagueAff = (leagueWeights[m.league] ?? 2) / maxLeagueW;

    for (const grp of groups) {
      if (!RECOMMENDABLE_MARKETS.has(grp.key)) continue;
      const mktAff = (marketWeights[grp.key] ?? 2) / maxMarketW;

      for (const out of grp.outcomes) {
        if (out.odds < 1.38 || out.odds > 4.2) continue;
        // Pour total_ou, privilégie les lignes lisibles 1,5 et 2,5
        if (grp.key === "total_ou" && !out.key.startsWith("ou_1_5") && !out.key.startsWith("ou_2_5")) {
          continue;
        }

        // Adéquation gaussienne au profil de risque préféré du joueur
        const logDist = Math.log(out.odds) - Math.log(targetOdds);
        const oddsFit = Math.exp(-(logDist * logDist) / 0.24);

        const rawScore =
          0.36 * leagueAff +
          0.32 * mktAff +
          0.27 * oddsFit +
          0.05 * Math.min(1, formMomentum * 8) +
          (m.status === "live" ? 0.04 : 0);

        const matchScorePct = Math.round(clamp(68 + rawScore * 29, 74, 97));

        let reason = `${MARKET_SHORT_REASON[grp.key] ?? grp.short} · Cote profilée`;
        if (userSampleCount >= 2 && topUserLeague === m.league) {
          reason = `Affinité ${m.league} · ${MARKET_SHORT_REASON[grp.key] ?? grp.short}`;
        } else if (formMomentum >= 0.04) {
          reason = `Dynamique Glicko IA · ${m.league}`;
        } else if (oddsFit >= 0.88) {
          reason = `Cote cible (${targetOdds.toFixed(2)}) · ${MARKET_SHORT_REASON[grp.key] ?? grp.short}`;
        }

        candidates.push({
          matchId: m.id,
          league: m.league,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          status: m.status,
          minute: m.minute,
          startsAt: m.startsAt.toISOString(),
          market: grp.key,
          marketLabel: grp.label,
          selection: out.key,
          selectionLabel: out.label,
          odds: out.odds,
          matchScorePct,
          reason,
          rawScore,
        });
      }
    }
  }

  candidates.sort((a, b) => b.rawScore - a.rawScore);

  // Sélection diversifiée : 1 seule recommandation par match (top 3)
  const picks: MlRecommendedPick[] = [];
  const usedMatches = new Set<number>();
  for (const c of candidates) {
    if (usedMatches.has(c.matchId)) continue;
    usedMatches.add(c.matchId);
    const { rawScore: _rs, ...cleanPick } = c;
    void _rs;
    picks.push(cleanPick);
    if (picks.length >= 3) break;
  }

  let smartCombo: MlSmartComboSuggestion | null = null;
  if (picks.length >= 2) {
    const comboLegs = picks.slice(0, 2);
    const combinedOdds = round2(comboLegs[0].odds * comboLegs[1].odds);
    smartCombo = {
      title: userSampleCount >= 2 ? "Combiné IA sur-mesure" : "Duo IA haute affinité",
      reason:
        userSampleCount >= 2
          ? `Calibré sur vos ${userSampleCount} derniers paris`
          : "Sélection multi-ligues équilibrée par le modèle",
      legs: comboLegs,
      combinedOdds,
    };
  }

  return {
    personalized: userSampleCount >= 2,
    preferredOdds: targetOdds,
    favoriteLeague: topUserLeague,
    picks,
    smartCombo,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 *  TÉLÉMÉTRIE COMPLÈTE POUR LE PANNEAU `/admin` (« IA & Machine Learning »)
 * ────────────────────────────────────────────────────────────────────────── */

export async function getAdminMlOverview() {
  const bundle = await ensureMlLoaded();

  // Analyse les utilisateurs ayant le plus de paris pour le radar IA Sharp
  const userRows = await db
    .select({
      id: appUser.id,
      name: appUser.name,
      email: appUser.email,
    })
    .from(appUser)
    .limit(50);

  const allRecentBets = await db
    .select({
      userId: bets.userId,
      market: bets.market,
      selection: bets.selection,
      stake: bets.stake,
      odds: bets.odds,
      closingOdds: bets.closingOdds,
      status: bets.status,
      potentialWin: bets.potentialWin,
      cashOutAmount: bets.cashOutAmount,
      riskFlag: bets.riskFlag,
      placedAt: bets.placedAt,
    })
    .from(bets)
    .orderBy(desc(bets.id))
    .limit(600);

  const betsByUser = new Map<number, BetSampleForFeatures[]>();
  for (const b of allRecentBets) {
    const arr = betsByUser.get(b.userId) ?? [];
    if (arr.length < 25) {
      arr.push({
        market: b.market,
        selection: b.selection,
        stake: b.stake,
        odds: b.odds,
        closingOdds: b.closingOdds,
        status: b.status,
        potentialWin: b.potentialWin,
        cashOutAmount: b.cashOutAmount,
        riskFlag: b.riskFlag,
        placedAtMs: b.placedAt ? b.placedAt.getTime() : Date.now(),
      });
      betsByUser.set(b.userId, arr);
    }
  }

  const userNameMap = new Map(userRows.map((u) => [u.id, u]));
  const playerProfiles = [...betsByUser.entries()]
    .map(([uid, hist]) => {
      const feats = extractSharpFeatures(hist);
      const pred = predictSharpProbability(feats, bundle.sharp);
      const pSharp = pred.probability;
      let st = 0;
      let pa = 0;
      for (const h of hist) {
        if (h.status === "pending") continue;
        st += h.stake;
        if (h.status === "won") pa += h.potentialWin;
        else if (h.status === "cashed") pa += h.cashOutAmount ?? 0;
      }
      const roiPct = st > 0 ? round2(((pa - st) / st) * 100) : 0;
      const uInfo = userNameMap.get(uid);
      return {
        userId: uid,
        name: uInfo?.name ?? `Joueur #${uid}`,
        email: uInfo?.email ?? null,
        betsCount: hist.length,
        pSharpPct: round2(pSharp * 100),
        zScore: round2(feats[1] ?? 0),
        roiPct,
        riskWeight: round2(clamp(1.0 + Math.max(0, pSharp - 0.2) * 1.55, 1.0, 2.25)),
        maxStake: Math.round(clamp(500 * (1 - 0.72 * Math.max(0, pSharp - 0.22)), 120, 500)),
        topReason: SHARP_FEATURE_LABELS[pred.topFactorKey],
      };
    })
    .sort((a, b) => b.pSharpPct - a.pSharpPct)
    .slice(0, 12);

  const calibratedSegments = Object.entries(bundle.calibrator.segments)
    .map(([segKey, s]) => {
      const [market, bucket] = segKey.split(":");
      const predWinPct = s.n > 0 ? round2((s.sumPredProb / s.n) * 100) : 0;
      const obsWinPct = s.n > 0 ? round2((s.sumWins / s.n) * 100) : 0;
      return {
        segment: segKey,
        market,
        bucket,
        samples: Math.round(s.n),
        predWinPct,
        obsWinPct,
        staked: round2(s.staked),
        paid: round2(s.paid),
        marginMult: round4(s.marginMult),
      };
    })
    .sort((a, b) => b.marginMult - a.marginMult || b.samples - a.samples)
    .slice(0, 14);

  const clubRatings: Array<{
    clubKey: string;
    attack: number;
    defense: number;
    netPower: number;
    rd: number;
    matches: number;
    goalsFor: number;
    goalsAgainst: number;
    lastDelta: number;
  }> = Object.entries(bundle.glicko.clubs)
    .map(([clubKey, c]: [string, ClubGlickoRating]) => ({
      clubKey,
      attack: round2(c.attack),
      defense: round2(c.defense),
      netPower: round2((c.attack / Math.max(0.5, c.defense)) * 100),
      rd: round2(c.rd),
      matches: c.matches,
      goalsFor: c.goalsFor,
      goalsAgainst: c.goalsAgainst,
      lastDelta: round4(c.lastDelta),
    }))
    .sort((a, b) => b.netPower - a.netPower || b.matches - a.matches)
    .slice(0, 16);

  return {
    models: [
      {
        key: "sharp_detector",
        name: "Détecteur Sharp & Patterns",
        algorithm: "Online Logistic SGD + Z-Score",
        version: bundle.sharpMeta.version,
        samplesCount: bundle.sharpMeta.samplesCount,
        brierScore: bundle.sharp.emaBrier,
        logLoss: bundle.sharp.emaLogLoss,
        updatedAt: bundle.sharpMeta.updatedAt.toISOString(),
      },
      {
        key: "market_calibrator",
        name: "Auto-Calibrateur de Cotes",
        algorithm: "Bandit Bayésien Empirique",
        version: bundle.calibratorMeta.version,
        samplesCount: bundle.calibratorMeta.samplesCount,
        brierScore: bundle.calibrator.emaBrier,
        logLoss: bundle.calibrator.emaLogLoss,
        updatedAt: bundle.calibratorMeta.updatedAt.toISOString(),
      },
      {
        key: "glicko_clubs",
        name: "Forces Dynamiques Clubs",
        algorithm: "Glicko-2 Poisson Att/Déf",
        version: bundle.glickoMeta.version,
        samplesCount: bundle.glickoMeta.samplesCount,
        brierScore: bundle.glicko.emaBrier,
        logLoss: bundle.glicko.emaLogLoss,
        updatedAt: bundle.glickoMeta.updatedAt.toISOString(),
      },
      {
        key: "recommender_meta",
        name: "Recommandation IA Joueurs",
        algorithm: "Embedding Hybride Affinité",
        version: bundle.recommenderMeta.version,
        samplesCount: bundle.recommenderMeta.samplesCount,
        brierScore: 0.185,
        logLoss: 0.54,
        updatedAt: bundle.recommenderMeta.updatedAt.toISOString(),
      },
    ],
    sharpWeights: SHARP_FEATURE_KEYS.map((k, i) => ({
      key: k,
      label: SHARP_FEATURE_LABELS[k],
      weight: round4(bundle.sharp.weights[i] ?? PRIOR_SHARP_WEIGHTS[i]),
      prior: PRIOR_SHARP_WEIGHTS[i],
    })),
    sharpBias: bundle.sharp.bias,
    playerProfiles,
    calibratedSegments,
    clubRatings,
    recommenderSummary: {
      avgPreferredOdds: bundle.recommender.avgPreferredOdds,
      totalAnalysedBets: bundle.recommender.totalAnalysedBets,
      topLeagues: Object.entries(bundle.recommender.leaguePopularity)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([league, weight]) => ({ league, weight })),
    },
  };
}

export type { MatchRow };
