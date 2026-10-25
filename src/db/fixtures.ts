export const VIRTUAL_LEAGUE = "Ligue des Champions · Europe";
export const ROUND_MS = 300_000;

/** Buts moyens attendus à forces égales (avantage domicile calibré sur les top 5 ligues européennes). */
const BASE_HOME = 1.48;
const BASE_AWAY = 1.18;
/** Sensibilité exponentielle aux écarts d'indice de force entre clubs. */
const ELO_SENSITIVITY = 0.028;

const PREMATCH_MARGIN = 1.045;
const LIVE_MARGIN_MIN = 1.05;
const LIVE_MARGIN_MAX = 1.12;
const LIVE_ODDS_MAX = 100;
const LIVE_MAX_REMAIN = 14;

export interface VirtualTeam {
  name: string;
  strength: number;
}

export const TEAMS: VirtualTeam[] = [
  { name: "Manchester City", strength: 92 },
  { name: "Real Madrid", strength: 92 },
  { name: "Paris SG", strength: 91 },
  { name: "Bayern Munich", strength: 91 },
  { name: "Liverpool", strength: 90 },
  { name: "FC Barcelone", strength: 90 },
  { name: "Arsenal", strength: 90 },
  { name: "Inter Milan", strength: 89 },
  { name: "Marseille", strength: 83 },
  { name: "Toulouse", strength: 77 },
];

/**
 * Indices de force calibrés (échelle 70–93) pour tous les clubs des 5 grands
 * championnats européens et de la Ligue des Champions.
 */
const CLUB_STRENGTH_RAW: Record<string, number> = {
  // Ligue 1
  "Paris SG": 91,
  PSG: 91,
  Monaco: 84,
  Marseille: 83,
  Lille: 83,
  Lyon: 82,
  Nice: 81,
  Lens: 81,
  Brest: 79,
  Rennes: 80,
  Strasbourg: 78,
  Reims: 77,
  Toulouse: 77,
  Nantes: 75,
  Auxerre: 75,
  Montpellier: 74,
  "Saint-Étienne": 73,
  "Le Havre": 72,
  Angers: 72,

  // Premier League
  "Manchester City": 92,
  Liverpool: 90,
  Arsenal: 90,
  Chelsea: 85,
  Newcastle: 84,
  "Aston Villa": 84,
  Tottenham: 83,
  "Manchester United": 82,
  Brighton: 81,
  Bournemouth: 79,
  "Nottingham Forest": 79,
  Fulham: 79,
  Brentford: 78,
  "West Ham": 78,
  "Crystal Palace": 78,
  Everton: 76,
  Wolverhampton: 76,
  "Leicester City": 74,
  "Ipswich Town": 72,
  Southampton: 72,

  // Liga
  "Real Madrid": 92,
  "FC Barcelone": 90,
  "Atlético Madrid": 87,
  "Athletic Bilbao": 83,
  Villarreal: 83,
  "Real Sociedad": 82,
  "Real Betis": 81,
  Gérone: 80,
  "FC Séville": 79,
  "Celta Vigo": 78,
  "CA Osasuna": 78,
  "RCD Majorque": 77,
  "Rayo Vallecano": 77,
  Valence: 76,
  Getafe: 76,
  Alavés: 75,
  Espanyol: 74,
  "Las Palmas": 74,
  Leganés: 73,
  "Real Valladolid": 72,

  // Bundesliga
  "Bayern Munich": 91,
  Leverkusen: 88,
  Dortmund: 86,
  "RB Leipzig": 85,
  Stuttgart: 83,
  "Eintracht Francfort": 83,
  Fribourg: 80,
  Wolfsburg: 79,
  "Mainz 05": 78,
  "Werder Brême": 78,
  Mönchengladbach: 78,
  Hoffenheim: 77,
  "Union Berlin": 77,
  Augsbourg: 76,
  Heidenheim: 74,
  "St. Pauli": 73,
  Bochum: 72,
  "Holstein Kiel": 71,

  // Serie A
  "Inter Milan": 89,
  Naples: 87,
  Atalanta: 86,
  "AC Milan": 85,
  Juventus: 85,
  Latium: 83,
  "AS Rome": 83,
  Fiorentina: 82,
  Bologne: 81,
  Turin: 78,
  Udinese: 77,
  Côme: 76,
  Genoa: 76,
  Parme: 75,
  Cagliari: 75,
  Empoli: 74,
  "Hellas Vérone": 74,
  Lecce: 73,
  Monza: 73,
  Venise: 72,

  // Ligue des Champions / Europe
  "Sporting CP": 84,
  "PSV Eindhoven": 83,
  "FC Porto": 83,
  Feyenoord: 81,
  Galatasaray: 81,
  "Club Brugge": 79,
  "Chakhtar Donetsk": 78,
  "Slavia Prague": 78,
};

function normKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const STRENGTH_BY_NORM = new Map<string, number>(
  Object.entries(CLUB_STRENGTH_RAW).map(([k, v]) => [normKey(k), v])
);

/** Buteurs réalistes par club pour enrichir le fil d'événements live. */
const CLUB_SCORERS: Record<string, string[]> = {
  [normKey("Paris SG")]: ["O. Dembélé", "B. Barcola", "G. Ramos", "J. Neves", "A. Hakimi"],
  [normKey("Marseille")]: ["M. Greenwood", "A. Gouiri", "A. Rabiot", "L. Henrique", "P. Højbjerg"],
  [normKey("Lyon")]: ["A. Lacazette", "R. Cherki", "G. Mikautadze", "M. Fofana", "C. Tolisso"],
  [normKey("Monaco")]: ["M. Akliouche", "B. Embolo", "E. Ben Seghir", "D. Zakaria", "M. Biereth"],
  [normKey("Lille")]: ["J. David", "E. Zhegrova", "H. Haraldsson", "B. André"],
  [normKey("Nice")]: ["E. Guessand", "G. Laborde", "J. Clauss", "S. Diop"],
  [normKey("Lens")]: ["F. Sotoca", "M. Nzola", "A. Thomasson"],
  [normKey("Arsenal")]: ["B. Saka", "K. Havertz", "M. Ødegaard", "G. Martinelli", "D. Rice"],
  [normKey("Chelsea")]: ["C. Palmer", "N. Jackson", "C. Nkunku", "N. Madueke", "E. Fernández"],
  [normKey("Liverpool")]: ["M. Salah", "L. Díaz", "C. Gakpo", "D. Jota", "D. Szoboszlai"],
  [normKey("Manchester City")]: ["E. Haaland", "P. Foden", "B. Silva", "K. De Bruyne", "Savinho"],
  [normKey("Manchester United")]: ["B. Fernandes", "A. Diallo", "A. Garnacho", "R. Højlund"],
  [normKey("Tottenham")]: ["H. Son", "D. Solanke", "J. Maddison", "B. Johnson"],
  [normKey("Newcastle")]: ["A. Isak", "A. Gordon", "B. Guimarães", "H. Barnes"],
  [normKey("Aston Villa")]: ["O. Watkins", "M. Rogers", "Y. Tielemans", "L. Bailey"],
  [normKey("Real Madrid")]: ["K. Mbappé", "Vinícius Jr.", "J. Bellingham", "Rodrygo", "F. Valverde"],
  [normKey("FC Barcelone")]: ["R. Lewandowski", "L. Yamal", "Raphinha", "D. Olmo", "Pedri"],
  [normKey("Atlético Madrid")]: ["J. Álvarez", "A. Griezmann", "A. Sørloth", "G. Simeone"],
  [normKey("Real Betis")]: ["Isco", "Antony", "G. Lo Celso", "C. Bakambu"],
  [normKey("Villarreal")]: ["A. Perez", "Á. Baena", "T. Barry", "G. Moreno"],
  [normKey("FC Séville")]: ["D. Lukébakio", "I. Romero", "Saúl"],
  [normKey("Bayern Munich")]: ["H. Kane", "J. Musiala", "M. Olise", "L. Sané", "J. Kimmich"],
  [normKey("Dortmund")]: ["S. Guirassy", "J. Gittens", "K. Adeyemi", "J. Brandt"],
  [normKey("Leverkusen")]: ["F. Wirtz", "P. Schick", "V. Boniface", "Á. Grimaldo"],
  [normKey("RB Leipzig")]: ["B. Šeško", "L. Openda", "X. Simons", "C. Baumgartner"],
  [normKey("Inter Milan")]: ["L. Martínez", "M. Thuram", "H. Çalhanoğlu", "N. Barella", "D. Dumfries"],
  [normKey("AC Milan")]: ["C. Pulisic", "R. Leão", "T. Reijnders", "S. Giménez"],
  [normKey("Juventus")]: ["D. Vlahović", "K. Yıldız", "R. Kolo Muani", "T. Koopmeiners"],
  [normKey("Naples")]: ["R. Lukaku", "S. McTominay", "M. Politano", "A. Anguissa"],
  [normKey("Atalanta")]: ["M. Retegui", "A. Lookman", "C. De Ketelaere"],
  [normKey("AS Rome")]: ["P. Dybala", "A. Dovbyk", "L. Pellegrini"],
};

