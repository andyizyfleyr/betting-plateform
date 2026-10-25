/**
 * Noyau mathématique pur des 4 modèles de Machine Learning (sans dépendance DB/Node,
 * importable côté serveur comme côté client sans alourdir le bundle).
 *
 * Contient :
 * 1. `sharp_detector`    : Régression logistique en ligne (Online SGD + régularisation L2)
 *                          & extraction de 8 features comportementales dont le Z-score hors chance
 * 2. `market_calibrator` : Bandit contextuel / Calibration bayésienne empirique par (marché, tranche de cote)
 * 3. `glicko_clubs`      : Modèle dynamique bayésien Attaque / Défense / Incertitude (Glicko-2 Poisson)
 * 4. `recommender_meta`  : Embedding d'affinité hybride (collaboratif + contenu + profil de risque)
 */

export const SHARP_FEATURE_KEYS = [
  "clv_ema",
  "skill_zscore",
  "stake_escalation",
  "directional_bias",
  "late_live_share",
  "roi_excess",
  "cadence_burst",
  "whale_ratio",
] as const;

export const SHARP_FEATURE_LABELS: Record<(typeof SHARP_FEATURE_KEYS)[number], string> = {
  clv_ema: "CLV moyen (valeur vs clôture)",
  skill_zscore: "Z-Score de compétence (hors chance)",
  stake_escalation: "Escalade de mise (Martingale / Kelly)",
  directional_bias: "Biais répétitif (faible entropie)",
  late_live_share: "Concentration fin de match",
  roi_excess: "Sur-performance ROI net",
  cadence_burst: "Rafales d'exécution rapide",
  whale_ratio: "Ratio de mise vs récréatif",
};

export interface SharpModelState {
  bias: number;
  weights: number[]; // longueur 8 correspondant à SHARP_FEATURE_KEYS
  learningRate: number;
  l2: number;
  emaBrier: number;
  emaLogLoss: number;
}

export interface MarketSegmentStat {
  n: number;
  sumPredProb: number;
  sumWins: number;
  staked: number;
  paid: number;
  marginMult: number; // ∈ [0.98, 1.18] : > 1 resserre automatiquement la cote du segment
}

export interface MarketCalibratorState {
  segments: Record<string, MarketSegmentStat>;
  emaBrier: number;
  emaLogLoss: number;
}

export interface ClubGlickoRating {
  attack: number; // multiplicateur offensif appris ∈ [0.84, 1.18]
  defense: number; // vulnérabilité défensive apprise ∈ [0.84, 1.18] (< 1 = défense solide)
  rd: number; // incertitude bayésienne ∈ [0.04, 0.18]
  sigma: number; // volatilité de forme ∈ [0.02, 0.08]
  matches: number;
  goalsFor: number;
  goalsAgainst: number;
  lastDelta: number;
}

export interface GlickoClubsState {
  clubs: Record<string, ClubGlickoRating>;
  emaBrier: number;
  emaLogLoss: number;
}

export interface RecommenderMetaState {
  leaguePopularity: Record<string, number>;
  marketPopularity: Record<string, number>;
  avgPreferredOdds: number;
  totalAnalysedBets: number;
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, v));
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

export function normClubKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function sigmoid(z: number): number {
  const zClamped = clamp(z, -18, 18);
  return 1 / (1 + Math.exp(-zClamped));
}

/* ──────────────────────────────────────────────────────────────────────────
 *  1. MODÈLE 1 : Détecteur IA « Sharp / Exploiteur » (Online Logistic SGD)
 * ────────────────────────────────────────────────────────────────────────── */

/** Priors informés servant à la fois d'initialisation à chaud et d'ancre L2 bayésienne. */
export const PRIOR_SHARP_WEIGHTS = [0.95, 1.15, 0.88, 0.82, 0.54, 0.92, 0.48, 0.62];
export const PRIOR_SHARP_BIAS = -1.65;

export function defaultSharpModelState(): SharpModelState {
  return {
    bias: PRIOR_SHARP_BIAS,
    weights: [...PRIOR_SHARP_WEIGHTS],
    learningRate: 0.045,
    l2: 0.03,
    emaBrier: 0.168,
    emaLogLoss: 0.495,
  };
}

export interface BetSampleForFeatures {
  market: string;
  selection: string;
  stake: number;
  odds: number;
  closingOdds?: number | null;
  status: string;
  potentialWin: number;
  cashOutAmount?: number | null;
  riskFlag?: string | null;
  placedAtMs: number;
}

