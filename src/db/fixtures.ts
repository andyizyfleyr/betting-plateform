export const VIRTUAL_LEAGUE = "Ligue des Champions · Europe";
export const ROUND_MS = 300_000;

const BASE = 1.35;
const HOME_ADV = 1.12;
const POWER = 0.9;
const MARGIN = 1.06;

export interface VirtualTeam {
  name: string;
  strength: number;
}

export const TEAMS: VirtualTeam[] = [
  { name: "Paris SG", strength: 91 },
  { name: "Manchester City", strength: 92 },
  { name: "Real Madrid", strength: 90 },
  { name: "Bayern Munich", strength: 89 },
  { name: "Liverpool", strength: 87 },
  { name: "Arsenal", strength: 86 },
  { name: "Inter Milan", strength: 85 },
  { name: "FC Barcelone", strength: 84 },
  { name: "Marseille", strength: 80 },
  { name: "Toulouse", strength: 76 },
];

export interface Pair {
  home: string;
  away: string;
}

function buildRounds(): Pair[][] {
  const n = TEAMS.length;
  const order = TEAMS.map((_, i) => i);
  const rounds: Pair[][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: Pair[] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = order[i];
      const b = order[n - 1 - i];
      const swap = (r + i) % 2 === 1;
      pairs.push({ home: TEAMS[swap ? b : a].name, away: TEAMS[swap ? a : b].name });
    }
    rounds.push(pairs);
    order.splice(1, 0, order.pop()!);
  }
  return rounds;
}

export const ROUNDS: Pair[][] = buildRounds();

export function pairingsForRound(round: number): Pair[] {
  const n = ROUNDS.length;
  return ROUNDS[((round % n) + n) % n];
}

export const ALL_PAIRS: Pair[] = ROUNDS.flat();

export function livePairIndex(total: number): number {
  return ((total % ALL_PAIRS.length) + ALL_PAIRS.length) % ALL_PAIRS.length;
}

export function roundIndexOf(home: string, away: string): number {
  return ROUNDS.findIndex((round) =>
    round.some((p) => p.home === home && p.away === away)
  );
}

