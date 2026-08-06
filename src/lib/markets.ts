import { expectedGoals, liveOddsFor, liveScoreModel, poissonPmf } from "@/db/fixtures";

/**
 * Catalogue des marchés de pari (terminologie façon 1xbet).
 * Les lignes d'un même marché sont regroupées : « Total de buts (plus/moins) »
 * contient les lignes 1,5 / 2,5 / 3,5 / 4,5 dans le même accordéon.
 * Chaque marché est entièrement résolu à partir du score final (modèle Poisson
 * des matchs virtuels), ce qui permet des cotes cohérentes et un règlement
 * déterministe.
 */

export interface MarketOutcome {
  key: string;
  label: string;
  short: string;
  odds: number;
}

export interface MarketRow {
  label: string;
  outcomes: MarketOutcome[];
}

export interface MarketGroup {
  key: string;
  label: string;
  short: string;
  outcomes: MarketOutcome[];
  rows?: MarketRow[];
}

export type MarketKey = string;

interface OutcomeSpec {
  key: string;
  label: string;
  short: string;
}

interface MarketRowSpec {
  label: string;
  keys: string[];
}

interface MarketDef {
  key: string;
  label: string;
  short: string;
  outcomes: (home: string, away: string) => OutcomeSpec[];
  rows?: (home: string, away: string) => MarketRowSpec[];
  probs: (lamH: number, lamA: number) => number[];
  win: (outcome: string, home: number, away: number) => boolean;
}

const MAX_GOALS = 12;
const MARGIN = 1.06;
const ODDS_MIN = 1.01;
const ODDS_MAX = 1000;

const SCORE_EXACT_LISTED = new Set(["1_0", "2_0", "2_1", "0_0", "1_1", "2_2", "0_1", "0_2", "1_2"]);

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function oddsFromProb(p: number, margin = MARGIN, cap = ODDS_MAX) {
  return round2(clamp(1 / (clamp(p, 0.0005, 1) * margin), ODDS_MIN, cap));
}

/** Distribution de Poisson tronquée + somme cumulée (pour les probabilités). */
function dist(lambda: number): { p: number[]; tail: number[] } {
  const p: number[] = [];
  let acc = 0;
  for (let k = 0; k <= MAX_GOALS; k++) {
    p.push(poissonPmf(k, lambda));
    acc += p[k];
  }
  const tail: number[] = [1];
  for (let k = 0; k <= MAX_GOALS; k++) {
    acc -= p[k];
    tail.push(acc);
  }
  return { p, tail };
}

/** Matrice jointe P(domicile = i, extérieur = j). */
function joint(lamH: number, lamA: number): number[][] {
  const { p: ph } = dist(lamH);
  const { p: pa } = dist(lamA);
  const grid: number[][] = [];
  for (let i = 0; i <= MAX_GOALS; i++) {
    grid[i] = [];
    for (let j = 0; j <= MAX_GOALS; j++) grid[i][j] = ph[i] * pa[j];
  }
  return grid;
}

function sumOver(predicate: (i: number, j: number) => boolean, grid: number[][]) {
  let s = 0;
  for (let i = 0; i <= MAX_GOALS; i++)
    for (let j = 0; j <= MAX_GOALS; j++) if (predicate(i, j)) s += grid[i][j];
  return s;
}