export function pickScorerName(teamName: string, seed: number): string | undefined {
  const list = CLUB_SCORERS[normKey(teamName)];
  if (!list || list.length === 0) return undefined;
  // Distribution pondérée vers les premiers attaquants de la liste
  const weights = list.map((_, idx) => Math.max(1, list.length - idx));
  const total = weights.reduce((a, b) => a + b, 0);
  let pick = ((seed >>> 0) % total);
  for (let i = 0; i < list.length; i++) {
    if (pick < weights[i]) return list[i];
    pick -= weights[i];
  }
  return list[0];
}

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

export function teamStrength(name: string): number {
  const hit = STRENGTH_BY_NORM.get(normKey(name));
  if (hit != null) return hit;
  // Hash déterministe doux entre 76 et 82 pour les clubs personnalisés
  return 76 + (hashString(normKey(name)) % 7);
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export interface LiveScoreModel {
  /**
   * Matrice jointe indexée par le SCORE FINAL [finalHome][finalAway].
   * Pour toute case H < homeScore ou A < awayScore, grid[H][A] === 0.
   * La somme totale de la grille vaut exactement 1.
   */
  grid: number[][];
  margin: number;
  lamH: number;
  lamA: number;
}

export function expectedGoals(home: string, away: string): { lambdaHome: number; lambdaAway: number } {
  const sh = teamStrength(home);
  const sa = teamStrength(away);
  const diff = sh - sa;
  return {
    lambdaHome: clamp(BASE_HOME * Math.exp(diff * ELO_SENSITIVITY), 0.45, 3.2),
    lambdaAway: clamp(BASE_AWAY * Math.exp(-diff * ELO_SENSITIVITY), 0.38, 2.95),
  };
}

/** Applique la marge bookmaker pondérée par la variance à un jeu de probabilités exclusives. */
export function applyOverround(probs: number[], overround: number): number[] {
  const mu = Math.max(0.01, overround - 1);
  const clean = probs.map((p) => clamp(p, 0.0002, 0.9996));
  const sumP = clean.reduce((a, b) => a + b, 0) || 1;
  const norm = clean.map((p) => p / sumP);

  const weights = norm.map((p) => p * (1 - p));
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW < 1e-6) {
    return norm.map((p) => clamp(p, 0.001, 0.99));
  }

  // Plafonne la marge quand une issue est quasi certaine afin que p_imp reste toujours < 1
  const muEff = Math.min(mu, 0.65 * sumW);
  return norm.map((p, i) => clamp(p + muEff * (weights[i] / sumW), 0.0005, 0.99));
}

/** Cote décimale d'un événement binaire de probabilité vraie `p` avec overround `overround`. */
export function binaryOutcomeOdds(p: number, overround: number, maxOdds = 150): number {
  const pClean = clamp(p, 0.0004, 0.996);
  const [pImp] = applyOverround([pClean, 1 - pClean], overround);
  return round2(clamp(1 / pImp, 1.01, maxOdds));
}

/** Cotes décimales d'une partition d'issues mutuellement exclusives (somme des probs = 1). */
export function partitionOutcomeOdds(probs: number[], overround: number, maxOdds = 150): number[] {
  const implied = applyOverround(probs, overround);
  return implied.map((pImp) => round2(clamp(1 / pImp, 1.01, maxOdds)));
}

/** Calcule la ligne de handicap asiatique basée sur la différence de buts attendus. */
export function asianHandicapLine(
  home: string,
  away: string,
  opts?: { homeForm?: number; awayForm?: number; redHome?: number; redAway?: number }
): number {
  let { lambdaHome, lambdaAway } = expectedGoals(home, away);

  const hf = opts?.homeForm ?? 1;
  const af = opts?.awayForm ?? 1;
  lambdaHome *= hf;
  lambdaAway *= af;

  const rh = opts?.redHome ?? 0;
  const ra = opts?.redAway ?? 0;
  lambdaHome *= Math.pow(0.68, rh);
  lambdaAway *= Math.pow(0.68, ra);
  lambdaHome *= 1 + 0.18 * ra;
  lambdaAway *= 1 + 0.18 * rh;

  const diff = lambdaHome - lambdaAway;
  const line = Math.round(diff * 4) / 4;
  return clamp(line, -3, 3);
}

export function poissonPmf(k: number, lambda: number): number {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact;
}