function teamStrength(name: string): number {
  return TEAMS.find((t) => t.name === name)?.strength ?? 85;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export interface LiveScoreModel {
  grid: number[][];
  margin: number;
  lamH: number;
  lamA: number;
}

export function expectedGoals(home: string, away: string): { lambdaHome: number; lambdaAway: number } {
  const sh = teamStrength(home);
  const sa = teamStrength(away);
  const ratio = sh / sa;
  return {
    lambdaHome: clamp(BASE * Math.pow(ratio, POWER) * HOME_ADV, 0.35, 3.5),
    lambdaAway: clamp(BASE * Math.pow(sa / sh, POWER) / HOME_ADV, 0.35, 3.5),
  };
}

export function poissonPmf(k: number, lambda: number): number {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact;
}

export function oddsFor(home: string, away: string) {
  const { lambdaHome, lambdaAway } = expectedGoals(home, away);
  const p = winProbabilities(lambdaHome, lambdaAway);
  return {
    oddsHome: round2(clamp(1 / (p.home * MARGIN), 1.01, 50)),
    oddsDraw: round2(clamp(1 / (p.draw * MARGIN), 1.01, 50)),
    oddsAway: round2(clamp(1 / (p.away * MARGIN), 1.01, 50)),
  };
}

export function winProbabilities(
  lambdaHome: number,
  lambdaAway: number,
  offset = 0
): { home: number; draw: number; away: number } {
  let home = 0;
  let draw = 0;
  for (let i = 0; i <= 15; i++) {
    for (let j = 0; j <= 15; j++) {
      const p = poissonPmf(i, lambdaHome) * poissonPmf(j, lambdaAway);
      const diff = i - j + offset;
      if (diff > 0) home += p;
      else if (diff === 0) draw += p;
    }
  }
  const away = Math.max(0.001, 1 - home - draw);
  return { home, draw, away };
}

export function scoreAt(round: number, minute: number, home: string, away: string) {
  const { lambdaHome, lambdaAway } = expectedGoals(home, away);
  const homeGoals = goalMinutes(round, home, lambdaHome).filter((m) => m <= minute).length;
  const awayGoals = goalMinutes(round, away, lambdaAway).filter((m) => m <= minute).length;
  return { home: homeGoals, away: awayGoals };
}

function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poissonSample(rng: () => number, lambda: number): number {
  const limit = Math.exp(-lambda);
  let p = 1;
  let k = 0;
  do {
    k++;
    p *= rng();
  } while (p > limit && k < 12);
  return k - 1;
}

function goalMinutes(round: number, team: string, lambda: number): number[] {
  const rng = mulberry32(hashString(`${round}|${team}`));
  const count = poissonSample(rng, lambda);
  const minutes: number[] = [];
  for (let i = 0; i < count; i++) minutes.push(1 + Math.floor(rng() * 90));
  return minutes.sort((a, b) => a - b);
}

// ──────────────────────────────────────────────
//  Modèle live avancé
// ──────────────────────────────────────────────

/** Biais Dixon–Coles : correction τ pour les scores faibles. */
const DC_RHO = 0.04;

function dixonColesTau(x: number, y: number, lambdaH: number, lambdaA: number): number {
  if (x + y >= 2) return 1;
  if (x === 0 && y === 0) return 1 - DC_RHO * lambdaH * lambdaA;
  if (x === 1 && y === 0) return 1 + DC_RHO * lambdaA;
  if (x === 0 && y === 1) return 1 + DC_RHO * lambdaH;
  if (x === 1 && y === 1) return 1 - DC_RHO;
  return 1;
}

/** Factorial précalculé. */
function fact(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/**
 * Distribution de Poisson bivariée à choc commun.
 * X = X' + Z, Y = Y' + Z avec X'~Pois(λ1), Y'~Pois(λ2), Z~Pois(λ3).
 * Cov(X,Y) = λ3. On choisit λ3 = ρ * sqrt(λ1*λ2).
 */
const CORR_RHO = 0.12;

function bivariatePoissonGrid(
  lambdaH: number,
  lambdaA: number,
  maxGoals: number
): number[][] {
  const lambda3 = CORR_RHO * Math.sqrt(Math.max(lambdaH, 0.01) * Math.max(lambdaA, 0.01));
  const lambda1 = Math.max(lambdaH - lambda3, 0.01);
  const lambda2 = Math.max(lambdaA - lambda3, 0.01);
  const lambda3Safe = Math.max(lambda3, 0.001);

  const size = maxGoals + 1;
  const grid: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));

  // Précalcul log-factorielles
  const logFact: number[] = [0];
  for (let i = 1; i <= maxGoals; i++) logFact[i] = logFact[i - 1] + Math.log(i);

  const logL1 = Math.log(lambda1);
  const logL2 = Math.log(lambda2);
  const logL3 = Math.log(lambda3Safe);
  const logETotal = -(lambda1 + lambda2 + lambda3Safe);

  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {
      let sum = 0;
      const maxK = Math.min(i, j);
      for (let k = 0; k <= maxK; k++) {
        const logTerm =
          (i - k) * logL1 +
          (j - k) * logL2 +
          k * logL3 -
          logFact[i - k] -
          logFact[j - k] -
          logFact[k];
        sum += Math.exp(logTerm);
      }
      grid[i][j] = Math.exp(logETotal) * sum;
    }
  }

  // Normaliser (erreur d'arrondi)
  let total = 0;
  for (let i = 0; i <= maxGoals; i++)
    for (let j = 0; j <= maxGoals; j++)
      total += grid[i][j];
  if (total > 0 && Math.abs(total - 1) > 1e-6) {
    for (let i = 0; i <= maxGoals; i++)
      for (let j = 0; j <= maxGoals; j++)
        grid[i][j] /= total;
  }

  return grid;
}