const w = {
  result: (o: string, h: number, a: number) =>
    o === "home" ? h > a : o === "away" ? a > h : h === a,
  doubleChance: (o: string, h: number, a: number) =>
    o === "1X" ? h >= a : o === "X2" ? h <= a : h !== a,
  /** Total de buts — clé type `ou_2_5_over`. */
  totalOU: (o: string, h: number, a: number) => {
    const m = /^ou_(\d+)_(\d+)_(over|under)$/.exec(o);
    if (!m) return false;
    const line = Number(`${m[1]}.${m[2]}`);
    return m[3] === "over" ? h + a > line : h + a <= line;
  },
  btts: (o: string, h: number, a: number) => (h > 0 && a > 0) === (o === "oui"),
  oddEven: (o: string, h: number, a: number) => ((h + a) % 2 === 0) === (o === "pair"),
  totalExact: (o: string, h: number, a: number) =>
    o === "5+" ? h + a >= 5 : h + a === Number(o),
  scoreExact: (o: string, h: number, a: number) => {
    if (o === "other") return !SCORE_EXACT_LISTED.has(`${h}_${a}`);
    return o === `${h}_${a}`;
  },
  toNil: (side: "home" | "away") => (o: string, h: number, a: number) => {
    const won = side === "home" ? h > a && a === 0 : a > h && h === 0;
    return won === (o === "oui");
  },
  /** Buts d'une équipe — clé type `h_1_5_over` (h = domicile, a = extérieur). */
  teamTotal: (side: "h" | "a") => (o: string, h: number, a: number) => {
    const m = /^(h|a)_(\d+)_(\d+)_(over|under)$/.exec(o);
    if (!m || m[1] !== side) return false;
    const line = Number(`${m[2]}.${m[3]}`);
    const goals = side === "h" ? h : a;
    return m[4] === "over" ? goals > line : goals <= line;
  },
  cleanSheet: (side: "home" | "away") => (o: string, h: number, a: number) => {
    const cs = side === "home" ? a === 0 : h === 0;
    return cs === (o === "oui");
  },
  resultOver25: (o: string, h: number, a: number) => {
    if (o === "under") return h + a <= 2;
    const over = h + a >= 3;
    if (o === "home_over") return over && h > a;
    if (o === "draw_over") return over && h === a;
    return over && a > h;
  },
};