export function oddsFor(
  home: string,
  away: string,
  opts?: { homeForm?: number; awayForm?: number; redHome?: number; redAway?: number }
) {
  const p = liveResultProbs(home, away, 0, 0, 0, opts);
  const [oddsHome, oddsDraw, oddsAway] = partitionOutcomeOdds(
    [p.home, p.draw, p.away],
    PREMATCH_MARGIN,
    LIVE_ODDS_MAX
  );
  return { oddsHome, oddsDraw, oddsAway };
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

export function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed: number) {
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
//  Modèle probabiliste unifié (avant-match + live)
// ──────────────────────────────────────────────

const DC_RHO = -0.09; // Dixon-Coles : légère sur-représentation empirique des 0-0 et 1-1 au football

function dixonColesTau(x: number, y: number, lambdaH: number, lambdaA: number): number {
  if (x === 0 && y === 0) return Math.max(0.2, 1 - lambdaH * lambdaA * DC_RHO);
  if (x === 0 && y === 1) return Math.max(0.2, 1 + lambdaH * DC_RHO);
  if (x === 1 && y === 0) return Math.max(0.2, 1 + lambdaA * DC_RHO);
  if (x === 1 && y === 1) return Math.max(0.2, 1 - DC_RHO);
  return 1;
}

function fact(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

const CORR_RHO = 0.08;

function bivariatePoissonGrid(
  lambdaH: number,
  lambdaA: number,
  maxGoals: number,
  applyDixonColes = false
): number[][] {
  const lambda3 = CORR_RHO * Math.sqrt(Math.max(lambdaH, 0.005) * Math.max(lambdaA, 0.005));
  const lambda1 = Math.max(lambdaH - lambda3, 0.002);
  const lambda2 = Math.max(lambdaA - lambda3, 0.002);
  const lambda3Safe = Math.max(lambda3, 0.0005);

  const size = maxGoals + 1;
  const grid: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));

  const logFact: number[] = [0];
  for (let i = 1; i <= maxGoals; i++) logFact[i] = logFact[i - 1] + Math.log(i);

  const logL1 = Math.log(lambda1);
  const logL2 = Math.log(lambda2);
  const logL3 = Math.log(lambda3Safe);
  const logETotal = -(lambda1 + lambda2 + lambda3Safe);

  let total = 0;
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
      const tau = applyDixonColes ? dixonColesTau(i, j, lambdaH, lambdaA) : 1;
      const cell = Math.exp(logETotal) * sum * tau;
      grid[i][j] = cell;
      total += cell;
    }
  }

  if (total > 0) {
    for (let i = 0; i <= maxGoals; i++) {
      for (let j = 0; j <= maxGoals; j++) {
        grid[i][j] /= total;
      }
    }
  }

  return grid;
}

/**
 * Profil d'intensité réel au football (proportion cumulée des buts marqués d'ici la minute m) :
 * ~45% en 1re période, ~55% en 2e période dont ~22% dans le dernier quart d'heure.
 */
const INTENSITY_BUCKETS: Array<{ minute: number; cumul: number }> = [
  { minute: 0, cumul: 0 },
  { minute: 15, cumul: 0.13 },
  { minute: 30, cumul: 0.28 },
  { minute: 45, cumul: 0.45 },
  { minute: 60, cumul: 0.61 },
  { minute: 75, cumul: 0.78 },
  { minute: 90, cumul: 1 },
];