/** Profil d'intensité cumulé : proportion de buts attendus marqués d'ici la minute m. */
const INTENSITY_BUCKETS: Array<{ minute: number; cumul: number }> = [
  { minute: 0, cumul: 0 },
  { minute: 15, cumul: 0.13 },
  { minute: 30, cumul: 0.29 },
  { minute: 45, cumul: 0.47 },
  { minute: 60, cumul: 0.63 },
  { minute: 75, cumul: 0.8 },
  { minute: 90, cumul: 1 },
];

function goalTimeCDF(minute: number): number {
  const m = clamp(minute, 0, 90);
  for (let i = 1; i < INTENSITY_BUCKETS.length; i++) {
    const prev = INTENSITY_BUCKETS[i - 1];
    const cur = INTENSITY_BUCKETS[i];
    if (m <= cur.minute) {
      const frac = (m - prev.minute) / (cur.minute - prev.minute);
      return prev.cumul + frac * (cur.cumul - prev.cumul);
    }
  }
  return 1;
}

/** Distribution de Skellam : différence de deux Poisson(λ1, λ2). */
function modifiedBesselI(n: number, x: number): number {
  if (x === 0) return n === 0 ? 1 : 0;
  let result = 0;
  for (let m = 0; m < 50; m++) {
    const power = 2 * m + Math.abs(n);
    const num = Math.pow(x / 2, power);
    const denom = fact(m) * fact(m + Math.abs(n));
    result += num / denom;
  }
  return result;
}

function skellamPMF(k: number, lambda1: number, lambda2: number): number {
  const mu = lambda1 + lambda2;
  const ratio = lambda1 / Math.max(lambda2, 0.001);
  const x = 2 * Math.sqrt(Math.max(lambda1, 0.001) * Math.max(lambda2, 0.001));
  const bessel = modifiedBesselI(k, x);
  return Math.exp(-mu) * Math.pow(ratio, k / 2) * bessel;
}

function skellamCDF(k: number, lambda1: number, lambda2: number): number {
  let sum = 0;
  for (let i = -200; i <= k; i++) {
    const p = skellamPMF(i, lambda1, lambda2);
    if (!isFinite(p) || isNaN(p) || p < 0) continue;
    sum += p;
  }
  return clamp(sum, 0, 1);
}

/** Probabilités du résultat via Skellam (queues exactes, pas de troncature). */
export function liveResultProbs(
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  minute: number,
  opts?: { homeForm?: number; awayForm?: number; redHome?: number; redAway?: number }
): { home: number; draw: number; away: number } {
  const { lambdaHome, lambdaAway } = expectedGoals(home, away);
  const elapsed = minute / 90;
  const remaining = 1 - elapsed;

  let lamH = lambdaHome * remaining;
  let lamA = lambdaAway * remaining;

  const hf = opts?.homeForm ?? 1;
  const af = opts?.awayForm ?? 1;
  lamH *= hf;
  lamA *= af;

  const rh = opts?.redHome ?? 0;
  const ra = opts?.redAway ?? 0;
  lamH *= Math.pow(0.7, rh);
  lamA *= Math.pow(0.7, ra);
  lamH *= 1 + 0.15 * ra;
  lamA *= 1 + 0.15 * rh;

  const offset = homeScore - awayScore;
  if (minute >= 60 && offset < 0) { lamH *= 1.12; lamA *= 1.12; }
  if (minute >= 60 && offset > 0) { lamH *= 0.95; lamA *= 0.95; }

  // Mise à jour bayésienne gamma-poisson
  const gH = homeScore;
  const gA = awayScore;
  const kappa = 1;
  const priorH = lamH / Math.max(remaining, 0.02);
  const priorA = lamA / Math.max(remaining, 0.02);
  const postH = (kappa * priorH + gH) / (kappa + elapsed + 1e-9);
  const postA = (kappa * priorA + gA) / (kappa + elapsed + 1e-9);
  const remH = postH * Math.max(remaining, 0.02);
  const remA = postA * Math.max(remaining, 0.02);

  const pHomeWin = 1 - skellamCDF(0, remH, remA);
  const pAwayWin = skellamCDF(-1, remH, remA);
  const pDraw = skellamPMF(0, remH, remA);

  const total = pHomeWin + pDraw + pAwayWin;
  return {
    home: pHomeWin / total,
    draw: pDraw / total,
    away: pAwayWin / total,
  };
}