const MARKETS: MarketDef[] = [
  {
    key: "result",
    label: "Résultat du match",
    short: "1/N/2",
    outcomes: (h, a) => [
      { key: "home", label: `Victoire du domicile (${h})`, short: "1" },
      { key: "draw", label: "Match nul", short: "X" },
      { key: "away", label: `Victoire de l'extérieur (${a})`, short: "2" },
    ],
    probs: (lamH, lamA) => {
      const g = joint(lamH, lamA);
      const home = sumOver((i, j) => i > j, g);
      const draw = sumOver((i, j) => i === j, g);
      const away = Math.max(0.0005, 1 - home - draw);
      return [home, draw, away];
    },
    win: w.result,
  },
  {
    key: "double_chance",
    label: "Double chance",
    short: "1X/12/X2",
    outcomes: () => [
      { key: "1X", label: "Domicile ou nul (1X)", short: "1X" },
      { key: "12", label: "Domicile ou extérieur (12)", short: "12" },
      { key: "X2", label: "Nul ou extérieur (X2)", short: "X2" },
    ],
    probs: (lamH, lamA) => {
      const g = joint(lamH, lamA);
      const home = sumOver((i, j) => i > j, g);
      const draw = sumOver((i, j) => i === j, g);
      const away = Math.max(0.0005, 1 - home - draw);
      return [home + draw, home + away, draw + away];
    },
    win: w.doubleChance,
  },
  {
    key: "total_ou",
    label: "Total de buts (plus/moins)",
    short: "Plus/Moins",
    outcomes: () => [
      { key: "ou_1_5_over", label: "Plus de 1,5 buts", short: "Plus" },
      { key: "ou_1_5_under", label: "Moins de 1,5 buts", short: "Moins" },
      { key: "ou_2_5_over", label: "Plus de 2,5 buts", short: "Plus" },
      { key: "ou_2_5_under", label: "Moins de 2,5 buts", short: "Moins" },
      { key: "ou_3_5_over", label: "Plus de 3,5 buts", short: "Plus" },
      { key: "ou_3_5_under", label: "Moins de 3,5 buts", short: "Moins" },
      { key: "ou_4_5_over", label: "Plus de 4,5 buts", short: "Plus" },
      { key: "ou_4_5_under", label: "Moins de 4,5 buts", short: "Moins" },
    ],
    rows: () => [
      { label: "1,5", keys: ["ou_1_5_over", "ou_1_5_under"] },
      { label: "2,5", keys: ["ou_2_5_over", "ou_2_5_under"] },
      { label: "3,5", keys: ["ou_3_5_over", "ou_3_5_under"] },
      { label: "4,5", keys: ["ou_4_5_over", "ou_4_5_under"] },
    ],
    probs: (lamH, lamA) => {
      const g = joint(lamH, lamA);
      const over = (line: number) => sumOver((i, j) => i + j > line, g);
      return [over(1.5), 1 - over(1.5), over(2.5), 1 - over(2.5), over(3.5), 1 - over(3.5), over(4.5), 1 - over(4.5)];
    },
    win: w.totalOU,
  },
  {
    key: "odd_even",
    label: "Total de buts (pair/impair)",
    short: "Pair/Impair",
    outcomes: () => [
      { key: "pair", label: "Total de buts pair", short: "Pair" },
      { key: "impair", label: "Total de buts impair", short: "Impair" },
    ],
    probs: (lamH, lamA) => {
      const g = joint(lamH, lamA);
      const pair = sumOver((i, j) => (i + j) % 2 === 0, g);
      return [pair, 1 - pair];
    },
    win: w.oddEven,
  },
  {
    key: "total_exact",
    label: "Total de buts exact",
    short: "Total exact",
    outcomes: () => [
      { key: "0", label: "0 but", short: "0" },
      { key: "1", label: "1 but", short: "1" },
      { key: "2", label: "2 buts", short: "2" },
      { key: "3", label: "3 buts", short: "3" },
      { key: "4", label: "4 buts", short: "4" },
      { key: "5+", label: "5 buts ou plus", short: "5+" },
    ],
    probs: (lamH, lamA) => {
      const g = joint(lamH, lamA);
      const p = [];
      let acc = 0;
      for (let t = 0; t <= 4; t++) {
        const pt = sumOver((i, j) => i + j === t, g);
        p.push(pt);
        acc += pt;
      }
      p.push(Math.max(0.0005, 1 - acc));
      return p;
    },
    win: w.totalExact,
  },
  {
    key: "btts",
    label: "Les deux équipes marquent",
    short: "BTTS",
    outcomes: () => [
      { key: "oui", label: "Oui — les deux équipes marquent", short: "Oui" },
      { key: "non", label: "Non — les deux équipes ne marquent pas", short: "Non" },
    ],
    probs: (lamH, lamA) => {
      const { tail: th } = dist(lamH);
      const { tail: ta } = dist(lamA);
      const oui = th[1] * ta[1];
      return [oui, 1 - oui];
    },
    win: w.btts,
  },
  {
    key: "score_exact",
    label: "Score exact",
    short: "Score exact",
    outcomes: () => [
      { key: "1_0", label: "Score exact 1-0", short: "1-0" },
      { key: "2_0", label: "Score exact 2-0", short: "2-0" },
      { key: "2_1", label: "Score exact 2-1", short: "2-1" },
      { key: "0_0", label: "Score exact 0-0", short: "0-0" },
      { key: "1_1", label: "Score exact 1-1", short: "1-1" },
      { key: "2_2", label: "Score exact 2-2", short: "2-2" },
      { key: "0_1", label: "Score exact 0-1", short: "0-1" },
      { key: "0_2", label: "Score exact 0-2", short: "0-2" },
      { key: "1_2", label: "Score exact 1-2", short: "1-2" },
      { key: "other", label: "Autre score", short: "Autre" },
    ],
    probs: (lamH, lamA) => {
      const g = joint(lamH, lamA);
      const keys = ["1_0", "2_0", "2_1", "0_0", "1_1", "2_2", "0_1", "0_2", "1_2"];
      const listed = keys.map((k) => {
        const [i, j] = k.split("_").map(Number);
        return g[i][j];
      });
      const sumListed = listed.reduce((s, x) => s + x, 0);
      return [...listed, Math.max(0.0005, 1 - sumListed)];
    },
    win: w.scoreExact,
  },
  {
    key: "result_total",
    label: "Résultat + total (2,5)",
    short: "Résultat + 2,5",
    outcomes: () => [
      { key: "home_over", label: "Domicile et plus de 2,5 buts", short: "1 & +2,5" },
      { key: "draw_over", label: "Nul et plus de 2,5 buts", short: "X & +2,5" },
      { key: "away_over", label: "Extérieur et plus de 2,5 buts", short: "2 & +2,5" },
      { key: "under", label: "Moins de 2,5 buts", short: "Moins 2,5" },
    ],
    probs: (lamH, lamA) => {
      const g = joint(lamH, lamA);
      const home = sumOver((i, j) => i > j && i + j >= 3, g);
      const draw = sumOver((i, j) => i === j && i + j >= 3, g);
      const away = sumOver((i, j) => j > i && i + j >= 3, g);
      const under = Math.max(0.0005, 1 - home - draw - away);
      return [home, draw, away, under];
    },
    win: w.resultOver25,
  },
  {
    key: "home_total",
    label: "Buts du domicile (plus/moins)",
    short: "Buts domicile",
    outcomes: () => [
      { key: "h_0_5_over", label: "Le domicile marque plus de 0,5 but", short: "Plus" },
      { key: "h_0_5_under", label: "Le domicile marque moins de 0,5 but", short: "Moins" },
      { key: "h_1_5_over", label: "Le domicile marque plus de 1,5 buts", short: "Plus" },
      { key: "h_1_5_under", label: "Le domicile marque moins de 1,5 buts", short: "Moins" },
    ],
    rows: () => [
      { label: "0,5", keys: ["h_0_5_over", "h_0_5_under"] },
      { label: "1,5", keys: ["h_1_5_over", "h_1_5_under"] },
    ],
    probs: (lamH) => {
      const { p, tail } = dist(lamH);
      return [tail[1], p[0], tail[2], 1 - tail[2]];
    },
    win: w.teamTotal("h"),
  },
  {
    key: "away_total",
    label: "Buts de l'extérieur (plus/moins)",
    short: "Buts extérieur",
    outcomes: () => [
      { key: "a_0_5_over", label: "L'extérieur marque plus de 0,5 but", short: "Plus" },
      { key: "a_0_5_under", label: "L'extérieur marque moins de 0,5 but", short: "Moins" },
      { key: "a_1_5_over", label: "L'extérieur marque plus de 1,5 buts", short: "Plus" },
      { key: "a_1_5_under", label: "L'extérieur marque moins de 1,5 buts", short: "Moins" },
    ],
    rows: () => [
      { label: "0,5", keys: ["a_0_5_over", "a_0_5_under"] },
      { label: "1,5", keys: ["a_1_5_over", "a_1_5_under"] },
    ],
    probs: (lamA) => {
      const { p, tail } = dist(lamA);
      return [tail[1], p[0], tail[2], 1 - tail[2]];
    },
    win: w.teamTotal("a"),
  },
  {
    key: "home_to_nil",
    label: "Victoire à zéro (domicile)",
    short: "Win to nil D",
    outcomes: () => [
      { key: "oui", label: "Le domicile gagne sans encaisser", short: "Oui" },
      { key: "non", label: "Le domicile ne gagne pas sans encaisser", short: "Non" },
    ],
    probs: (lamH, lamA) => {
      const g = joint(lamH, lamA);
      const oui = sumOver((i, j) => i > j && j === 0, g);
      return [oui, 1 - oui];
    },
    win: w.toNil("home"),
  },
  {
    key: "away_to_nil",
    label: "Victoire à zéro (extérieur)",
    short: "Win to nil E",
    outcomes: () => [
      { key: "oui", label: "L'extérieur gagne sans encaisser", short: "Oui" },
      { key: "non", label: "L'extérieur ne gagne pas sans encaisser", short: "Non" },
    ],
    probs: (lamH, lamA) => {
      const g = joint(lamH, lamA);
      const oui = sumOver((i, j) => j > i && i === 0, g);
      return [oui, 1 - oui];
    },
    win: w.toNil("away"),
  },
  {
    key: "home_clean_sheet",
    label: "Cage inviolée (domicile)",
    short: "Clean sheet D",
    outcomes: () => [
      { key: "oui", label: "Le domicile ne concède aucun but", short: "Oui" },
      { key: "non", label: "Le domicile concède au moins un but", short: "Non" },
    ],
    probs: (lamH, lamA) => {
      const { p } = dist(lamA);
      return [p[0], 1 - p[0]];
    },
    win: w.cleanSheet("home"),
  },
  {
    key: "away_clean_sheet",
    label: "Cage inviolée (extérieur)",
    short: "Clean sheet E",
    outcomes: () => [
      { key: "oui", label: "L'extérieur ne concède aucun but", short: "Oui" },
      { key: "non", label: "L'extérieur concède au moins un but", short: "Non" },
    ],
    probs: (lamH, lamA) => {
      const { p } = dist(lamH);
      return [p[0], 1 - p[0]];
    },
    win: w.cleanSheet("away"),
  },
];

