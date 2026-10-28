import {
  getCachedClubGlickoModifiers,
  getCachedMarketCalibratorMultiplier,
} from "@/lib/ml-weights";
import { sanitizeMatchEvents } from "@/lib/match-events";

export const VIRTUAL_LEAGUE = "Ligue des Champions · Europe";
export const ROUND_MS = 300_000;

/** Buts moyens attendus à forces égales (football européen moderne : avantage terrain mesuré ~8 %). */
const BASE_HOME = 1.38;
const BASE_AWAY = 1.22;
/** Sensibilité exponentielle aux écarts d'indice de force entre clubs (hiérarchie réaliste 1xBet). */
const ELO_SENSITIVITY = 0.034;

const PREMATCH_MARGIN = 1.072;
const LIVE_MARGIN_MIN = 1.075;
const LIVE_MARGIN_MAX = 1.14;
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

/** Buteurs réalistes par club (effectifs saison 2026-27) pour enrichir le fil d'événements live. */
const CLUB_SCORERS: Record<string, string[]> = {
  [normKey("Paris SG")]: ["O. Dembélé", "F. Torres", "K. Kvaratskhelia", "D. Doué", "Vitinha"],
  [normKey("Marseille")]: ["A. Gouiri", "I. Paixão", "T. Weah", "N. Maupay", "P. Højbjerg"],
  [normKey("Lyon")]: ["M. Fofana", "L. Openda", "G. Mikautadze", "C. Tolisso"],
  [normKey("Monaco")]: ["M. Akliouche", "M. Biereth", "M. Abline", "E. Ben Seghir", "D. Zakaria"],
  [normKey("Lille")]: ["H. Haraldsson", "B. André", "O. Sahraoui", "T. Meunier"],
  [normKey("Nice")]: ["E. Guessand", "G. Laborde", "J. Clauss", "S. Diop"],
  [normKey("Lens")]: ["F. Sotoca", "M. Nzola", "A. Thomasson"],
  [normKey("Arsenal")]: ["B. Saka", "K. Havertz", "M. Ødegaard", "B. Guimarães", "E. Eze"],
  [normKey("Chelsea")]: ["C. Palmer", "J. Pedro", "M. Rogers", "P. Neto", "C. Nkunku"],
  [normKey("Liverpool")]: ["A. Isak", "B. Barcola", "F. Wirtz", "C. Gakpo", "D. Szoboszlai"],
  [normKey("Manchester City")]: ["E. Haaland", "P. Foden", "R. Cherki", "E. Fernández", "B. Silva"],
  [normKey("Manchester United")]: ["B. Fernandes", "B. Mbeumo", "A. Diallo", "R. Højlund"],
  [normKey("Tottenham")]: ["D. Solanke", "O. Marmoush", "J. Maddison", "S. Tonali", "Savinho"],
  [normKey("Newcastle")]: ["Y. Wissa", "A. Elanga", "H. Barnes", "J. Willock"],
  [normKey("Aston Villa")]: ["O. Watkins", "N. Jackson", "Y. Tielemans", "I. Mbaye"],
  [normKey("Real Madrid")]: ["K. Mbappé", "Vinícius Jr.", "J. Bellingham", "Y. Diomande", "F. Valverde"],
  [normKey("FC Barcelone")]: ["L. Yamal", "Raphinha", "A. Gordon", "D. Olmo", "R. Lewandowski"],
  [normKey("Atlético Madrid")]: ["J. Álvarez", "A. Griezmann", "A. Sørloth", "G. Simeone"],
  [normKey("Real Betis")]: ["Isco", "Antony", "G. Lo Celso", "C. Bakambu"],
  [normKey("Villarreal")]: ["A. Perez", "G. Moreno", "Y. Pino"],
  [normKey("FC Séville")]: ["D. Lukébakio", "I. Romero", "Saúl"],
  [normKey("Bayern Munich")]: ["H. Kane", "J. Musiala", "M. Olise", "J. Kimmich"],
  [normKey("Dortmund")]: ["S. Guirassy", "K. Adeyemi", "J. Brandt", "M. Sabitzer"],
  [normKey("Leverkusen")]: ["P. Schick", "I. Maza", "C. Kofane", "M. Diaby"],
  [normKey("RB Leipzig")]: ["B. Šeško", "X. Simons", "C. Baumgartner"],
  [normKey("Inter Milan")]: ["L. Martínez", "M. Thuram", "H. Çalhanoğlu", "N. Barella", "D. Dumfries"],
  [normKey("AC Milan")]: ["C. Pulisic", "R. Leão", "T. Reijnders", "S. Giménez"],
  [normKey("Juventus")]: ["J. David", "D. Vlahović", "K. Yıldız", "T. Koopmeiners"],
  [normKey("Naples")]: ["R. Lukaku", "K. De Bruyne", "S. McTominay", "M. Politano"],
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

export function leagueGoalMultiplier(league?: string | null): number {
  if (!league) return 1;
  const l = league.toLowerCase();
  if (l.includes("bundesliga") || l.includes("eredivisie")) return 1.05;
  if (l.includes("champions")) return 1.03;
  if (l.includes("premier league")) return 1.02;
  if (l.includes("serie a") || l.includes("liga") || l.includes("laliga")) return 0.97;
  return 1;
}

export function expectedGoalsRaw(
  home: string,
  away: string,
  league?: string | null
): { lambdaHome: number; lambdaAway: number } {
  const sh = teamStrength(home);
  const sa = teamStrength(away);
  const diff = sh - sa;
  const lgMult = leagueGoalMultiplier(league);
  return {
    lambdaHome: clamp(BASE_HOME * lgMult * Math.exp(diff * ELO_SENSITIVITY), 0.36, 3.45),
    lambdaAway: clamp(BASE_AWAY * lgMult * Math.exp(-diff * ELO_SENSITIVITY), 0.30, 3.15),
  };
}

export function expectedGoals(
  home: string,
  away: string,
  league?: string | null
): { lambdaHome: number; lambdaAway: number } {
  const raw = expectedGoalsRaw(home, away, league);
  const glicko = getCachedClubGlickoModifiers(home, away);
  return {
    lambdaHome: clamp(raw.lambdaHome * glicko.homeGoalMod, 0.34, 3.55),
    lambdaAway: clamp(raw.lambdaAway * glicko.awayGoalMod, 0.28, 3.25),
  };
}

/**
 * Applique l'overround proportionnel équilibré (+ légère prime de risque sur les grosses cotes) :
 * garantit mathématiquement une espérance joueur strictement négative (~ -6,5 % à -8 %)
 * sur TOUTES les issues simultanément (Domicile, Nul, Extérieur, Favori, Outsider, Over, Under).
 */
export function applyOverround(probs: number[], overround: number): number[] {
  const mu = Math.max(0.01, overround - 1);
  const clean = probs.map((p) => clamp(p, 0.0002, 0.9996));
  const sumP = clean.reduce((a, b) => a + b, 0) || 1;
  const norm = clean.map((p) => p / sumP);

  // Pondération quasi-proportionnelle (`p^0.88`) : couvre uniformément favoris ET outsiders
  // sans sous-marger les cotes hautes lorsqu'une issue est dominante en live.
  const weights = norm.map((p) => Math.pow(p, 0.88) * Math.pow(1 - p, 0.22));
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW < 1e-6) {
    return norm.map((p) => clamp(p, 0.001, 0.99));
  }

  const maxAllowedAdd = norm.reduce((acc, p, i) => {
    if (p >= 0.992) return 0;
    const share = weights[i] / sumW;
    return share > 0 ? Math.min(acc, (0.992 - p) / share) : acc;
  }, mu);
  const muEff = Math.max(0.005, Math.min(mu, maxAllowedAdd));

  return norm.map((p, i) => clamp(p + muEff * (weights[i] / sumW), 0.0005, 0.992));
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
  opts?: LivePricingOpts
) {
  const p = liveResultProbs(home, away, 0, 0, 0, opts);
  const [rawH, rawD, rawA] = partitionOutcomeOdds(
    [p.home, p.draw, p.away],
    PREMATCH_MARGIN,
    LIVE_ODDS_MAX
  );
  const cal = (o: number) =>
    round2(clamp(o / getCachedMarketCalibratorMultiplier("result", o), 1.01, LIVE_ODDS_MAX));
  return { oddsHome: cal(rawH), oddsDraw: cal(rawD), oddsAway: cal(rawA) };
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

const DC_RHO = -0.095; // Dixon-Coles : légère sur-représentation empirique des 0-0 et 1-1 au football

function dixonColesTau(
  x: number,
  y: number,
  lambdaH: number,
  lambdaA: number,
  rhoScale = 1
): number {
  const rho = DC_RHO * clamp(rhoScale, 0, 1);
  if (Math.abs(rho) < 1e-4) return 1;
  if (x === 0 && y === 0) return Math.max(0.25, 1 - lambdaH * lambdaA * rho);
  if (x === 0 && y === 1) return Math.max(0.25, 1 + lambdaH * rho);
  if (x === 1 && y === 0) return Math.max(0.25, 1 + lambdaA * rho);
  if (x === 1 && y === 1) return Math.max(0.25, 1 - rho);
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
  dixonColesScale: boolean | number = false
): number[][] {
  const dcScale =
    typeof dixonColesScale === "number"
      ? dixonColesScale
      : dixonColesScale
        ? 1
        : 0;
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
      const tau = dcScale > 0 ? dixonColesTau(i, j, lambdaH, lambdaA, dcScale) : 1;
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
 * Paliers d'actualisation temporelle des cotes :
 * - Sur un match virtuel (5 min = 90’), 8 minutes simulées ≈ 25 secondes réelles :
 *   tant qu'aucun événement (but, carton rouge, mi-temps) ne survient, les cotes restent
 *   stables entre deux paliers au lieu de clignoter toutes les 3 secondes sans raison.
 * - Sur un match réel (`isReal: true`) : AUCUN gel de 6 minutes — progression continue
 *   minute par minute de 1’ à 74’ puis toutes les 30 secondes de 75’ à 90+’.
 */
const VIRTUAL_PRICING_CHECKPOINTS = [
  0, 8, 16, 24, 32, 40, 45, 53, 61, 68, 75, 81, 85, 89, 90,
] as const;

export function livePricingMinute(
  minute: number,
  opts?: { isReal?: boolean; lastIncidentMin?: number }
): number {
  if (opts?.isReal) {
    if (minute <= 0) return 0;
    if (minute >= 90) return 90;
    return clamp(Math.round(minute * 2) / 2, 0, 90);
  }

  const m = clamp(Math.round(minute), 0, 90);
  if (m <= 0) return 0;
  if (m >= 90) return 90;

  let snapped = 0;
  for (const cp of VIRTUAL_PRICING_CHECKPOINTS) {
    if (cp <= m) snapped = cp;
    else break;
  }

  const inc = opts?.lastIncidentMin ?? 0;
  if (inc > snapped && inc <= m) {
    return clamp(Math.round(inc), snapped, 89);
  }
  return snapped;
}

export interface LivePricingOpts {
  homeForm?: number;
  awayForm?: number;
  redHome?: number;
  redAway?: number;
  events?: MatchTimelineEvent[] | null;
  regime?: string | null;
  league?: string | null;
}

export interface RealMatchLiveStatsInput {
  possessionHome?: number | null;
  possessionAway?: number | null;
  shotsTotalHome?: number | null;
  shotsTotalAway?: number | null;
  shotsOnTargetHome?: number | null;
  shotsOnTargetAway?: number | null;
  cornersHome?: number | null;
  cornersAway?: number | null;
  savesHome?: number | null;
  savesAway?: number | null;
  yellowCardsHome?: number | null;
  yellowCardsAway?: number | null;
  clockSeconds?: number | null;
  clockPeriod?: number | null;
  statSnapshots?: Array<{
    sec: number;
    sotH: number;
    sotA: number;
    shH: number;
    shA: number;
    corH: number;
    corA: number;
  }>;
  liveFeedProbs?: {
    pHome: number;
    pDraw: number;
    pAway: number;
    source: "bookmaker_live" | "espn_live" | "blended";
    updatedAtSec: number | null;
  } | null;
  feedTotalGoalsExpected?: number | null;
}

/**
 * Résout la minute effective d'un match réel en direct de manière 100 % déterministe :
 * - 1’ à 74’ : granularité 1 minute exacte ;
 * - 75’ à 90’ : granularité 30 secondes (ex. 78,5’ à 78m00s..78m29s, 79,0’ à 78m30s..78m59s) ;
 * - 45+X’ et 90+X’ : gestion précise du temps additionnel toutes les 30 secondes.
 */
export function resolveEffectiveRealLiveMinute(
  minute: number,
  minuteLabel?: string | null,
  realStats?: RealMatchLiveStatsInput | null
): { pMin: number; remShare: number } {
  const minLabel = (minuteLabel ?? "").trim().toUpperCase();
  if (minLabel === "MT" || minLabel === "HT" || minLabel.includes("MI-TEMPS")) {
    return { pMin: 45, remShare: 1 - goalTimeCDF(45) };
  }

  const stop1HMatch = /^45['’]?\+(\d+)/.exec(minLabel);
  const stop2HMatch = /^90['’]?\+(\d+)/.exec(minLabel);
  const sec =
    realStats?.clockSeconds != null && Number.isFinite(realStats.clockSeconds)
      ? Math.max(0, realStats.clockSeconds)
      : null;
  const period = realStats?.clockPeriod ?? (minute >= 46 || stop2HMatch ? 2 : 1);

  // Temps additionnel 2e période (90+X’ ou clockSeconds >= 5400 en 2e MT)
  if (stop2HMatch || (period === 2 && sec != null && sec >= 5400)) {
    const addedMinFromLabel = stop2HMatch ? Math.max(1, Number(stop2HMatch[1])) : 1;
    const stopHalfSteps =
      sec != null && sec >= 5400
        ? Math.floor((sec - 5400) / 30)
        : (addedMinFromLabel - 1) * 2 + 1;
    const remShare = clamp(0.036 * Math.exp(-0.22 * stopHalfSteps), 0.004, 0.036);
    return { pMin: 90, remShare };
  }

  // Temps additionnel 1re période (45+X’ ou clockSeconds >= 2700 en 1re MT)
  if (stop1HMatch || (period === 1 && sec != null && sec >= 2700)) {
    const addedMinFromLabel = stop1HMatch ? Math.max(1, Number(stop1HMatch[1])) : 1;
    const stopHalfSteps =
      sec != null && sec >= 2700
        ? Math.floor((sec - 2700) / 30)
        : (addedMinFromLabel - 1) * 2 + 1;
    const extra1H = clamp(0.018 * Math.exp(-0.28 * stopHalfSteps), 0.002, 0.018);
    return { pMin: 45, remShare: clamp(1 - goalTimeCDF(45) + extra1H, 0.50, 0.58) };
  }

  // Temps réglementaire avec précision 30 s à partir de la 75e minute (`sec >= 4440`)
  let pMin = clamp(minute, 1, 90);
  if (sec != null) {
    if (period === 1) {
      pMin = clamp(Math.floor(sec / 60) + 1, 1, 45);
    } else if (sec < 4440) {
      pMin = clamp(Math.floor(sec / 60) + 1, 46, 74);
    } else {
      const halfStepsSince74 = Math.floor((sec - 4440) / 30);
      pMin = clamp(74.5 + halfStepsSince74 * 0.5, 74.5, 90);
    }
  }

  const effectiveElapsedMin = clamp(pMin - 0.5, 0.25, 89.75);
  const remShare = clamp(1 - goalTimeCDF(effectiveElapsedMin), 0.008, 1);
  return { pMin, remShare };
}

/**
 * Calcule les multiplicateurs tactiques liés à la physionomie du score, à la hiérarchie
 * initiale (favori mené vs outsider qui bétonne) et à l'élan psychologique d'un but récent.
 */
function computeGameStateMultipliers(params: {
  homeScore: number;
  awayScore: number;
  pMin: number;
  preShareH: number;
  events?: MatchTimelineEvent[] | null;
}): { hMult: number; aMult: number; lastIncidentMin: number } {
  const { homeScore, awayScore, pMin, preShareH, events } = params;
  const diff = homeScore - awayScore;
  const progress = clamp(pMin / 90, 0, 1);
  let hMult = 1;
  let aMult = 1;

  // 1) Tactique liée au score courant dès le 1er but (et amplifiée en 2e période)
  if (diff === 0) {
    if (homeScore >= 1) {
      // 1-1, 2-2 : match débridé où les deux blocs sont déjà ouverts
      hMult *= 1.07;
      aMult *= 1.07;
    } else if (pMin >= 55 && pMin < 78) {
      // 0-0 fermé après l'heure de jeu : prudence tactique
      hMult *= 0.94;
      aMult *= 0.94;
    } else if (pMin >= 78) {
      // Fin de 0-0 : le favori pousse un peu plus pour éviter le partage des points
      if (preShareH >= 0.58) hMult *= 1.06;
      else if (preShareH <= 0.42) aMult *= 1.06;
    }
  } else if (diff === -1) {
    // Domicile mené d'1 but : poussée offensive (encore plus forte si Domicile était favori)
    const favBoost = preShareH >= 0.56 ? 0.10 : 0;
    hMult *= 1.09 + 0.16 * progress + favBoost;
    // Extérieur recule d'un cran mais profite d'espaces de contre-attaque en fin de match
    aMult *= pMin >= 68 ? 0.97 : 0.90;
  } else if (diff === 1) {
    // Extérieur mené d'1 but : poussée visiteuse, espaces en transition pour Domicile
    const favBoost = preShareH <= 0.44 ? 0.10 : 0;
    aMult *= 1.08 + 0.15 * progress + favBoost;
    hMult *= pMin >= 68 ? 0.98 : 0.91;
  } else if (diff <= -2) {
    // Domicile mené de 2+ buts : gestion côté visiteur, baroud d'honneur (ou découragement à -3)
    hMult *= diff <= -3 && pMin >= 65 ? 0.92 : 1.08;
    aMult *= pMin >= 60 ? 0.82 : 0.88;
  } else if (diff >= 2) {
    // Domicile mène de 2+ buts : maîtrise du ballon et baisse du tempo
    aMult *= diff >= 3 && pMin >= 65 ? 0.92 : 1.07;
    hMult *= pMin >= 60 ? 0.83 : 0.89;
  }

  // 2) Momentum des événements récents (but inscrit dans les 12 dernières minutes simulées)
  let lastIncidentMin = 0;
  if (Array.isArray(events) && events.length > 0) {
    let recentHomeGoals = 0;
    let recentAwayGoals = 0;
    for (const ev of events) {
      if (ev.minute > lastIncidentMin) lastIncidentMin = ev.minute;
      if (ev.type === "goal" && pMin > 0 && ev.minute <= pMin && pMin - ev.minute <= 12) {
        if (ev.team === "home") recentHomeGoals++;
        else if (ev.team === "away") recentAwayGoals++;
      }
    }
    if (recentHomeGoals > recentAwayGoals) {
      hMult *= 1.08;
    } else if (recentAwayGoals > recentHomeGoals) {
      aMult *= 1.08;
    }
  }

  return {
    hMult: clamp(hMult, 0.72, 1.42),
    aMult: clamp(aMult, 0.72, 1.42),
    lastIncidentMin,
  };
}

/**
 * Modèle joint unifié du SCORE FINAL conditionnellement à (homeScore, awayScore, minute, events, regime).
 * Fonctionne aussi bien en avant-match (0, 0, 0) qu'en plein direct (score courant, minute).
 */
export function liveScoreModel(
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  minute: number,
  opts?: LivePricingOpts
): LiveScoreModel {
  const { lambdaHome, lambdaAway } = expectedGoals(home, away, opts?.league);

  let lastIncidentMin = 0;
  if (Array.isArray(opts?.events)) {
    for (const ev of opts.events) {
      if (ev.minute > lastIncidentMin) lastIncidentMin = ev.minute;
    }
  }

  const pMin = livePricingMinute(minute, {
    isReal: false,
    lastIncidentMin,
  });
  const elapsedShare = goalTimeCDF(pMin);
  const remainingShare = pMin >= 90 ? 0.002 : clamp(1 - elapsedShare, 0.006, 1);

  let baseH = lambdaHome * (opts?.homeForm ?? 1);
  let baseA = lambdaAway * (opts?.awayForm ?? 1);
  const preShareH = baseH / Math.max(0.1, baseH + baseA);

  // Impact fort et réaliste des expulsions (10 contre 11 / 9 contre 11)
  const rh = opts?.redHome ?? 0;
  const ra = opts?.redAway ?? 0;
  if (rh > 0 || ra > 0) {
    baseH *= Math.pow(0.65, rh) * Math.pow(1.24, ra);
    baseA *= Math.pow(0.65, ra) * Math.pow(1.24, rh);
  }

  // Dynamique tactique complète selon le score, le statut favori/outsider et le momentum
  if (pMin > 0 || homeScore > 0 || awayScore > 0) {
    const gs = computeGameStateMultipliers({
      homeScore,
      awayScore,
      pMin,
      preShareH,
      events: opts?.events,
    });
    baseH *= gs.hMult;
    baseA *= gs.aMult;
  }

  // Révélation progressive et réaliste de la physionomie du match (tempo observé sur le terrain)
  if (pMin >= 24 && opts?.regime) {
    const reveal = clamp((pMin - 18) / 54, 0, 0.85);
    if (opts.regime === "high_tempo") {
      baseH *= 1 + 0.10 * reveal;
      baseA *= 1 + 0.10 * reveal;
    } else if (opts.regime === "tactical_lock") {
      baseH *= 1 - 0.11 * reveal;
      baseA *= 1 - 0.11 * reveal;
    } else if (opts.regime === "late_drama" && pMin >= 57) {
      baseH *= 1.11;
      baseA *= 1.11;
    }
  }

  // Ajustement bayésien doux du rythme selon le nombre de buts déjà inscrits
  if (pMin >= 24 && elapsedShare >= 0.22) {
    const expectedSoFar = (lambdaHome + lambdaAway) * elapsedShare;
    const observedSoFar = homeScore + awayScore;
    const paceRatio = clamp((observedSoFar + 2.1) / (expectedSoFar + 2.1), 0.84, 1.22);
    baseH *= paceRatio;
    baseA *= paceRatio;
  }

  const remH = pMin >= 90 ? 0.001 : Math.max(0.002, baseH * remainingShare);
  const remA = pMin >= 90 ? 0.001 : Math.max(0.002, baseA * remainingShare);

  const margin =
    pMin <= 0
      ? PREMATCH_MARGIN
      : round2(
          clamp(
            LIVE_MARGIN_MIN + elapsedShare * (LIVE_MARGIN_MAX - LIVE_MARGIN_MIN),
            LIVE_MARGIN_MIN,
            LIVE_MARGIN_MAX
          )
        );

  const maxAdd = pMin >= 90 ? 2 : clamp(Math.ceil(Math.max(remH, remA) * 3 + 6), 7, LIVE_MAX_REMAIN);
  // Corrélation Dixon-Coles continue en temps restant (évite tout saut artificiel entre 0' et 1')
  const dcScale = Math.pow(remainingShare, 0.75);
  const remGrid = bivariatePoissonGrid(remH, remA, maxAdd, dcScale);

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

/**
 * Modèle de score dédié EXCLUSIVEMENT aux matchs réels (`source = "manual"`).
 * Ne consulte JAMAIS `teamStrength`, `homeForm` ni les paramètres du simulateur virtuel :
 * - calibre les forces intrinsèques 90’ à partir des cotes pré-match `(oddsHome, oddsDraw, oddsAway)`
 *   et, lorsqu'elle est connue, de la ligne de buts Over/Under (`feedTotalGoalsExpected`) ;
 * - progresse chaque minute de 1’ à 74’ puis toutes les 30 secondes de 75’ à 90+’ (zéro gel de 6 min) ;
 * - intègre avec pleine réactivité les statistiques cumulées du match, la pression offensive
 *   glissante des 10–15 dernières minutes (`statSnapshots`), le verrouillage des matchs fermés,
 *   les cartons rouges et les cotes/probabilités live officielles d'ESPN (`liveFeedProbs`).
 */
export function realMatchScoreModel(params: {
  oddsHome: number;
  oddsDraw: number | null;
  oddsAway: number;
  homeScore?: number;
  awayScore?: number;
  minute?: number;
  minuteLabel?: string | null;
  isLive?: boolean;
  redHome?: number;
  redAway?: number;
  events?: MatchTimelineEvent[] | null;
  realStats?: RealMatchLiveStatsInput | null;
}): LiveScoreModel {
  const homeScore = Math.max(0, Math.round(params.homeScore ?? 0));
  const awayScore = Math.max(0, Math.round(params.awayScore ?? 0));
  const isLive = Boolean(params.isLive);
  const minute = clamp(Math.round(params.minute ?? 0), 0, 90);
  const redHome = Math.max(0, Math.round(params.redHome ?? 0));
  const redAway = Math.max(0, Math.round(params.redAway ?? 0));
  const st = params.realStats ?? null;

  const invH = 1 / Math.max(1.02, params.oddsHome || 2.1);
  const invD =
    params.oddsDraw != null && params.oddsDraw > 1.01 ? 1 / params.oddsDraw : 0;
  const invA = 1 / Math.max(1.02, params.oddsAway || 3.2);
  const sumInv = invH + invD + invA || 1;

  const baseMargin = round2(clamp(sumInv, 1.045, 1.12));
  const targetH = invH / sumInv;
  const targetD = invD / sumInv;
  const targetA = invA / sumInv;

  // 1) Calibrage exact des forces intrinsèques 90 min (0-0) à partir des cotes pré-match
  //    et de l'espérance de buts Over/Under bookmaker/ligue lorsqu'elle est disponible.
  const priorTotal =
    st?.feedTotalGoalsExpected != null &&
    Number.isFinite(st.feedTotalGoalsExpected) &&
    st.feedTotalGoalsExpected >= 1.4 &&
    st.feedTotalGoalsExpected <= 4.4
      ? st.feedTotalGoalsExpected
      : null;

  let baseTotal = priorTotal ?? 2.68;
  const logEdge = Math.log(
    clamp(targetH + 0.02, 0.025, 0.97) / clamp(targetA + 0.02, 0.025, 0.97)
  );
  let shareH = clamp(0.5 + 0.25 * logEdge, 0.04, 0.96);

  const evalPreMatch = (tot: number, sh: number) => {
    const lh = Math.max(0.04, tot * sh);
    const la = Math.max(0.04, tot * (1 - sh));
    const g = bivariatePoissonGrid(lh, la, 7, 1);
    let pH = 0;
    let pD = 0;
    let pA = 0;
    for (let i = 0; i <= 7; i++) {
      for (let j = 0; j <= 7; j++) {
        const v = g[i][j];
        if (i > j) pH += v;
        else if (i === j) pD += v;
        else pA += v;
      }
    }
    const s = pH + pD + pA || 1;
    return { pH: pH / s, pD: pD / s, pA: pA / s };
  };

  for (let iter = 0; iter < 12; iter++) {
    const cur = evalPreMatch(baseTotal, shareH);
    const diffEdge = (targetH - targetA) - (cur.pH - cur.pA);
    shareH = clamp(shareH + 0.30 * diffEdge, 0.04, 0.96);
    if (invD > 0) {
      const diffDraw = targetD - cur.pD;
      const drawStep = priorTotal != null ? -0.45 : -0.58;
      const minTot = targetD >= 0.33 ? 1.75 : 2.25;
      baseTotal = clamp(baseTotal * Math.exp(drawStep * diffDraw), minTot, 4.25);
      if (priorTotal != null) {
        baseTotal = baseTotal * 0.65 + priorTotal * 0.35;
      }
    }
  }

  // 2) Horloge de cotation live continue (1 min de 1’ à 74’, 30 s de 75’ à 90+’)
  const liveClockTiming = isLive
    ? resolveEffectiveRealLiveMinute(minute, params.minuteLabel, st)
    : { pMin: 0, remShare: 1 };
  const pMin = liveClockTiming.pMin;
  const remShare = liveClockTiming.remShare;

  let liveH = baseTotal * shareH;
  let liveA = baseTotal * (1 - shareH);

  if (isLive) {
    const elapsedFrac = Math.max(0.06, 1 - remShare);

    // 3) Réactivité calibrée aux statistiques réelles du match (cumulées + 12 dernières minutes)
    if (st && pMin >= 5) {
      const rawSotH = st.shotsOnTargetHome;
      const rawSotA = st.shotsOnTargetAway;
      // Si un flux fournit les arrêts du gardien adverse sans SOT explicite, on en déduit le plancher cadré
      const inferredSotH =
        rawSotH != null
          ? Math.max(0, rawSotH)
          : st.savesAway != null
            ? Math.max(0, st.savesAway) + homeScore
            : 0;
      const inferredSotA =
        rawSotA != null
          ? Math.max(0, rawSotA)
          : st.savesHome != null
            ? Math.max(0, st.savesHome) + awayScore
            : 0;

      const hasShotStats =
        rawSotH != null ||
        rawSotA != null ||
        st.shotsTotalHome != null ||
        st.shotsTotalAway != null ||
        st.cornersHome != null ||
        st.cornersAway != null;

      const shTotH = Math.max(inferredSotH, st.shotsTotalHome ?? 0);
      const shTotA = Math.max(inferredSotA, st.shotsTotalAway ?? 0);
      const corH = Math.max(0, st.cornersHome ?? 0);
      const corA = Math.max(0, st.cornersAway ?? 0);

      if (hasShotStats) {
        // Moyenne européenne sur 90 min : ~9 tirs cadrés, ~16 hors-cadre, ~10 corners -> ~45 pts d'activité
        const threatH =
          inferredSotH * 3.0 + (shTotH - inferredSotH) * 0.65 + corH * 0.75;
        const threatA =
          inferredSotA * 3.0 + (shTotA - inferredSotA) * 0.65 + corA * 0.75;
        const totalThreat = threatH + threatA;

        if (totalThreat >= 1.5) {
          const obsShareH = (threatH + 4.5 * shareH) / (totalThreat + 4.5);
          const cred = clamp(totalThreat / (totalThreat + 22.0), 0, 0.44);
          let liveShareH = clamp(shareH * (1 - cred) + obsShareH * cred, 0.14, 0.86);

          if (st.possessionHome != null && st.possessionAway != null) {
            const possTilt = clamp((st.possessionHome - 50) / 100, -0.26, 0.26);
            liveShareH = clamp(liveShareH + possTilt * 0.06, 0.14, 0.86);
          }

          // Rythme réel du match [0.60x .. 1.28x] :
          // - match verrouillé (peu de tirs/corners) -> baisse nette des buts restants attendus
          // - match ouvert / attaque-défense -> hausse réaliste du rythme offensif
          const expectedActivity = 45.0 * elapsedFrac;
          const observedActivity = totalThreat + (homeScore + awayScore) * 3.8;
          const priorWeight = clamp(10.5 - elapsedFrac * 4.5, 5.0, 10.5);
          const tempo = clamp(
            (observedActivity + priorWeight) / (expectedActivity + priorWeight),
            0.60,
            1.28
          );

          const adjTotal = baseTotal * tempo;
          liveH = adjTotal * liveShareH;
          liveA = adjTotal * (1 - liveShareH);
        } else if (pMin >= 15) {
          // Match extrêmement fermé (quasi 0 tir ni corner après 15’..75’) : contraction nette du tempo
          const sterileSeverity = clamp((pMin - 12) / 58, 0.10, 0.40);
          const sterileFactor = clamp(1 - sterileSeverity, 0.60, 0.90);
          liveH *= sterileFactor;
          liveA *= sterileFactor;

          if (st.possessionHome != null && st.possessionAway != null) {
            const possDiff = clamp((st.possessionHome - 50) / 100, -0.26, 0.26);
            liveH *= 1 + possDiff * 0.26;
            liveA *= 1 - possDiff * 0.26;
          }
        }

        // Pression offensive glissante sur les 10–15 dernières minutes (`statSnapshots`)
        const snaps = st.statSnapshots;
        const curSec = st.clockSeconds ?? Math.round(pMin * 60);
        if (Array.isArray(snaps) && snaps.length > 0 && curSec >= 480) {
          let refSnap = snaps[0];
          for (const s of snaps) {
            const age = curSec - s.sec;
            if (age >= 360 && age <= 960) {
              refSnap = s;
              break;
            }
            if (age >= 240) {
              refSnap = s;
            }
          }
          const winSec = curSec - refSnap.sec;
          if (winSec >= 240) {
            const dSotH = Math.max(0, inferredSotH - refSnap.sotH);
            const dSotA = Math.max(0, inferredSotA - refSnap.sotA);
            const dShH = Math.max(dSotH, shTotH - refSnap.shH);
            const dShA = Math.max(dSotA, shTotA - refSnap.shA);
            const dCorH = Math.max(0, corH - refSnap.corH);
            const dCorA = Math.max(0, corA - refSnap.corA);

            const recThreatH = dSotH * 3.0 + (dShH - dSotH) * 0.65 + dCorH * 0.75;
            const recThreatA = dSotA * 3.0 + (dShA - dSotA) * 0.65 + dCorA * 0.75;
            const recTotal = recThreatH + recThreatA;
            const normWinMin = Math.max(4, winSec / 60);
            // Moyenne normale sur 12 min : ~6.0 pts d'activité cumulée
            const recRatePer12Min = (recTotal / normWinMin) * 12;

            if (recRatePer12Min >= 7.5) {
              const recShareH = (recThreatH + 1.4) / (recTotal + 2.8);
              const curShareH = liveH / Math.max(0.05, liveH + liveA);
              // Accentue la dynamique récente par rapport à la moyenne cumulée sans double comptage excessif
              const surgeIntensity = clamp((recRatePer12Min - 6.0) / 22.0, 0.03, 0.15);
              const shiftH = (recShareH - curShareH) * 0.45 + (recShareH - 0.5) * surgeIntensity;
              liveH *= clamp(1 + shiftH + surgeIntensity * 0.14, 0.88, 1.16);
              liveA *= clamp(1 - shiftH + surgeIntensity * 0.08, 0.86, 1.16);
            } else if (pMin >= 28 && recRatePer12Min <= 1.2) {
              // Les 10–15 dernières minutes sont verrouillées (rythme retombé)
              liveH *= 0.88;
              liveA *= 0.88;
            }
          }
        }

        // Plafond global de cohérence bookmaker sur le taux 90 min équivalent
        const curTot = liveH + liveA;
        const clampedTot = clamp(curTot, baseTotal * 0.54, baseTotal * 1.32);
        const clampedShareH = clamp(liveH / Math.max(0.05, curTot), 0.15, 0.85);
        liveH = clampedTot * clampedShareH;
        liveA = clampedTot * (1 - clampedShareH);
      } else if (st.possessionHome != null && st.possessionAway != null && pMin >= 8) {
        const possDiff = clamp((st.possessionHome - 50) / 100, -0.28, 0.28);
        liveH *= 1 + possDiff * 0.36;
        liveA *= 1 - possDiff * 0.36;
      }
    }

    // 4) Physionomie tactique du score, urgence du favori mené et gestion d'écart 2+ buts
    const gs = computeGameStateMultipliers({
      homeScore,
      awayScore,
      pMin,
      preShareH: shareH,
      events: params.events,
    });
    liveH *= gs.hMult;
    liveA *= gs.aMult;

    if (Math.abs(homeScore - awayScore) >= 2 && pMin >= 62) {
      // À +2 ou +3 après l'heure de jeu, le bloc qui mène gère le chrono
      liveH *= 0.86;
      liveA *= 0.86;
    }

    // 5) Réalité des buts inscrits vs attendus (sans double-compter l'écoulement du chrono déjà porté par `remShare`)
    if (pMin >= 20) {
      const expGoalsSoFar = baseTotal * elapsedFrac;
      const obsGoals = homeScore + awayScore;
      const goalPace = clamp(
        (obsGoals + 3.4) / (expGoalsSoFar + 3.4),
        0.82,
        1.28
      );
      const hasShots =
        st != null &&
        (st.shotsOnTargetHome != null ||
          st.shotsTotalHome != null ||
          st.cornersHome != null);
      const effectivePace = hasShots ? 1 + (goalPace - 1) * 0.30 : goalPace;
      liveH *= effectivePace;
      liveA *= effectivePace;
    }
  }

  // 6) Impact réaliste des cartons rouges (infériorité numérique 10 contre 11 / 9 contre 11)
  const redFactorH = Math.pow(0.54, redHome) * Math.pow(1.48, redAway);
  const redFactorA = Math.pow(0.54, redAway) * Math.pow(1.48, redHome);
  let remH = Math.max(0.003, liveH * remShare * redFactorH);
  let remA = Math.max(0.003, liveA * remShare * redFactorA);

  // 7) Ancrage sans arbitrage sur les cotes live `current` bookmaker & probabilités live ESPN
  const feedProbs = isLive ? st?.liveFeedProbs : null;
  if (
    feedProbs &&
    Number.isFinite(feedProbs.pHome) &&
    Number.isFinite(feedProbs.pDraw) &&
    Number.isFinite(feedProbs.pAway)
  ) {
    const curSec = st?.clockSeconds ?? null;
    const ageSec =
      curSec != null && feedProbs.updatedAtSec != null
        ? Math.max(0, curSec - feedProbs.updatedAtSec)
        : 0;
    if (ageSec <= 240) {
      const freshness = ageSec <= 90 ? 1 : clamp(1 - (ageSec - 90) / 160, 0.25, 1);
      const baseWeight =
        feedProbs.source === "bookmaker_live"
          ? 0.62
          : feedProbs.source === "blended"
            ? 0.58
            : 0.38;
      const wFeed = baseWeight * freshness;

      const dcProbe = Math.pow(remShare, 0.75);
      const evalLive1x2 = (lh: number, la: number) => {
        const g = bivariatePoissonGrid(Math.max(0.003, lh), Math.max(0.003, la), 6, dcProbe);
        let pH = 0;
        let pD = 0;
        let pA = 0;
        for (let i = 0; i <= 6; i++) {
          for (let j = 0; j <= 6; j++) {
            const v = g[i][j];
            const fh = homeScore + i;
            const fa = awayScore + j;
            if (fh > fa) pH += v;
            else if (fh === fa) pD += v;
            else pA += v;
          }
        }
        const s = pH + pD + pA || 1;
        return { pH: pH / s, pD: pD / s, pA: pA / s };
      };

      let calTot = clamp(remH + remA, 0.02, 4.5);
      let calShareH = clamp(remH / Math.max(0.006, remH + remA), 0.04, 0.96);
      const fSum = feedProbs.pHome + feedProbs.pDraw + feedProbs.pAway || 1;
      const fH = feedProbs.pHome / fSum;
      const fD = feedProbs.pDraw / fSum;
      const fA = feedProbs.pAway / fSum;

      for (let it = 0; it < 8; it++) {
        const cur = evalLive1x2(calTot * calShareH, calTot * (1 - calShareH));
        const dEdge = (fH - fA) - (cur.pH - cur.pA);
        calShareH = clamp(calShareH + 0.34 * dEdge, 0.03, 0.97);
        if (homeScore === awayScore) {
          const dDraw = fD - cur.pD;
          calTot = clamp(calTot * Math.exp(-1.15 * dDraw), 0.02, 4.5);
        } else if (homeScore > awayScore) {
          const dComeback = (fD + fA) - (cur.pD + cur.pA);
          calTot = clamp(calTot * Math.exp(0.85 * dComeback), 0.02, 4.5);
        } else {
          const dComeback = (fD + fH) - (cur.pD + cur.pH);
          calTot = clamp(calTot * Math.exp(0.85 * dComeback), 0.02, 4.5);
        }
      }

      const feedRemH = calTot * calShareH;
      const feedRemA = calTot * (1 - calShareH);
      remH = Math.max(0.003, remH * (1 - wFeed) + feedRemH * wFeed);
      remA = Math.max(0.003, remA * (1 - wFeed) + feedRemA * wFeed);
    }
  }

  const liveMargin = isLive
    ? round2(clamp(baseMargin + (1 - remShare) * 0.035, baseMargin, 1.125))
    : baseMargin;

  const maxAdd = clamp(Math.ceil(Math.max(remH, remA) * 3 + 6), 7, LIVE_MAX_REMAIN);
  const dcScale = Math.pow(remShare, 0.75);
  const remGrid = bivariatePoissonGrid(remH, remA, maxAdd, dcScale);

  const sizeH = homeScore + maxAdd + 1;
  const sizeA = awayScore + maxAdd + 1;
  const finalGrid: number[][] = Array.from({ length: sizeH }, () =>
    new Array<number>(sizeA).fill(0)
  );
  for (let i = 0; i <= maxAdd; i++) {
    for (let j = 0; j <= maxAdd; j++) {
      finalGrid[homeScore + i][awayScore + j] = remGrid[i][j];
    }
  }

  return { grid: finalGrid, margin: liveMargin, lamH: remH, lamA: remA };
}

/**
 * Synthétise une chronologie déterministe 1ère / 2ème période à partir d'un score mi-temps
 * officiel lorsque le flux ne fournit que les scores par période (`linescores`) sans le détail
 * individuel de chaque buteur.
 */
export function synthesizeEventsFromHtScore(
  homeScore: number,
  awayScore: number,
  htHomeScore: number,
  htAwayScore: number
): MatchTimelineEvent[] {
  const fh = Math.max(0, Math.round(homeScore));
  const fa = Math.max(0, Math.round(awayScore));
  const hh = clamp(Math.round(htHomeScore), 0, fh);
  const ha = clamp(Math.round(htAwayScore), 0, fa);

  const out: MatchTimelineEvent[] = [];
  for (let i = 0; i < hh; i++) {
    out.push({ type: "goal", team: "home", minute: Math.min(44, 14 + i * 11) });
  }
  for (let i = 0; i < ha; i++) {
    out.push({ type: "goal", team: "away", minute: Math.min(45, 19 + i * 11) });
  }
  for (let i = 0; i < fh - hh; i++) {
    out.push({ type: "goal", team: "home", minute: Math.min(89, 54 + i * 10) });
  }
  for (let i = 0; i < fa - ha; i++) {
    out.push({ type: "goal", team: "away", minute: Math.min(90, 59 + i * 10) });
  }
  return out;
}

/**
 * Indique si le journal d'événements (ou le score mi-temps officiel `htHomeScore`/`htAwayScore`)
 * couvre exactement le score final du match réel sans recourir à un tirage aléatoire.
 */
export function hasVerifiedGoalTimeline(
  homeScore: number,
  awayScore: number,
  events?: MatchTimelineEvent[] | null,
  htHomeScore?: number | null,
  htAwayScore?: number | null
): boolean {
  const h = Math.max(0, Math.round(homeScore));
  const a = Math.max(0, Math.round(awayScore));
  if (h === 0 && a === 0) return true;
  if (
    htHomeScore != null &&
    htAwayScore != null &&
    Number.isFinite(htHomeScore) &&
    Number.isFinite(htAwayScore) &&
    htHomeScore >= 0 &&
    htAwayScore >= 0 &&
    htHomeScore <= h &&
    htAwayScore <= a
  ) {
    return true;
  }
  const cleanEvents = sanitizeMatchEvents(events, h, a);
  const goals = cleanEvents.filter(
    (e) => e.type === "goal" && (e.team === "home" || e.team === "away")
  );
  const evH = goals.filter((g) => g.team === "home").length;
  const evA = goals.filter((g) => g.team === "away").length;
  return evH === h && evA === a;
}

/**
 * Modèle Mi-Temps / 2ème période dédié aux matchs réels reliés au flux officiel :
 * calibré uniquement sur les cotes 1x2 de l'admin et le score/minute officiels (0 RNG, 0 ML virtuel).
 */
export function realMatchHalfSplitModel(params: {
  oddsHome: number;
  oddsDraw: number | null;
  oddsAway: number;
  homeScore?: number | null;
  awayScore?: number | null;
  minute?: number;
  minuteLabel?: string | null;
  isLive?: boolean;
  redHome?: number;
  redAway?: number;
  htHomeScore?: number | null;
  htAwayScore?: number | null;
  events?: MatchTimelineEvent[] | null;
  realStats?: RealMatchLiveStatsInput | null;
  ftModel?: LiveScoreModel;
}): LiveHalfSplitModel {
  const homeScore = Math.max(0, Math.round(params.homeScore ?? 0));
  const awayScore = Math.max(0, Math.round(params.awayScore ?? 0));
  const isLive = Boolean(params.isLive);
  const minute = clamp(Math.round(params.minute ?? 0), 0, 90);
  const fullModel =
    params.ftModel ??
    realMatchScoreModel({
      oddsHome: params.oddsHome,
      oddsDraw: params.oddsDraw,
      oddsAway: params.oddsAway,
      homeScore,
      awayScore,
      minute,
      minuteLabel: params.minuteLabel,
      isLive,
      redHome: params.redHome,
      redAway: params.redAway,
      events: params.events,
      realStats: params.realStats,
    });

  // Récupère les taux 90 min (0-0) calibrés sur les cotes admin
  const preModel =
    !isLive && homeScore === 0 && awayScore === 0 && minute === 0
      ? fullModel
      : realMatchScoreModel({
          oddsHome: params.oddsHome,
          oddsDraw: params.oddsDraw,
          oddsAway: params.oddsAway,
          homeScore: 0,
          awayScore: 0,
          minute: 0,
          isLive: false,
          redHome: params.redHome,
          redAway: params.redAway,
        });

  let lastIncidentMin = 0;
  if (Array.isArray(params.events)) {
    for (const ev of params.events) {
      if (ev.minute > lastIncidentMin) lastIncidentMin = ev.minute;
    }
  }

  const baseH = preModel.lamH;
  const baseA = preModel.lamA;
  const pMin = isLive
    ? livePricingMinute(minute, { isReal: true, lastIncidentMin })
    : 0;
  const htShare = goalTimeCDF(45);

  let htGrid: number[][];
  let h2Grid: number[][];

  const cleanParamEvents = sanitizeMatchEvents(
    params.events,
    homeScore,
    awayScore
  );

  if (!isLive || minute < 45) {
    const cur1H = isLive ? homeScore : 0;
    const cur1A = isLive ? awayScore : 0;
    const rem1Share = isLive ? Math.max(0.002, htShare - goalTimeCDF(pMin)) : htShare;
    const lam1H = Math.max(0.002, baseH * rem1Share);
    const lam1A = Math.max(0.002, baseA * rem1Share);
    const max1 = 7;
    const rem1 = bivariatePoissonGrid(
      lam1H,
      lam1A,
      max1,
      !isLive && cur1H === 0 && cur1A === 0
    );
    htGrid = Array.from({ length: cur1H + max1 + 1 }, () =>
      new Array<number>(cur1A + max1 + 1).fill(0)
    );
    for (let i = 0; i <= max1; i++) {
      for (let j = 0; j <= max1; j++) {
        htGrid[cur1H + i][cur1A + j] = rem1[i][j];
      }
    }

    const lam2H = Math.max(0.003, baseH * (1 - htShare));
    const lam2A = Math.max(0.003, baseA * (1 - htShare));
    h2Grid = bivariatePoissonGrid(lam2H, lam2A, 8, false);
  } else {
    const goals = cleanParamEvents.filter(
      (e) => e.type === "goal" && (e.team === "home" || e.team === "away")
    );
    const fixed1H = clamp(
      params.htHomeScore != null
        ? params.htHomeScore
        : goals.filter((g) => g.team === "home" && g.minute <= 45).length,
      0,
      homeScore
    );
    const fixed1A = clamp(
      params.htAwayScore != null
        ? params.htAwayScore
        : goals.filter((g) => g.team === "away" && g.minute <= 45).length,
      0,
      awayScore
    );
    htGrid = Array.from({ length: fixed1H + 1 }, () => new Array<number>(fixed1A + 1).fill(0));
    htGrid[fixed1H][fixed1A] = 1;

    const cur2H = Math.max(0, homeScore - fixed1H);
    const cur2A = Math.max(0, awayScore - fixed1A);
    const max2 = pMin >= 90 ? 2 : 7;
    const rem2 = bivariatePoissonGrid(fullModel.lamH, fullModel.lamA, max2, false);
    h2Grid = Array.from({ length: cur2H + max2 + 1 }, () =>
      new Array<number>(cur2A + max2 + 1).fill(0)
    );
    for (let i = 0; i <= max2; i++) {
      for (let j = 0; j <= max2; j++) {
        h2Grid[cur2H + i][cur2A + j] = rem2[i][j];
      }
    }
  }

  let htHomeP = 0;
  let htDrawP = 0;
  let htAwayP = 0;
  const maxTot1 = htGrid.length + (htGrid[0]?.length ?? 1);
  const tot1 = new Array<number>(maxTot1).fill(0);
  const diff1ByHt: Record<"1" | "X" | "2", Map<number, number>> = {
    "1": new Map(),
    X: new Map(),
    "2": new Map(),
  };

  for (let i = 0; i < htGrid.length; i++) {
    for (let j = 0; j < htGrid[i].length; j++) {
      const p = htGrid[i][j];
      if (p <= 0) continue;
      tot1[i + j] += p;
      const d = i - j;
      if (d > 0) {
        htHomeP += p;
        diff1ByHt["1"].set(d, (diff1ByHt["1"].get(d) ?? 0) + p);
      } else if (d === 0) {
        htDrawP += p;
        diff1ByHt.X.set(0, (diff1ByHt.X.get(0) ?? 0) + p);
      } else {
        htAwayP += p;
        diff1ByHt["2"].set(d, (diff1ByHt["2"].get(d) ?? 0) + p);
      }
    }
  }

  const maxTot2 = h2Grid.length + (h2Grid[0]?.length ?? 1);
  const tot2 = new Array<number>(maxTot2).fill(0);
  const diff2 = new Map<number, number>();
  for (let i = 0; i < h2Grid.length; i++) {
    for (let j = 0; j < h2Grid[i].length; j++) {
      const p = h2Grid[i][j];
      if (p <= 0) continue;
      tot2[i + j] += p;
      const d = i - j;
      diff2.set(d, (diff2.get(d) ?? 0) + p);
    }
  }

  let h1More = 0;
  let hEqual = 0;
  let h2More = 0;
  for (let g1 = 0; g1 < tot1.length; g1++) {
    const p1 = tot1[g1];
    if (p1 <= 0) continue;
    for (let g2 = 0; g2 < tot2.length; g2++) {
      const p2 = tot2[g2];
      if (p2 <= 0) continue;
      const joint = p1 * p2;
      if (g1 > g2) h1More += joint;
      else if (g1 === g2) hEqual += joint;
      else h2More += joint;
    }
  }
  const sumHalf = h1More + hEqual + h2More || 1;

  const htFt: LiveHalfSplitModel["htFt"] = {
    "1_1": 0,
    X_1: 0,
    "2_1": 0,
    "1_X": 0,
    X_X: 0,
    "2_X": 0,
    "1_2": 0,
    X_2: 0,
    "2_2": 0,
  };
  for (const htKey of ["1", "X", "2"] as const) {
    for (const [d1, p1] of diff1ByHt[htKey].entries()) {
      for (const [d2, p2] of diff2.entries()) {
        const ftDiff = d1 + d2;
        const ftKey = ftDiff > 0 ? "1" : ftDiff === 0 ? "X" : "2";
        const comboKey = `${htKey}_${ftKey}` as keyof LiveHalfSplitModel["htFt"];
        htFt[comboKey] += p1 * p2;
      }
    }
  }
  const sumHtFt = Object.values(htFt).reduce((a, b) => a + b, 0) || 1;
  for (const k of Object.keys(htFt) as Array<keyof LiveHalfSplitModel["htFt"]>) {
    htFt[k] /= sumHtFt;
  }

  const goalsSorted = [...cleanParamEvents]
    .filter((e) => e.type === "goal" && (e.team === "home" || e.team === "away"))
    .sort((a, b) => a.minute - b.minute);

  let firstScorer: LiveHalfSplitModel["firstScorer"];
  if (homeScore + awayScore > 0) {
    const knownFirst =
      awayScore === 0
        ? "home"
        : homeScore === 0
          ? "away"
          : goalsSorted[0]?.team === "home" || goalsSorted[0]?.team === "away"
            ? goalsSorted[0].team
            : null;
    if (knownFirst) {
      firstScorer = {
        home: knownFirst === "home" ? 1 : 0,
        none: 0,
        away: knownFirst === "away" ? 1 : 0,
      };
    } else {
      const share = homeScore / (homeScore + awayScore);
      firstScorer = { home: share, none: 0, away: 1 - share };
    }
  } else {
    const pNone = clamp(fullModel.grid[0]?.[0] ?? 0, 0, 0.999);
    const pAny = Math.max(0, 1 - pNone);
    const rateSum = Math.max(1e-6, fullModel.lamH + fullModel.lamA);
    firstScorer = {
      home: pAny * (fullModel.lamH / rateSum),
      none: pNone,
      away: pAny * (fullModel.lamA / rateSum),
    };
  }

  const sumHtRes = htHomeP + htDrawP + htAwayP || 1;
  return {
    htResult: {
      home: htHomeP / sumHtRes,
      draw: htDrawP / sumHtRes,
      away: htAwayP / sumHtRes,
    },
    htOver: (line: number) => {
      let s = 0;
      for (let g = 0; g < tot1.length; g++) {
        if (g > line) s += tot1[g];
      }
      return clamp(s / sumHtRes, 0, 1);
    },
    htFt,
    highestHalf: {
      h1: h1More / sumHalf,
      equal: hEqual / sumHalf,
      h2: h2More / sumHalf,
    },
    firstScorer,
  };
}

/** Probabilités exactes du résultat 1/N/2 issues de la grille unifiée du score final. */
export function liveResultProbs(
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  minute: number,
  opts?: LivePricingOpts
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

export interface MatchTimelineEvent {
  type: string;
  team: string;
  minute: number;
  player?: string;
}

export interface MatchTimelineStats {
  htHome: number;
  htAway: number;
  h2Home: number;
  h2Away: number;
  firstScorer: "home" | "away" | "none";
}

/**
 * Extrait de manière 100 % déterministe les statistiques temporelles d'un match
 * (score à la mi-temps, buts en 2e période, première équipe à avoir marqué)
 * depuis le journal d'événements `events`, avec repli cohérent si un score manuel
 * a été forcé sans journal détaillé.
 */
export function extractMatchTimelineStats(
  homeScore: number,
  awayScore: number,
  events?: MatchTimelineEvent[] | null,
  matchId = 0
): MatchTimelineStats {
  const h = Math.max(0, Math.round(homeScore));
  const a = Math.max(0, Math.round(awayScore));
  if (h === 0 && a === 0) {
    return { htHome: 0, htAway: 0, h2Home: 0, h2Away: 0, firstScorer: "none" };
  }

  const cleanEvents = sanitizeMatchEvents(events, h, a);
  const goals = cleanEvents
    .map((e, idx) => ({ e, idx }))
    .filter(({ e }) => e.type === "goal" && (e.team === "home" || e.team === "away"))
    .sort((x, y) => x.e.minute - y.e.minute || x.idx - y.idx)
    .map(({ e }) => e);

  const evH = goals.filter((g) => g.team === "home").length;
  const evA = goals.filter((g) => g.team === "away").length;

  if (evH === h && evA === a && goals.length > 0) {
    const htHome = goals.filter((g) => g.team === "home" && g.minute <= 45).length;
    const htAway = goals.filter((g) => g.team === "away" && g.minute <= 45).length;
    return {
      htHome,
      htAway,
      h2Home: h - htHome,
      h2Away: a - htAway,
      firstScorer: goals[0].team === "home" ? "home" : "away",
    };
  }

  // Repli déterministe si les événements ne couvrent pas exactement le score forcé
  const rng = mulberry32(hashString(`tl-fallback|${matchId}|${h}|${a}`));
  const htShare = goalTimeCDF(45);

  let htHome = Math.min(h, goals.filter((g) => g.team === "home" && g.minute <= 45).length);
  for (let i = evH; i < h; i++) {
    if (rng() < htShare) htHome++;
  }
  htHome = clamp(htHome, 0, h);

  let htAway = Math.min(a, goals.filter((g) => g.team === "away" && g.minute <= 45).length);
  for (let i = evA; i < a; i++) {
    if (rng() < htShare) htAway++;
  }
  htAway = clamp(htAway, 0, a);

  let firstScorer: "home" | "away";
  if (a === 0) firstScorer = "home";
  else if (h === 0) firstScorer = "away";
  else if (goals.length > 0 && ((goals[0].team === "home" && h > 0) || (goals[0].team === "away" && a > 0))) {
    firstScorer = goals[0].team === "home" ? "home" : "away";
  } else if (htHome > 0 && htAway === 0) {
    firstScorer = "home";
  } else if (htAway > 0 && htHome === 0) {
    firstScorer = "away";
  } else {
    firstScorer = rng() < h / (h + a) ? "home" : "away";
  }

  return {
    htHome,
    htAway,
    h2Home: h - htHome,
    h2Away: a - htAway,
    firstScorer,
  };
}

export interface LiveHalfSplitModel {
  htResult: { home: number; draw: number; away: number };
  /** Probabilité exacte que `htHome + htAway > line`. */
  htOver: (line: number) => number;
  htFt: Record<"1_1" | "X_1" | "2_1" | "1_X" | "X_X" | "2_X" | "1_2" | "X_2" | "2_2", number>;
  highestHalf: { h1: number; equal: number; h2: number };
  firstScorer: { home: number; none: number; away: number };
}

/**
 * Modèle joint rapide Mi-Temps / 2e Période parfaitement cohérent avec `liveScoreModel` :
 * couvre les marchés `1N2 Mi-Temps`, `Plus/Moins Mi-Temps`, `MT / FM`,
 * `Mi-temps la plus prolifique` et `Première équipe à marquer` en avant-match comme en live.
 */
export function liveHalfSplitModel(
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  minute: number,
  opts?: LivePricingOpts & { matchId?: number },
  ftModel?: LiveScoreModel
): LiveHalfSplitModel {
  const fullModel = ftModel ?? liveScoreModel(home, away, homeScore, awayScore, minute, opts);
  const { lambdaHome, lambdaAway } = expectedGoals(home, away, opts?.league);
  let lastIncidentMin = 0;
  if (Array.isArray(opts?.events)) {
    for (const ev of opts.events) {
      if (ev.minute > lastIncidentMin) lastIncidentMin = ev.minute;
    }
  }
  const pMin = livePricingMinute(minute, { isReal: false, lastIncidentMin });
  const htShare = goalTimeCDF(45);

  let baseH = lambdaHome * (opts?.homeForm ?? 1);
  let baseA = lambdaAway * (opts?.awayForm ?? 1);
  const rh = opts?.redHome ?? 0;
  const ra = opts?.redAway ?? 0;
  baseH *= Math.pow(0.65, rh) * Math.pow(1.24, ra);
  baseA *= Math.pow(0.65, ra) * Math.pow(1.24, rh);

  let htGrid: number[][];
  let h2Grid: number[][];

  if (minute < 45) {
    const cur1H = Math.max(0, homeScore);
    const cur1A = Math.max(0, awayScore);
    const rem1Share = Math.max(0.002, htShare - goalTimeCDF(pMin));
    const lam1H = Math.max(0.002, baseH * rem1Share);
    const lam1A = Math.max(0.002, baseA * rem1Share);
    const max1 = 7;
    const rem1 = bivariatePoissonGrid(
      lam1H,
      lam1A,
      max1,
      pMin === 0 && cur1H === 0 && cur1A === 0
    );
    htGrid = Array.from({ length: cur1H + max1 + 1 }, () =>
      new Array<number>(cur1A + max1 + 1).fill(0)
    );
    for (let i = 0; i <= max1; i++) {
      for (let j = 0; j <= max1; j++) {
        htGrid[cur1H + i][cur1A + j] = rem1[i][j];
      }
    }

    const lam2H = Math.max(0.003, baseH * (1 - htShare));
    const lam2A = Math.max(0.003, baseA * (1 - htShare));
    h2Grid = bivariatePoissonGrid(lam2H, lam2A, 8, false);
  } else {
    const tl = extractMatchTimelineStats(homeScore, awayScore, opts?.events, opts?.matchId ?? 0);
    const fixed1H = clamp(tl.htHome, 0, Math.max(0, homeScore));
    const fixed1A = clamp(tl.htAway, 0, Math.max(0, awayScore));
    htGrid = Array.from({ length: fixed1H + 1 }, () => new Array<number>(fixed1A + 1).fill(0));
    htGrid[fixed1H][fixed1A] = 1;

    const cur2H = Math.max(0, homeScore - fixed1H);
    const cur2A = Math.max(0, awayScore - fixed1A);
    const max2 = pMin >= 90 ? 2 : 7;
    const rem2 = bivariatePoissonGrid(fullModel.lamH, fullModel.lamA, max2, false);
    h2Grid = Array.from({ length: cur2H + max2 + 1 }, () =>
      new Array<number>(cur2A + max2 + 1).fill(0)
    );
    for (let i = 0; i <= max2; i++) {
      for (let j = 0; j <= max2; j++) {
        h2Grid[cur2H + i][cur2A + j] = rem2[i][j];
      }
    }
  }

  let htHomeP = 0;
  let htDrawP = 0;
  let htAwayP = 0;
  const maxTot1 = htGrid.length + (htGrid[0]?.length ?? 1);
  const tot1 = new Array<number>(maxTot1).fill(0);
  const minDiff1 = -((htGrid[0]?.length ?? 1) - 1);
  const maxDiff1 = htGrid.length - 1;
  const diff1ByHt: Record<"1" | "X" | "2", Map<number, number>> = {
    "1": new Map(),
    X: new Map(),
    "2": new Map(),
  };

  for (let i = 0; i < htGrid.length; i++) {
    for (let j = 0; j < htGrid[i].length; j++) {
      const p = htGrid[i][j];
      if (p <= 0) continue;
      tot1[i + j] += p;
      const d = i - j;
      if (d > 0) {
        htHomeP += p;
        diff1ByHt["1"].set(d, (diff1ByHt["1"].get(d) ?? 0) + p);
      } else if (d === 0) {
        htDrawP += p;
        diff1ByHt.X.set(0, (diff1ByHt.X.get(0) ?? 0) + p);
      } else {
        htAwayP += p;
        diff1ByHt["2"].set(d, (diff1ByHt["2"].get(d) ?? 0) + p);
      }
    }
  }
  void minDiff1;
  void maxDiff1;

  const maxTot2 = h2Grid.length + (h2Grid[0]?.length ?? 1);
  const tot2 = new Array<number>(maxTot2).fill(0);
  const diff2 = new Map<number, number>();
  for (let i = 0; i < h2Grid.length; i++) {
    for (let j = 0; j < h2Grid[i].length; j++) {
      const p = h2Grid[i][j];
      if (p <= 0) continue;
      tot2[i + j] += p;
      const d = i - j;
      diff2.set(d, (diff2.get(d) ?? 0) + p);
    }
  }

  let h1More = 0;
  let hEqual = 0;
  let h2More = 0;
  for (let g1 = 0; g1 < tot1.length; g1++) {
    const p1 = tot1[g1];
    if (p1 <= 0) continue;
    for (let g2 = 0; g2 < tot2.length; g2++) {
      const p2 = tot2[g2];
      if (p2 <= 0) continue;
      const joint = p1 * p2;
      if (g1 > g2) h1More += joint;
      else if (g1 === g2) hEqual += joint;
      else h2More += joint;
    }
  }
  const sumHalf = h1More + hEqual + h2More || 1;

  const htFt: LiveHalfSplitModel["htFt"] = {
    "1_1": 0,
    X_1: 0,
    "2_1": 0,
    "1_X": 0,
    X_X: 0,
    "2_X": 0,
    "1_2": 0,
    X_2: 0,
    "2_2": 0,
  };
  for (const htKey of ["1", "X", "2"] as const) {
    for (const [d1, p1] of diff1ByHt[htKey].entries()) {
      for (const [d2, p2] of diff2.entries()) {
        const ftDiff = d1 + d2;
        const ftKey = ftDiff > 0 ? "1" : ftDiff === 0 ? "X" : "2";
        const comboKey = `${htKey}_${ftKey}` as keyof LiveHalfSplitModel["htFt"];
        htFt[comboKey] += p1 * p2;
      }
    }
  }
  const sumHtFt = Object.values(htFt).reduce((a, b) => a + b, 0) || 1;
  for (const k of Object.keys(htFt) as Array<keyof LiveHalfSplitModel["htFt"]>) {
    htFt[k] /= sumHtFt;
  }

  let firstScorer: LiveHalfSplitModel["firstScorer"];
  if (homeScore + awayScore > 0) {
    const tl = extractMatchTimelineStats(homeScore, awayScore, opts?.events, opts?.matchId ?? 0);
    firstScorer = {
      home: tl.firstScorer === "home" ? 1 : 0,
      none: 0,
      away: tl.firstScorer === "away" ? 1 : 0,
    };
  } else {
    const pNone = clamp(fullModel.grid[0]?.[0] ?? 0, 0, 0.999);
    const pAny = Math.max(0, 1 - pNone);
    const rateSum = Math.max(1e-6, fullModel.lamH + fullModel.lamA);
    firstScorer = {
      home: pAny * (fullModel.lamH / rateSum),
      none: pNone,
      away: pAny * (fullModel.lamA / rateSum),
    };
  }

  const sumHtRes = htHomeP + htDrawP + htAwayP || 1;
  return {
    htResult: {
      home: htHomeP / sumHtRes,
      draw: htDrawP / sumHtRes,
      away: htAwayP / sumHtRes,
    },
    htOver: (line: number) => {
      let s = 0;
      for (let g = 0; g < tot1.length; g++) {
        if (g > line) s += tot1[g];
      }
      return clamp(s / sumHtRes, 0, 1);
    },
    htFt,
    highestHalf: {
      h1: h1More / sumHalf,
      equal: hEqual / sumHalf,
      h2: h2More / sumHalf,
    },
    firstScorer,
  };
}

/** Cotes live du marché Résultat (1/N/2) parfaitement alignées avec tous les autres marchés. */
export function liveOddsFor(
  home: string,
  away: string,
  currentHomeScore: number,
  currentAwayScore: number,
  minute: number,
  opts?: LivePricingOpts
) {
  const model = liveScoreModel(home, away, currentHomeScore, currentAwayScore, minute, opts);
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  for (let i = 0; i < model.grid.length; i++) {
    for (let j = 0; j < model.grid[i].length; j++) {
      const v = model.grid[i][j];
      if (v <= 0) continue;
      if (i > j) pHome += v;
      else if (i === j) pDraw += v;
      else pAway += v;
    }
  }
  const tot = pHome + pDraw + pAway || 1;
  const [rawH, rawD, rawA] = partitionOutcomeOdds(
    [pHome / tot, pDraw / tot, pAway / tot],
    model.margin,
    LIVE_ODDS_MAX
  );
  const cal = (o: number) =>
    round2(clamp(o / getCachedMarketCalibratorMultiplier("result", o), 1.01, LIVE_ODDS_MAX));
  return { oddsHome: cal(rawH), oddsDraw: cal(rawD), oddsAway: cal(rawA) };
}
