import { expectedGoals, poissonPmf } from "@/db/fixtures";

/**
 * Catalogue des marchés de pari.
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

export interface MarketGroup {
  key: string;
  label: string;
  short: string;
  outcomes: MarketOutcome[];
}

export type MarketKey = string;

interface OutcomeSpec {
  key: string;
  label: string;
  short: string;
}

interface MarketDef {
  key: string;
  label: string;
  short: string;
  outcomes: (home: string, away: string) => OutcomeSpec[];
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

function oddsFromProb(p: number) {
  return round2(clamp(1 / (clamp(p, 0.0005, 1) * MARGIN), ODDS_MIN, ODDS_MAX));
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
  overUnder: (line: number) => (o: string, h: number, a: number) =>
    o === "over" ? h + a > line : h + a <= line,
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
  winBy2: (side: "home" | "away") => (o: string, h: number, a: number) => {
    const won = side === "home" ? h - a >= 2 : a - h >= 2;
    return won === (o === "oui");
  },
  teamOver: (side: "home" | "away", line: number) => (o: string, h: number, a: number) => {
    const goals = side === "home" ? h : a;
    return (goals > line) === (o === "oui");
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
      { key: "home", label: `Victoire ${h}`, short: "1" },
      { key: "draw", label: "Match nul", short: "N" },
      { key: "away", label: `Victoire ${a}`, short: "2" },
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
    key: "ou_1_5",
    label: "Total de buts — Plus/Moins 1,5",
    short: "O/U 1,5",
    outcomes: () => [
      { key: "over", label: "Plus de 1,5 buts", short: "Plus 1,5" },
      { key: "under", label: "Moins de 1,5 buts", short: "Moins 1,5" },
    ],
    probs: (lamH, lamA) => {
      const g = joint(lamH, lamA);
      const over = sumOver((i, j) => i + j >= 2, g);
      return [over, 1 - over];
    },
    win: w.overUnder(1.5),
  },
  {
    key: "ou_2_5",
    label: "Total de buts — Plus/Moins 2,5",
    short: "O/U 2,5",
    outcomes: () => [
      { key: "over", label: "Plus de 2,5 buts", short: "Plus 2,5" },
      { key: "under", label: "Moins de 2,5 buts", short: "Moins 2,5" },
    ],
    probs: (lamH, lamA) => {
      const g = joint(lamH, lamA);
      const over = sumOver((i, j) => i + j >= 3, g);
      return [over, 1 - over];
    },
    win: w.overUnder(2.5),
  },
  {
    key: "ou_3_5",
    label: "Total de buts — Plus/Moins 3,5",
    short: "O/U 3,5",
    outcomes: () => [
      { key: "over", label: "Plus de 3,5 buts", short: "Plus 3,5" },
      { key: "under", label: "Moins de 3,5 buts", short: "Moins 3,5" },
    ],
    probs: (lamH, lamA) => {
      const g = joint(lamH, lamA);
      const over = sumOver((i, j) => i + j >= 4, g);
      return [over, 1 - over];
    },
    win: w.overUnder(3.5),
  },
  {
    key: "ou_4_5",
    label: "Total de buts — Plus/Moins 4,5",
    short: "O/U 4,5",
    outcomes: () => [
      { key: "over", label: "Plus de 4,5 buts", short: "Plus 4,5" },
      { key: "under", label: "Moins de 4,5 buts", short: "Moins 4,5" },
    ],
    probs: (lamH, lamA) => {
      const g = joint(lamH, lamA);
      const over = sumOver((i, j) => i + j >= 5, g);
      return [over, 1 - over];
    },
    win: w.overUnder(4.5),
  },
  {
    key: "btts",
    label: "Les deux équipes marquent",
    short: "BTTS",
    outcomes: () => [
      { key: "oui", label: "Les deux équipes marquent", short: "Oui" },
      { key: "non", label: "Les deux équipes ne marquent pas", short: "Non" },
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
    key: "odd_even",
    label: "Total de buts — Pair/Impair",
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
    label: "Nombre exact de buts",
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
    key: "home_to_nil",
    label: "Victoire du domicile sans encaisser",
    short: "Gagne à 0 (D)",
    outcomes: () => [
      { key: "oui", label: "Le domicile gagne sans encaisser", short: "Oui" },
      { key: "non", label: "Le domicile ne gagne pas à 0", short: "Non" },
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
    label: "Victoire de l'extérieur sans encaisser",
    short: "Gagne à 0 (E)",
    outcomes: () => [
      { key: "oui", label: "L'extérieur gagne sans encaisser", short: "Oui" },
      { key: "non", label: "L'extérieur ne gagne pas à 0", short: "Non" },
    ],
    probs: (lamH, lamA) => {
      const g = joint(lamH, lamA);
      const oui = sumOver((i, j) => j > i && i === 0, g);
      return [oui, 1 - oui];
    },
    win: w.toNil("away"),
  },
  {
    key: "home_2plus",
    label: "Le domicile gagne par 2 buts ou plus",
    short: "Gagne +2 (D)",
    outcomes: () => [
      { key: "oui", label: "Le domicile gagne par 2+ buts", short: "Oui" },
      { key: "non", label: "Le domicile gagne par moins de 2 buts", short: "Non" },
    ],
    probs: (lamH, lamA) => {
      const g = joint(lamH, lamA);
      const oui = sumOver((i, j) => i - j >= 2, g);
      return [oui, 1 - oui];
    },
    win: w.winBy2("home"),
  },
  {
    key: "away_2plus",
    label: "L'extérieur gagne par 2 buts ou plus",
    short: "Gagne +2 (E)",
    outcomes: () => [
      { key: "oui", label: "L'extérieur gagne par 2+ buts", short: "Oui" },
      { key: "non", label: "L'extérieur gagne par moins de 2 buts", short: "Non" },
    ],
    probs: (lamH, lamA) => {
      const g = joint(lamH, lamA);
      const oui = sumOver((i, j) => j - i >= 2, g);
      return [oui, 1 - oui];
    },
    win: w.winBy2("away"),
  },
  {
    key: "home_total_0_5",
    label: "Buts du domicile — Plus/Moins 0,5",
    short: "Buts D 0,5",
    outcomes: () => [
      { key: "oui", label: "Le domicile marque au moins un but", short: "Oui" },
      { key: "non", label: "Le domicile ne marque pas", short: "Non" },
    ],
    probs: (lamH, lamA) => {
      const { tail } = dist(lamH);
      return [tail[1], tail[0]];
    },
    win: w.teamOver("home", 0.5),
  },
  {
    key: "home_total_1_5",
    label: "Buts du domicile — Plus/Moins 1,5",
    short: "Buts D 1,5",
    outcomes: () => [
      { key: "oui", label: "2 buts ou plus du domicile", short: "Oui" },
      { key: "non", label: "1 but ou moins du domicile", short: "Non" },
    ],
    probs: (lamH, lamA) => {
      const { tail } = dist(lamH);
      return [tail[2], 1 - tail[2]];
    },
    win: w.teamOver("home", 1.5),
  },
  {
    key: "away_total_0_5",
    label: "Buts de l'extérieur — Plus/Moins 0,5",
    short: "Buts E 0,5",
    outcomes: () => [
      { key: "oui", label: "L'extérieur marque au moins un but", short: "Oui" },
      { key: "non", label: "L'extérieur ne marque pas", short: "Non" },
    ],
    probs: (lamH, lamA) => {
      const { tail } = dist(lamA);
      return [tail[1], tail[0]];
    },
    win: w.teamOver("away", 0.5),
  },
  {
    key: "away_total_1_5",
    label: "Buts de l'extérieur — Plus/Moins 1,5",
    short: "Buts E 1,5",
    outcomes: () => [
      { key: "oui", label: "2 buts ou plus de l'extérieur", short: "Oui" },
      { key: "non", label: "1 but ou moins de l'extérieur", short: "Non" },
    ],
    probs: (lamH, lamA) => {
      const { tail } = dist(lamA);
      return [tail[2], 1 - tail[2]];
    },
    win: w.teamOver("away", 1.5),
  },
  {
    key: "home_clean_sheet",
    label: "Le domicile ne concède aucun but",
    short: "Cage inviolée (D)",
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
    label: "L'extérieur ne concède aucun but",
    short: "Cage inviolée (E)",
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
  {
    key: "result_over_2_5",
    label: "Résultat + total (plus de 2,5 buts)",
    short: "Résultat + 2,5",
    outcomes: () => [
      { key: "home_over", label: "Domicile & plus de 2,5 buts", short: "1 & +2,5" },
      { key: "draw_over", label: "Nul & plus de 2,5 buts", short: "N & +2,5" },
      { key: "away_over", label: "Extérieur & plus de 2,5 buts", short: "2 & +2,5" },
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
  return MARKETS.map((m) => ({
    key: m.key,
    label: m.label,
    short: m.short,
    outcomes: m.outcomes(home, away).map((o, i) => ({
      ...o,
      odds: oddsFromProb(m.probs(lambdaHome, lambdaAway)[i] ?? 0),
    })),
  }));
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