const MARKET_BY_KEY = new Map(MARKETS.map((m) => [m.key, m]));

export function isKnownMarket(key: string): boolean {
  return MARKET_BY_KEY.has(key);
}

/** Règlement : une issue est gagnante selon le score final. */
export function marketWin(market: string, outcome: string, home: number, away: number): boolean {
  const def = MARKET_BY_KEY.get(market);
  if (!def) return false;
  return def.win(outcome, home, away);
}

/** Construit tous les marchés avec leurs cotes pour une affiche. */
export function buildMarkets(home: string, away: string): MarketGroup[] {
  const { lambdaHome, lambdaAway } = expectedGoals(home, away);
  return MARKETS.map((m) => {
    const probs = m.probs(lambdaHome, lambdaAway);
    const outcomes = m.outcomes(home, away).map((o, i) => ({
      ...o,
      odds: oddsFromProb(probs[i] ?? 0),
    }));
    const rows = m.rows
      ? m.rows(home, away).map((r) => ({
          label: r.label,
          outcomes: r.keys
            .map((k) => outcomes.find((o) => o.key === k))
            .filter((o): o is MarketOutcome => Boolean(o)),
        }))
      : undefined;
    return { key: m.key, label: m.label, short: m.short, outcomes, rows };
  });
}

/** Cote d'une issue précise (pour la validation serveur d'un pari). */
export function marketOddsFor(market: string, outcome: string, home: string, away: string) {
  const def = MARKET_BY_KEY.get(market);
  if (!def) return null;
  const { lambdaHome, lambdaAway } = expectedGoals(home, away);
  const probs = def.probs(lambdaHome, lambdaAway);
  const idx = def.outcomes(home, away).findIndex((o) => o.key === outcome);
  if (idx < 0) return null;
  return oddsFromProb(probs[idx] ?? 0);
}