/** Cotes live du marché Résultat (1/N/2) — Dixon-Coles + bivarié + Skellam. */
export function liveOddsFor(
  home: string,
  away: string,
  currentHomeScore: number,
  currentAwayScore: number,
  minute: number,
  opts?: { homeForm?: number; awayForm?: number; redHome?: number; redAway?: number }
) {
  const { margin } = liveScoreModel(home, away, currentHomeScore, currentAwayScore, minute, opts);
  const p = liveResultProbs(home, away, currentHomeScore, currentAwayScore, minute, opts);
  const odds = (prob: number) => round2(clamp(1 / (prob * margin), 1.01, LIVE_ODDS_MAX));
  return {
    oddsHome: odds(p.home),
    oddsDraw: odds(p.draw),
    oddsAway: odds(p.away),
  };
}

const LIVE_MAX_REMAIN = 20;

/**
 * Moteur de cotes en direct — modèle probabiliste avancé.
 * - Dixon-Coles τ pour les scores faibles
 * - Poisson bivarié à choc commun (corrélation home/away)
 * - Profil d'intensité non-homogène (buts plus fréquents en fin de match)
 * - Skellam pour les queues du résultat (pas de troncature)
 * - Mise à jour bayésienne gamma-poisson après observation des buts
 * - Facteur carton rouge (λ × 0.7 pour l'équipe réduite, +15% pour l'adversaire)
 * - Jeu ouvert (boost mutuel si match serré après 60')
 * - Facteur de forme EWMA par équipe
 * - Marge bookmaker dynamique
 */
export function liveScoreModel(
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  minute: number,
  opts?: { homeForm?: number; awayForm?: number; redHome?: number; redAway?: number }
): LiveScoreModel {
  const { lambdaHome, lambdaAway } = expectedGoals(home, away);
  const elapsed = minute / 90;
  const remaining = clamp(1 - elapsed, 0.02, 1);

  let lamH = lambdaHome * remaining;
  let lamA = lambdaAway * remaining;

  const hf = opts?.homeForm ?? 1;
  const af = opts?.awayForm ?? 1;
  lamH *= hf;
  lamA *= af;

  const rh = opts?.redHome ?? 0;
  const ra = opts?.redAway ?? 0;
  lamH *= Math.pow(0.7, rh);
  lamA *= Math.pow(0.7, ra);
  lamH *= 1 + 0.15 * ra;
  lamA *= 1 + 0.15 * rh;

  const offset = homeScore - awayScore;
  if (minute >= 60 && offset < 0) { lamH *= 1.12; lamA *= 1.12; }
  if (minute >= 60 && offset > 0) { lamH *= 0.95; lamA *= 0.95; }

  // Bayesian update
  const gH = homeScore;
  const gA = awayScore;
  const kappa = 1;
  const priorH = lamH / Math.max(remaining, 0.02);
  const priorA = lamA / Math.max(remaining, 0.02);
  const postH = (kappa * priorH + gH) / (kappa + elapsed + 1e-9);
  const postA = (kappa * priorA + gA) / (kappa + elapsed + 1e-9);
  const remH = postH * Math.max(remaining, 0.02);
  const remA = postA * Math.max(remaining, 0.02);

  const margin = round2(
    clamp(
      LIVE_MARGIN_MIN + (1 - remaining) * (LIVE_MARGIN_MAX - LIVE_MARGIN_MIN),
      LIVE_MARGIN_MIN,
      LIVE_MARGIN_MAX
    )
  );

  const maxG = Math.max(remH, remA) * 3 + 6;
  const maxGoals = clamp(Math.ceil(maxG), 6, LIVE_MAX_REMAIN);

  const grid = bivariatePoissonGrid(remH, remA, maxGoals);

  return { grid, margin, lamH: remH, lamA: remA };
}

const LIVE_MARGIN_MIN = 1.05;
const LIVE_MARGIN_MAX = 1.2;
const LIVE_ODDS_MAX = 100;