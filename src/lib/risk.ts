/**
 * Couche trading / risk du bookmaker.
 *
 * Toutes les fonctions sont pures (aucune dépendance à la base) pour être
 * testables et réutilisables à la fois côté affichage et côté validation serveur.
 *
 * Les cotes servies et les cotes de validation partagent le même pipeline :
 *   cote_modèle → marge par marché → correction d'exposition → cote finale.
 */

/** Bankroll alloué à un match donné (€) — seuil d'exposition de référence. */
export const MATCH_BANKROLL = 500;
/** Plafond de correction d'exposition (jamais plus de 8-10%). */
export const MAX_EXPOSURE_CORRECTION = 0.09;
/** Pente de la sigmoïde de correction d'exposition. */
const EXPOSURE_STEEPNESS = 3.2;
/** % du bankroll au-delà duquel on commence à resserrer la cote. */
export const EXPOSURE_TRIGGER = 0.12;

/** Marge par type de marché (%, ex. 0.064 = 6,4%). */
export const MARKET_MARGIN: Record<string, number> = {
  // Marché principal 1N2, DNB & Double chance.
  result: 0.072,
  dnb: 0.072,
  double_chance: 0.074,
  handicap_euro: 0.084,
  // Liquidité moyenne & mi-temps.
  btts: 0.078,
  odd_even: 0.078,
  total_ou: 0.078,
  ht_total_ou: 0.08,
  ht_result: 0.082,
  home_total: 0.082,
  away_total: 0.082,
  first_team_to_score: 0.085,
  highest_scoring_half: 0.086,
  goal_range: 0.088,
  result_total: 0.092,
  result_btts: 0.098,
  // Marchés à forte variance / écart / MT-FM / score exact → marge haute.
  winning_margin: 0.125,
  home_to_nil: 0.13,
  away_to_nil: 0.13,
  home_clean_sheet: 0.13,
  away_clean_sheet: 0.13,
  total_exact: 0.14,
  ht_ft: 0.145,
  score_exact: 0.19,
};
/** Marge par défaut quand le marché n'est pas dans la table. */
const DEFAULT_MARGIN = 0.075;

/**
 * Marge en format multiplicateur d'overround (1/(p·m) convention de markets.ts).
 * m = 1 + marge% → marge 4,5% ⇔ m = 1.045.
 */
export function marginOverround(market: string): number {
  return 1 + (MARKET_MARGIN[market] ?? DEFAULT_MARGIN);
}

/** Marge (en %) appliquée à un marché donné, après le calcul des probabilités brutes. */
export function marketMargin(market: string): number {
  return MARKET_MARGIN[market] ?? DEFAULT_MARGIN;
}

/** Limites de mise par profil de joueur. */
export const MAX_STAKE_RECREATIONAL = 500;
export const MAX_STAKE_SHARP = 150;

/** Nombre de paris analysés pour le profil (fenêtre glissante). */
export const PROFILE_WINDOW = 20;
/** Ratio gains/mises au-delà duquel on suspecte un joueur sharp. */
export const SHARP_ROI = 0.05;
/** CLV moyen au-delà duquel on suspecte un joueur sharp (cf. closing line value). */
export const SHARP_CLV = 0.03;
/** Part minimale de paris "value" pour un profil sharp. */
export const SHARP_VALUE_RATE = 0.35;
/** Une cote est considérée "value" si elle bat le modèle neutre d'au moins ce seuil. */
export const VALUE_EDGE = 0.08;

/** Fenêtre (ms) avant un but pour flagger un pari suspicieux (latence admin-clic). */
export const STALE_LATENCY_MS = 90_000;
/** Probabilité modèle au-delà de laquelle une issue est considérée « quasi jouée ». */
export const NEAR_DECIDED_PROB = 0.96;

export type RiskProfile = "recreational" | "sharp";

export interface BetLike {
  market: string;
  selection: string;
  stake: number;
  odds: number;
}