/** Libellé d'une issue précise. */
export function marketLabelFor(market: string, outcome: string, home: string, away: string) {
  const def = MARKET_BY_KEY.get(market);
  if (!def) return null;
  return def.outcomes(home, away).find((o) => o.key === outcome)?.label ?? null;
}

/** Somme de la grille des scores finaux sur un prédicat (grille indexée par score final). */
function sumOverLive(predicate: (i: number, j: number) => boolean, grid: number[][]) {
  let s = 0;
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid[i].length; j++) {
      const v = grid[i][j];
      if (v > 0 && predicate(i, j)) s += v;
    }
  }
  return s;
}

/** Vrai si une issue est déjà décidée par le score en cours (gagnée OU impossible). */
export function marketOutcomeSettled(
  market: string,
  outcome: string,
  homeScore: number,
  awayScore: number
): boolean {
  const total = homeScore + awayScore;
  switch (market) {
    case "result":
    case "double_chance":
    case "odd_even":
      return false;
    case "total_ou": {
      const m = /^ou_(\d+)_(\d+)_(over|under)$/.exec(outcome);
      if (!m) return false;
      const line = Number(`${m[1]}.${m[2]}`);
      return total > line;
    }
    case "total_exact": {
      if (outcome === "5+") return total >= 5;
      return total > Number(outcome);
    }
    case "btts":
      return homeScore > 0 && awayScore > 0;
    case "score_exact": {
      if (outcome === "other") return false;
      const [i, j] = outcome.split("_").map(Number);
      return i < homeScore || j < awayScore;
    }
    case "result_total":
      return outcome === "under" && total >= 3;
    case "home_total":
      return teamTotalSettled(outcome, homeScore, "h");
    case "away_total":
      return teamTotalSettled(outcome, awayScore, "a");
    case "home_to_nil":
    case "home_clean_sheet":
      return awayScore >= 1;
    case "away_to_nil":
    case "away_clean_sheet":
      return homeScore >= 1;
    default:
      return false;
  }
}