/**
 * Extrait un vecteur normalisé de 8 features continues `x ∈ [-2.5, +3.5]^8`
 * à partir de l'historique d'un parieur (ordonné du plus récent au plus ancien).
 */
export function extractSharpFeatures(history: BetSampleForFeatures[]): number[] {
  if (history.length === 0) {
    return [0, 0, 0, 0, 0, 0, 0, 0];
  }

  let clvWeighted = 0;
  let clvCount = 0;
  let actualMinusExpectedWins = 0;
  let binomialVariance = 0;
  let totalStake = 0;
  let settledStake = 0;
  let settledPayout = 0;
  let lateFlagStake = 0;
  let postLossEscalations = 0;
  let postLossOpportunities = 0;
  let rapidBursts = 0;

  const bucketStakes: Record<string, number> = {
    home: 0,
    away: 0,
    draw: 0,
    over: 0,
    under: 0,
    other: 0,
  };

  // Parcours du plus ancien au plus récent pour calculer EMA CLV et escalades post-perte
  const chrono = [...history].reverse();

  for (let i = 0; i < chrono.length; i++) {
    const b = chrono[i];
    const stake = Math.max(0.5, b.stake);
    const odds = Math.max(1.01, b.odds);
    totalStake += stake;

    if (b.closingOdds && b.closingOdds > 1.01) {
      const clv = odds / b.closingOdds - 1;
      clvWeighted = clvCount === 0 ? clv : 0.72 * clvWeighted + 0.28 * clv;
      clvCount++;
    }

    if (b.riskFlag === "stale_near_decided" || odds <= 1.25) {
      lateFlagStake += stake;
    }

    // Classification directionnelle pour l'entropie de Shannon
    if (
      (b.market === "result" && b.selection === "home") ||
      (b.market === "double_chance" && b.selection === "1X") ||
      (b.market === "result_total" && b.selection === "home_over") ||
      b.market === "home_to_nil"
    ) {
      bucketStakes.home += stake;
    } else if (
      (b.market === "result" && b.selection === "away") ||
      (b.market === "double_chance" && b.selection === "X2") ||
      (b.market === "result_total" && b.selection === "away_over") ||
      b.market === "away_to_nil"
    ) {
      bucketStakes.away += stake;
    } else if (b.market === "result" && b.selection === "draw") {
      bucketStakes.draw += stake;
    } else if (b.selection.endsWith("_over") || (b.market === "btts" && b.selection === "oui")) {
      bucketStakes.over += stake;
    } else if (
      b.selection.endsWith("_under") ||
      b.selection === "under" ||
      (b.market === "btts" && b.selection === "non")
    ) {
      bucketStakes.under += stake;
    } else {
      bucketStakes.other += stake;
    }

    if (i > 0) {
      const prev = chrono[i - 1];
      if (prev.status === "lost") {
        postLossOpportunities++;
        const ratio = stake / Math.max(0.5, prev.stake);
        if (ratio >= 1.55) {
          postLossEscalations += Math.min(2.5, ratio - 1);
        }
      }
      const dtSec = Math.abs(b.placedAtMs - prev.placedAtMs) / 1000;
      if (dtSec > 0 && dtSec < 14) {
        rapidBursts++;
      }
    }

    if (b.status !== "pending") {
      settledStake += stake;
      const pTrue = clamp(0.93 / odds, 0.015, 0.96);
      const won = b.status === "won" ? 1 : b.status === "cashed" ? 0.55 : 0;
      actualMinusExpectedWins += won - pTrue;
      binomialVariance += pTrue * (1 - pTrue);

      if (b.status === "won") settledPayout += b.potentialWin;
      else if (b.status === "cashed") settledPayout += b.cashOutAmount ?? 0;
    }
  }

  // f0 : CLV normalisé (~ +0.06 CLV → +1.2)
  const f0Clv = clamp(clvWeighted * 18, -1.5, 3.0);

  // f1 : Z-score de compétence ajusté de la chance (sépare un coup de chance d'une série statistique)
  const f1ZScore = clamp(
    actualMinusExpectedWins / Math.sqrt(binomialVariance + 1.25),
    -2.0,
    3.5
  );

  // f2 : Escalade après perte (Martingale / récupération agressive)
  const f2Escalation =
    postLossOpportunities > 0
      ? clamp((postLossEscalations / postLossOpportunities) * 1.35, 0, 3.0)
      : 0;

  // f3 : Concentration directionnelle = 1 − entropie de Shannon normalisée (amortie à faible échantillon)
  let shannonH = 0;
  const activeBuckets = Object.values(bucketStakes).filter((v) => v > 0);
  if (totalStake > 0 && activeBuckets.length > 1) {
    for (const v of activeBuckets) {
      const p = v / totalStake;
      shannonH -= p * Math.log(p);
    }
  }
  const maxEntropy = Math.log(5);
  const rawConcentration = 1 - clamp(shannonH / maxEntropy, 0, 1);
  const sampleConfidence = clamp((history.length - 3) / 10, 0, 1);
  const f3Directional = clamp((rawConcentration - 0.32) * 2.4 * sampleConfidence, 0, 2.8);

  // f4 : Part de mises tardives / très basses cotes
  const f4LateLive = totalStake > 0 ? clamp((lateFlagStake / totalStake) * 2.2, 0, 2.5) : 0;

  // f5 : Excès de ROI réalisé par rapport à l'espérance théorique (-7 %)
  const realizedRoi = settledStake >= 10 ? (settledPayout - settledStake) / settledStake : -0.07;
  const f5RoiExcess = clamp((realizedRoi + 0.07) * 2.2 * sampleConfidence, -1.2, 3.0);

  // f6 : Rafales d'exécution rapide
  const f6Burst = history.length >= 4 ? clamp((rapidBursts / (history.length - 1)) * 2.4, 0, 2.4) : 0;

  // f7 : Intensité de mise moyenne vs joueur récréatif (30 €)
  const avgStake = totalStake / history.length;
  const f7Whale = clamp(Math.log1p(avgStake / 30) * 1.15 - 0.35, -0.3, 2.8);

  return [
    round4(f0Clv),
    round4(f1ZScore),
    round4(f2Escalation),
    round4(f3Directional),
    round4(f4LateLive),
    round4(f5RoiExcess),
    round4(f6Burst),
    round4(f7Whale),
  ];
}