export interface SettledBetLike {
  odds: number;
  stake: number;
  /** Gain encaissé (0 si perdu, sans la mise). */
  payout: number;
  /** Cote de clôture du marché (null si non disponible). */
  closingOdds: number | null;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* 1. Marge asymétrique par marché                                     */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 2. Exposition / liability management                                */
/* ------------------------------------------------------------------ */

/**
 * Exposition nette du bookmaker sur une issue d'un marché.
 *
 *   exposition(issue) = Σ(mise × (cote−1)) sur les paris de cette issue
 *                       − Σ(mise) sur toutes les autres issues du même marché
 *
 * Positive = le bookmaker perd si cette issue gagne (il faut resserrer la cote).
 * Négative = le bookmaker est couvert par les mises des autres issues.
 */
export function netExposure(bets: BetLike[], market: string, outcome: string): number {
  let ownLiab = 0;
  let othersStake = 0;
  for (const b of bets) {
    if (b.market !== market) continue;
    if (b.selection === outcome) {
      ownLiab += b.stake * (b.odds - 1);
    } else {
      othersStake += b.stake;
    }
  }
  return ownLiab - othersStake;
}

/** Exposition normalisée par rapport au bankroll alloué au match. */
export function normalizedExposure(exposure: number, bankroll = MATCH_BANKROLL): number {
  return exposure / bankroll;
}

/**
 * Facteur de correction f(exposition_normalisée) ∈ [0, MAX_EXPOSURE_CORRECTION].
 * Sigmoïde croissante plafonnée : pas de correction en dessous du seuil,
 * croissance rapide ensuite, plafonnement doux à ~9%.
 */
export function exposureCorrection(exposure: number, bankroll = MATCH_BANKROLL): number {
  const norm = normalizedExposure(exposure, bankroll);
  if (norm <= EXPOSURE_TRIGGER) return 0;
  const x = norm - EXPOSURE_TRIGGER;
  const sigmoid = 1 / (1 + Math.exp(-EXPOSURE_STEEPNESS * x));
  return MAX_EXPOSURE_CORRECTION * sigmoid;
}

/**
 * Cote finale après correction d'exposition :
 *   cote_finale = cote_modèle × (1 − f(exposition_normalisée))
 * Uniquement quand l'exposition est positive (on resserre). Sinon on laisse la
 * cote modèle (pas de manipulation pour attirer de la mise sur un côté).
 */
export function adjustOddsForExposure(
  modelOdds: number,
  exposure: number,
  bankroll = MATCH_BANKROLL
): number {
  const corr = exposureCorrection(exposure, bankroll);
  return round2(clamp(modelOdds * (1 - corr), 1.01, modelOdds));
}

/* ------------------------------------------------------------------ */
/* 3. Profil joueur + limites dynamiques                               */
/* ------------------------------------------------------------------ */

/** CLV (Closing Line Value) d'un pari : (cote_pari / cote_clôture) − 1. */
export function clvOf(odds: number, closingOdds: number | null): number | null {
  if (closingOdds == null || closingOdds <= 0) return null;
  return odds / closingOdds - 1;
}

/**
 * Propose un profil de risque simple à partir des derniers paris réglés :
 * - ROI (gains/mises) sur la fenêtre ;
 * - taux de paris "value" : cote significativement au-dessus du modèle neutre
 *   (approximation : cote ≥ cote_clôture × (1+VALUE_EDGE), ou cote ≥ 2 si pas de close).
 */
export function playerRiskProfile(bets: SettledBetLike[]): RiskProfile {
  const window = bets.slice(-PROFILE_WINDOW);
  if (window.length < 5) return "recreational";

  const totalStake = window.reduce((s, b) => s + b.stake, 0);
  const totalPayout = window.reduce((s, b) => s + b.payout, 0);
  const roi = totalStake > 0 ? totalPayout / totalStake : 0;

  let valueBets = 0;
  let withClv = 0;
  for (const b of window) {
    if (b.closingOdds != null) {
      withClv++;
      if (clvOf(b.odds, b.closingOdds)! >= VALUE_EDGE) valueBets++;
    } else if (b.odds >= 2) {
      valueBets++;
    }
  }
  const valueRate = window.length > 0 ? valueBets / window.length : 0;
  // CLV moyen (vrai signal, indépendant du win/loss court terme).
  const clvSamples = window
    .map((b) => clvOf(b.odds, b.closingOdds))
    .filter((v): v is number => v != null);
  const avgClv = clvSamples.length > 0
    ? clvSamples.reduce((s, v) => s + v, 0) / clvSamples.length
    : 0;

  const sharpSignals = (roi > SHARP_ROI ? 1 : 0) + (avgClv > SHARP_CLV ? 1 : 0) + (valueRate > SHARP_VALUE_RATE ? 1 : 0);
  return sharpSignals >= 2 ? "sharp" : "recreational";
}

/** Limite de mise maximale pour un profil donné (sharp réduit, sans bloquer). */
export function maxStakeFor(profile: RiskProfile): number {
  return profile === "sharp" ? MAX_STAKE_SHARP : MAX_STAKE_RECREATIONAL;
}

/* ------------------------------------------------------------------ */
/* 4. Détection de cotes obsolètes (latence admin-clic)                */
/* ------------------------------------------------------------------ */

/**
 * Un pari est « quasi joué » si l'issue a une probabilité modèle quasi certaine
 * au score courant (ex. match 0-0 à la 89', « moins de 2,5 »). Utilisé pour
 * flagger les paris placés juste avant un markGoal manuel (latence admin-clic).
 *
 * @param prob Probabilité modèle (0-1) que l'issue se réalise. Si null, on
 *   retombe sur un détection mathématique simple (issues déjà décidées).
 */
export function isNearDecided(
  market: string,
  outcome: string,
  homeScore: number,
  awayScore: number,
  minute: number,
  prob: number | null = null
): boolean {
  if (prob != null) return prob >= NEAR_DECIDED_PROB;

  // Traitement simple : issues mathématiquement déjà décidées au score courant.
  const total = homeScore + awayScore;
  const diff = homeScore - awayScore;
  const remaining = Math.max(0, 90 - minute);

  switch (market) {
    case "result":
      return (outcome === "home" && diff < -remaining) ||
        (outcome === "away" && diff > remaining) ||
        (outcome === "draw" && Math.abs(diff) > remaining);
    case "double_chance":
      return (outcome === "1X" && diff < -remaining) ||
        (outcome === "X2" && diff > remaining);
    case "btts":
      return (homeScore > 0 && awayScore > 0);
    case "total_ou": {
      const m = /^ou_(\d+)_(\d+)_(over|under)$/.exec(outcome);
      if (!m) return false;
      const line = Number(`${m[1]}.${m[2]}`);
      return total > line;
    }
    case "odd_even":
      return false; // jamais décidé avant la fin
    default:
      return false;
  }
}