function teamTotalSettled(outcome: string, goals: number, side: "h" | "a"): boolean {
  const m = /^(h|a)_(\d+)_(\d+)_(over|under)$/.exec(outcome);
  if (!m || m[1] !== side) return false;
  const line = Number(`${m[2]}.${m[3]}`);
  return goals > line;
}

/**
 * Construit les marchés d'un match en direct avec les cotes live :
 * - les issues déjà décidées (gagnées ou devenues impossibles) sont retirées —
 *   seules les options encore ouvertes restent affichées ;
 * - chaque marché est coté sur la même grille de scores finaux (modèle live),
 *   avec la marge bookmaker dynamique ;
 * - le marché Résultat reprend exactement les cotes 1/N/2 du moteur (cohérence
 *   cartes / feuille de marchés).
 */
export function buildLiveMarkets(
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  minute: number
): MarketGroup[] {
  const live = liveOddsFor(home, away, homeScore, awayScore, minute);
  const { grid, margin } = liveScoreModel(home, away, homeScore, awayScore, minute);

  return MARKETS.map((m): MarketGroup | null => {
    const open = m
      .outcomes(home, away)
      .filter((o) => !marketOutcomeSettled(m.key, o.key, homeScore, awayScore));
    if (open.length === 0) return null;

    const priced: MarketOutcome[] = open.map((o) => {
      let odds: number;
      if (m.key === "result") {
        odds =
          o.key === "home" ? live.oddsHome : o.key === "draw" ? live.oddsDraw : live.oddsAway;
      } else {
        const p = sumOverLive((i, j) => m.win(o.key, i, j), grid);
        odds = oddsFromProb(p, margin);
      }
      return { ...o, odds };
    });

    const rows = m.rows
      ? m
          .rows(home, away)
          .map((r) => ({
            label: r.label,
            outcomes: priced.filter((o) => r.keys.includes(o.key)),
          }))
          .filter((r) => r.outcomes.length > 0)
      : undefined;

    return { key: m.key, label: m.label, short: m.short, outcomes: priced, rows };
  }).filter((g): g is MarketGroup => g !== null);
}

/**
 * Cote serveur d'une issue en direct (validation anti-triche) : null si le marché
 * est inconnu, l'issue introuvable ou déjà décidée. Le serveur recote TOUJOURS le
 * pari au moment de la validation — jamais la cote envoyée par le client.
 */
export function liveMarketOddsFor(
  market: string,
  outcome: string,
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  minute: number
): number | null {
  const def = MARKET_BY_KEY.get(market);
  if (!def) return null;
  if (marketOutcomeSettled(market, outcome, homeScore, awayScore)) return null;
  const idx = def.outcomes(home, away).findIndex((o) => o.key === outcome);
  if (idx < 0) return null;

  if (market === "result") {
    const live = liveOddsFor(home, away, homeScore, awayScore, minute);
    return outcome === "home" ? live.oddsHome : outcome === "draw" ? live.oddsDraw : live.oddsAway;
  }

  const { grid, margin } = liveScoreModel(home, away, homeScore, awayScore, minute);
  const p = sumOverLive((i, j) => def.win(outcome, i, j), grid);
  return oddsFromProb(p, margin);
}

/** Minute numérique depuis le libellé du moteur (« 37' » → 37, null → 1). */
export function minuteNumber(minute: string | null): number {
  const m = minute ? /^\d+/.exec(minute) : null;
  const n = m ? parseInt(m[0], 10) : 1;
  return Math.max(1, Math.min(90, n));
}