export function predictSharpProbability(
  features: number[],
  model: SharpModelState
): { probability: number; topFactorKey: (typeof SHARP_FEATURE_KEYS)[number]; contributions: number[] } {
  let z = model.bias;
  const contributions: number[] = [];
  let bestIdx = 0;
  let bestVal = -Infinity;

  for (let i = 0; i < SHARP_FEATURE_KEYS.length; i++) {
    const w = model.weights[i] ?? PRIOR_SHARP_WEIGHTS[i] ?? 0.5;
    const x = features[i] ?? 0;
    const c = w * x;
    contributions.push(round4(c));
    z += c;
    if (c > bestVal) {
      bestVal = c;
      bestIdx = i;
    }
  }

  return {
    probability: round4(sigmoid(z)),
    topFactorKey: SHARP_FEATURE_KEYS[bestIdx],
    contributions,
  };
}

/**
 * Un pas de Descente de Gradient Stochastique en ligne (Online SGD) avec
 * régularisation L2 vers les priors bayésiens pour garantir la stabilité numérique.
 */
export function onlineSgdStepSharp(
  model: SharpModelState,
  features: number[],
  targetY: number
): SharpModelState {
  const y = clamp(targetY, 0, 1);
  const { probability: pHat } = predictSharpProbability(features, model);
  const err = pHat - y;
  const lr = clamp(model.learningRate || 0.045, 0.008, 0.12);
  const l2 = clamp(model.l2 || 0.03, 0.005, 0.15);

  const nextWeights = model.weights.map((w, i) => {
    const prior = PRIOR_SHARP_WEIGHTS[i] ?? 0.5;
    const grad = err * (features[i] ?? 0) + l2 * (w - prior);
    return round4(clamp(w - lr * grad, 0.05, 2.8));
  });

  const biasGrad = err + l2 * (model.bias - PRIOR_SHARP_BIAS);
  const nextBias = round4(clamp(model.bias - lr * biasGrad, -3.2, -0.4));

  const pSafe = clamp(pHat, 1e-4, 1 - 1e-4);
  const sqErr = (pHat - y) * (pHat - y);
  const logLoss = -(y * Math.log(pSafe) + (1 - y) * Math.log(1 - pSafe));

  return {
    ...model,
    bias: nextBias,
    weights: nextWeights,
    emaBrier: round4(0.94 * (model.emaBrier || 0.17) + 0.06 * sqErr),
    emaLogLoss: round4(0.94 * (model.emaLogLoss || 0.5) + 0.06 * logLoss),
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 *  2. MODÈLE 2 : Auto-Calibration Bayésienne des Marchés (`market_calibrator`)
 * ────────────────────────────────────────────────────────────────────────── */

export function oddsBucketOf(odds: number): "fav" | "mid" | "dog" {
  if (odds < 1.75) return "fav";
  if (odds <= 2.85) return "mid";
  return "dog";
}

export function segmentKeyOf(market: string, odds: number): string {
  return `${market}:${oddsBucketOf(odds)}`;
}

export function defaultMarketCalibratorState(): MarketCalibratorState {
  return {
    segments: {},
    emaBrier: 0.192,
    emaLogLoss: 0.562,
  };
}

/**
 * Rétrécissement bayésien empirique (Beta-Binomial Shrinkage, force du prior = 24) :
 * Si un segment `(marché, tranche de cote)` gagne plus souvent que la probabilité
 * prédite ou dépasse le ratio de payout cible (93 %), calcule automatiquement un
 * multiplicateur correctif de marge ∈ [0.99, 1.16].
 */
export function computeSegmentMarginMultiplier(stat: MarketSegmentStat): number {
  if (stat.n < 4 || stat.sumPredProb <= 0) return 1.0;

  const meanPred = clamp(stat.sumPredProb / stat.n, 0.02, 0.95);
  const priorStrength = 24;
  const posteriorWinRate =
    (stat.sumWins + priorStrength * meanPred) / (stat.n + priorStrength);

  const calibrationDrift = posteriorWinRate / meanPred; // > 1 = le marché paie trop souvent
  const payoutRatio = (stat.paid + 25 * 0.92) / (stat.staked + 25); // cible ~0.92
  const payoutDrift = payoutRatio / 0.925;

  const combinedSignal = 0.55 * calibrationDrift + 0.45 * payoutDrift;
  if (combinedSignal <= 1.005) {
    return 1.0;
  }
  return round4(clamp(1 + (combinedSignal - 1) * 0.65, 1.0, 1.16));
}

/* ──────────────────────────────────────────────────────────────────────────
 *  3. MODÈLE 3 : Forces Dynamiques Bayésiennes des Clubs (`glicko_clubs`)
 * ────────────────────────────────────────────────────────────────────────── */

export function defaultClubRating(): ClubGlickoRating {
  return {
    attack: 1.0,
    defense: 1.0,
    rd: 0.14,
    sigma: 0.045,
    matches: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    lastDelta: 0,
  };
}

export function defaultGlickoClubsState(): GlickoClubsState {
  return {
    clubs: {},
    emaBrier: 0.204,
    emaLogLoss: 0.588,
  };
}

/**
 * Mise à jour bayésienne Poisson-Glicko après un match terminé :
 * Compare les buts marqués aux buts attendus `λ_attendu` et ajuste simultanément
 * l'attaque, la solidité défensive et l'incertitude `rd` des deux clubs, avec un
 * rappel doux vers 1.00 pour simuler des cycles de forme réalistes sans divergence.
 */
export function updateGlickoPairFromMatch(
  homePrev: ClubGlickoRating | undefined,
  awayPrev: ClubGlickoRating | undefined,
  homeGoals: number,
  awayGoals: number,
  baseLambdaHome: number,
  baseLambdaAway: number
): { homeNext: ClubGlickoRating; awayNext: ClubGlickoRating; brierSample: number; logLossSample: number } {
  const h = homePrev ? { ...homePrev } : defaultClubRating();
  const a = awayPrev ? { ...awayPrev } : defaultClubRating();

  // Légère inflation temporelle de l'incertitude (volatilité Glicko-2 `sigma`)
  const rdH = clamp(Math.sqrt(h.rd * h.rd + h.sigma * h.sigma), 0.045, 0.18);
  const rdA = clamp(Math.sqrt(a.rd * a.rd + a.sigma * a.sigma), 0.045, 0.18);

  const safeLamH = Number.isFinite(baseLambdaHome) ? baseLambdaHome : 1.35;
  const safeLamA = Number.isFinite(baseLambdaAway) ? baseLambdaAway : 1.15;
  const expH = clamp(safeLamH * h.attack * a.defense, 0.35, 3.6);
  const expA = clamp(safeLamA * a.attack * h.defense, 0.3, 3.4);

  // Surprise normalisée de Pearson : (observé − attendu) / sqrt(attendu + 1)
  const surpriseH = clamp((homeGoals - expH) / Math.sqrt(expH + 1.0), -2.2, 2.2);
  const surpriseA = clamp((awayGoals - expA) / Math.sqrt(expA + 1.0), -2.2, 2.2);

  const kH = clamp(rdH * 0.16, 0.01, 0.03);
  const kA = clamp(rdA * 0.16, 0.01, 0.03);

  const decay = 0.985; // retour progressif à la moyenne long-terme du club
  const nextHomeAttack = round4(clamp(1 + (h.attack - 1) * decay + kH * surpriseH, 0.85, 1.17));
  const nextHomeDefense = round4(clamp(1 + (h.defense - 1) * decay + kH * surpriseA * 0.85, 0.85, 1.17));

  const nextAwayAttack = round4(clamp(1 + (a.attack - 1) * decay + kA * surpriseA, 0.85, 1.17));
  const nextAwayDefense = round4(clamp(1 + (a.defense - 1) * decay + kA * surpriseH * 0.85, 0.85, 1.17));

  // Réduction bayésienne de l'incertitude après observation d'un match
  const nextRdH = round4(clamp(1 / Math.sqrt(1 / (rdH * rdH) + 8.5), 0.045, 0.18));
  const nextRdA = round4(clamp(1 / Math.sqrt(1 / (rdA * rdA) + 8.5), 0.045, 0.18));

  // Mesure de précision prédictive (probabilité implicite issue de expH vs expA)
  const pHomeApprox = clamp((expH + 0.35) / (expH + expA + 0.95), 0.1, 0.9);
  const actualOutcome = homeGoals > awayGoals ? 1 : homeGoals === awayGoals ? 0.5 : 0;
  const brierSample = (pHomeApprox - actualOutcome) * (pHomeApprox - actualOutcome);
  const logLossSample = -(
    actualOutcome * Math.log(pHomeApprox) +
    (1 - actualOutcome) * Math.log(1 - pHomeApprox)
  );

  const homeStrengthNet = nextHomeAttack / nextHomeDefense - h.attack / h.defense;
  const awayStrengthNet = nextAwayAttack / nextAwayDefense - a.attack / a.defense;

  return {
    homeNext: {
      attack: nextHomeAttack,
      defense: nextHomeDefense,
      rd: nextRdH,
      sigma: h.sigma,
      matches: h.matches + 1,
      goalsFor: h.goalsFor + homeGoals,
      goalsAgainst: h.goalsAgainst + awayGoals,
      lastDelta: round4(homeStrengthNet),
    },
    awayNext: {
      attack: nextAwayAttack,
      defense: nextAwayDefense,
      rd: nextRdA,
      sigma: a.sigma,
      matches: a.matches + 1,
      goalsFor: a.goalsFor + awayGoals,
      goalsAgainst: a.goalsAgainst + homeGoals,
      lastDelta: round4(awayStrengthNet),
    },
    brierSample: round4(brierSample),
    logLossSample: round4(logLossSample),
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 *  4. CACHE MÉMOIRE PARTAGÉ POUR L'INFÉRENCE TEMPS RÉEL (< 0.1 ms)
 * ────────────────────────────────────────────────────────────────────────── */

let runtimeCalibratorCache: Record<string, MarketSegmentStat> = {};
let runtimeGlickoCache: Record<string, ClubGlickoRating> = {};

export function hydrateMlRuntimeCaches(params: {
  calibrator?: MarketCalibratorState | null;
  glicko?: GlickoClubsState | null;
}) {
  if (params.calibrator?.segments) {
    runtimeCalibratorCache = params.calibrator.segments;
  }
  if (params.glicko?.clubs) {
    runtimeGlickoCache = params.glicko.clubs;
  }
}

export function getCachedMarketCalibratorMultiplier(market: string, approxOdds = 2.0): number {
  const seg = runtimeCalibratorCache[segmentKeyOf(market, approxOdds)];
  if (!seg) return 1.0;
  return clamp(seg.marginMult || 1.0, 0.99, 1.16);
}

export function getCachedClubGlickoModifiers(
  homeTeam: string,
  awayTeam: string
): { homeGoalMod: number; awayGoalMod: number } {
  const h = runtimeGlickoCache[normClubKey(homeTeam)];
  const a = runtimeGlickoCache[normClubKey(awayTeam)];
  if (!h && !a) return { homeGoalMod: 1.0, awayGoalMod: 1.0 };

  const hAtk = h?.attack ?? 1.0;
  const hDef = h?.defense ?? 1.0;
  const aAtk = a?.attack ?? 1.0;
  const aDef = a?.defense ?? 1.0;

  return {
    homeGoalMod: clamp(hAtk * aDef, 0.82, 1.22),
    awayGoalMod: clamp(aAtk * hDef, 0.82, 1.22),
  };
}