export function goalTimeCDF(minute: number): number {
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

/** Intensité d'une minute précise m ∈ [1..90] (somme sur 1..90 = 1). */
export function minuteGoalShare(minute: number): number {
  const m = clamp(Math.round(minute), 1, 90);
  return Math.max(0.004, goalTimeCDF(m) - goalTimeCDF(m - 1));
}

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

export function skellamPMF(k: number, lambda1: number, lambda2: number): number {
  const mu = lambda1 + lambda2;
  const ratio = lambda1 / Math.max(lambda2, 0.001);
  const x = 2 * Math.sqrt(Math.max(lambda1, 0.001) * Math.max(lambda2, 0.001));
  const bessel = modifiedBesselI(k, x);
  return Math.exp(-mu) * Math.pow(ratio, k / 2) * bessel;
}

export function skellamCDF(k: number, lambda1: number, lambda2: number): number {
  let sum = 0;
  for (let i = -200; i <= k; i++) {
    const p = skellamPMF(i, lambda1, lambda2);
    if (!isFinite(p) || isNaN(p) || p < 0) continue;
    sum += p;
  }
  return clamp(sum, 0, 1);
}

/**
 * Modèle joint unifié du SCORE FINAL conditionnellement à (homeScore, awayScore, minute).
 * Fonctionne aussi bien en avant-match (0, 0, 0) qu'en plein direct (score courant, minute).
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
  const mClamped = clamp(minute, 0, 90);
  const elapsedShare = goalTimeCDF(mClamped);
  const remainingShare = mClamped >= 90 ? 0.002 : clamp(1 - elapsedShare, 0.015, 1);

  let baseH = lambdaHome * (opts?.homeForm ?? 1);
  let baseA = lambdaAway * (opts?.awayForm ?? 1);

  // Impact cartons rouges sur les buts restants
  const rh = opts?.redHome ?? 0;
  const ra = opts?.redAway ?? 0;
  baseH *= Math.pow(0.68, rh) * (1 + 0.18 * ra);
  baseA *= Math.pow(0.68, ra) * (1 + 0.18 * rh);

  // Dynamique tactique selon le score en seconde période
  const offset = homeScore - awayScore;
  if (mClamped >= 55) {
    if (offset === -1) {
      // Domicile mené d'un but : pousse fort, s'expose en contre
      baseH *= 1.14;
      baseA *= 1.06;
    } else if (offset === 1) {
      // Extérieur mené d'un but : pousse, laisse des espaces
      baseA *= 1.14;
      baseH *= 1.06;
    } else if (Math.abs(offset) >= 2 && mClamped >= 65) {
      // Écart confortable : rythme légèrement ralenti
      baseH *= 0.9;
      baseA *= 0.9;
    }
  }

  // Ajustement doux du rythme global selon l'intensité observée (sans écraser la hiérarchie)
  if (mClamped >= 20 && elapsedShare >= 0.18) {
    const expectedSoFar = (lambdaHome + lambdaAway) * elapsedShare;
    const observedSoFar = homeScore + awayScore;
    const paceRatio = clamp((observedSoFar + 1.8) / (expectedSoFar + 1.8), 0.82, 1.25);
    baseH *= paceRatio;
    baseA *= paceRatio;
  }

  const remH = mClamped >= 90 ? 0.001 : Math.max(0.003, baseH * remainingShare);
  const remA = mClamped >= 90 ? 0.001 : Math.max(0.003, baseA * remainingShare);

  const margin =
    mClamped <= 0
      ? PREMATCH_MARGIN
      : round2(
          clamp(
            LIVE_MARGIN_MIN + elapsedShare * (LIVE_MARGIN_MAX - LIVE_MARGIN_MIN),
            LIVE_MARGIN_MIN,
            LIVE_MARGIN_MAX
          )
        );

  const maxAdd = mClamped >= 90 ? 2 : clamp(Math.ceil(Math.max(remH, remA) * 3 + 6), 7, LIVE_MAX_REMAIN);
  const remGrid = bivariatePoissonGrid(remH, remA, maxAdd, mClamped === 0 && homeScore === 0 && awayScore === 0);

  // Décalage vers la grille des SCORES FINAUX [homeScore + addH][awayScore + addA]
  const sizeH = homeScore + maxAdd + 1;
  const sizeA = awayScore + maxAdd + 1;
  const finalGrid: number[][] = Array.from({ length: sizeH }, () => new Array<number>(sizeA).fill(0));
  for (let i = 0; i <= maxAdd; i++) {
    for (let j = 0; j <= maxAdd; j++) {
      finalGrid[homeScore + i][awayScore + j] = remGrid[i][j];
    }
  }

  return { grid: finalGrid, margin, lamH: remH, lamA: remA };
}

/** Probabilités exactes du résultat 1/N/2 issues de la grille unifiée du score final. */
export function liveResultProbs(
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  minute: number,
  opts?: { homeForm?: number; awayForm?: number; redHome?: number; redAway?: number }
): { home: number; draw: number; away: number } {
  const { grid } = liveScoreModel(home, away, homeScore, awayScore, minute, opts);
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid[i].length; j++) {
      const v = grid[i][j];
      if (v <= 0) continue;
      if (i > j) pHome += v;
      else if (i === j) pDraw += v;
      else pAway += v;
    }
  }
  const total = pHome + pDraw + pAway || 1;
  return {
    home: pHome / total,
    draw: pDraw / total,
    away: pAway / total,
  };
}

/** Cotes live du marché Résultat (1/N/2) parfaitement alignées avec tous les autres marchés. */
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
  const [oddsHome, oddsDraw, oddsAway] = partitionOutcomeOdds(
    [p.home, p.draw, p.away],
    margin,
    LIVE_ODDS_MAX
  );
  return { oddsHome, oddsDraw, oddsAway };
}
