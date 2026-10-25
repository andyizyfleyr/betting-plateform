import {
  binaryOutcomeOdds,
  liveResultProbs,
  liveScoreModel,
  partitionOutcomeOdds,
  type LiveScoreModel,
} from "@/db/fixtures";
import { adjustOddsForExposure, marginOverround, netExposure, type BetLike } from "./risk";

export type MarketCategory = "main" | "goals" | "teams" | "scores";

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
  category?: MarketCategory;
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
  category: MarketCategory;
  /** true si les issues du marché entier forment une partition exclusive (somme des probs = 1). */
  partition: boolean;
  outcomes: (home: string, away: string) => OutcomeSpec[];
  rows?: (home: string, away: string) => MarketRowSpec[];
  win: (outcome: string, home: number, away: number) => boolean;
}

const SCORE_EXACT_LISTED = new Set([
  "1_0", "2_0", "2_1",
  "0_0", "1_1", "2_2",
  "0_1", "0_2", "1_2",
  "3_0", "3_1", "0_3", "1_3",
]);

const MARKET_MAX_ODDS: Record<string, number> = {
  result: 120,
  double_chance: 25,
  total_exact: 90,
  score_exact: 150,
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Marge effective d'un marché = marge de base (avant-match ou live) × ratio de liquidité du marché. */
function effectiveMargin(market: string, baseMargin = 1.045): number {
  return Math.round(baseMargin * (marginOverround(market) / marginOverround("result")) * 10000) / 10000;
}

/** Applique la correction d'exposition du bookmaker après cotation probabiliste. */
function exposureAdjustedOdds(
  market: string,
  outcome: string,
  modelOdds: number,
  bets?: BetLike[]
): number {
  if (!bets || bets.length === 0) return modelOdds;
  return adjustOddsForExposure(modelOdds, netExposure(bets, market, outcome));
}

const w = {
  result: (o: string, h: number, a: number) =>
    o === "home" ? h > a : o === "away" ? a > h : h === a,
  doubleChance: (o: string, h: number, a: number) =>
    o === "1X" ? h >= a : o === "X2" ? h <= a : h !== a,
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
    category: "main",
    partition: true,
    outcomes: (h, a) => [
      { key: "home", label: `Victoire ${h}`, short: "1" },
      { key: "draw", label: "Match nul", short: "N" },
      { key: "away", label: `Victoire ${a}`, short: "2" },
    ],
    win: w.result,
  },
  {
    key: "double_chance",
    label: "Double chance",
    short: "1X/12/X2",
    category: "main",
    partition: false,
    outcomes: (h, a) => [
      { key: "1X", label: `${h} ou Nul`, short: "1X" },
      { key: "12", label: `${h} ou ${a}`, short: "12" },
      { key: "X2", label: `Nul ou ${a}`, short: "X2" },
    ],
    win: w.doubleChance,
  },
  {
    key: "total_ou",
    label: "Total de buts (Plus / Moins)",
    short: "Plus/Moins",
    category: "main",
    partition: false, // Coté ligne par ligne (chaque ligne 1,5 / 2,5 / 3,5 / 4,5 est une partition binaire)
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
    win: w.totalOU,
  },
  {
    key: "btts",
    label: "Les deux équipes marquent",
    short: "BTTS",
    category: "main",
    partition: true,
    outcomes: () => [
      { key: "oui", label: "Les deux équipes marquent : Oui", short: "Oui" },
      { key: "non", label: "Les deux équipes marquent : Non", short: "Non" },
    ],
    win: w.btts,
  },
  {
    key: "result_total",
    label: "Résultat & Total (2,5 buts)",
    short: "1N2 + 2,5",
    category: "main",
    partition: true,
    outcomes: (h, a) => [
      { key: "home_over", label: `${h} & +2,5 buts`, short: "1 & +2,5" },
      { key: "draw_over", label: "Nul & +2,5 buts", short: "N & +2,5" },
      { key: "away_over", label: `${a} & +2,5 buts`, short: "2 & +2,5" },
      { key: "under", label: "Moins de 2,5 buts", short: "Moins 2,5" },
    ],
    win: w.resultOver25,
  },
  {
    key: "home_total",
    label: "Buts équipe domicile",
    short: "Buts dom.",
    category: "teams",
    partition: false,
    outcomes: (h) => [
      { key: "h_0_5_over", label: `${h} : Plus de 0,5 but`, short: "Plus" },
      { key: "h_0_5_under", label: `${h} : Moins de 0,5 but`, short: "Moins" },
      { key: "h_1_5_over", label: `${h} : Plus de 1,5 buts`, short: "Plus" },
      { key: "h_1_5_under", label: `${h} : Moins de 1,5 buts`, short: "Moins" },
    ],
    rows: () => [
      { label: "0,5", keys: ["h_0_5_over", "h_0_5_under"] },
      { label: "1,5", keys: ["h_1_5_over", "h_1_5_under"] },
    ],
    win: w.teamTotal("h"),
  },
  {
    key: "away_total",
    label: "Buts équipe extérieur",
    short: "Buts ext.",
    category: "teams",
    partition: false,
    outcomes: (_, a) => [
      { key: "a_0_5_over", label: `${a} : Plus de 0,5 but`, short: "Plus" },
      { key: "a_0_5_under", label: `${a} : Moins de 0,5 but`, short: "Moins" },
      { key: "a_1_5_over", label: `${a} : Plus de 1,5 buts`, short: "Plus" },
      { key: "a_1_5_under", label: `${a} : Moins de 1,5 buts`, short: "Moins" },
    ],
    rows: () => [
      { label: "0,5", keys: ["a_0_5_over", "a_0_5_under"] },
      { label: "1,5", keys: ["a_1_5_over", "a_1_5_under"] },
    ],
    win: w.teamTotal("a"),
  },
  {
    key: "total_exact",
    label: "Nombre exact de buts",
    short: "Total exact",
    category: "goals",
    partition: true,
    outcomes: () => [
      { key: "0", label: "0 but dans le match", short: "0" },
      { key: "1", label: "1 but dans le match", short: "1" },
      { key: "2", label: "2 buts dans le match", short: "2" },
      { key: "3", label: "3 buts dans le match", short: "3" },
      { key: "4", label: "4 buts dans le match", short: "4" },
      { key: "5+", label: "5 buts ou plus", short: "5+" },
    ],
    win: w.totalExact,
  },
  {
    key: "odd_even",
    label: "Total de buts Pair / Impair",
    short: "Pair/Impair",
    category: "goals",
    partition: true,
    outcomes: () => [
      { key: "pair", label: "Total de buts pair", short: "Pair" },
      { key: "impair", label: "Total de buts impair", short: "Impair" },
    ],
    win: w.oddEven,
  },
  {
    key: "home_to_nil",
    label: "Domicile gagne sans encaisser",
    short: "Dom. à zéro",
    category: "teams",
    partition: true,
    outcomes: (h) => [
      { key: "oui", label: `${h} gagne sans encaisser : Oui`, short: "Oui" },
      { key: "non", label: `${h} gagne sans encaisser : Non`, short: "Non" },
    ],
    win: w.toNil("home"),
  },
  {
    key: "away_to_nil",
    label: "Extérieur gagne sans encaisser",
    short: "Ext. à zéro",
    category: "teams",
    partition: true,
    outcomes: (_, a) => [
      { key: "oui", label: `${a} gagne sans encaisser : Oui`, short: "Oui" },
      { key: "non", label: `${a} gagne sans encaisser : Non`, short: "Non" },
    ],
    win: w.toNil("away"),
  },
  {
    key: "home_clean_sheet",
    label: "Cage inviolée (domicile)",
    short: "Clean sheet D",
    category: "teams",
    partition: true,
    outcomes: (h) => [
      { key: "oui", label: `Cage inviolée ${h} : Oui`, short: "Oui" },
      { key: "non", label: `Cage inviolée ${h} : Non`, short: "Non" },
    ],
    win: w.cleanSheet("home"),
  },
  {
    key: "away_clean_sheet",
    label: "Cage inviolée (extérieur)",
    short: "Clean sheet E",
    category: "teams",
    partition: true,
    outcomes: (_, a) => [
      { key: "oui", label: `Cage inviolée ${a} : Oui`, short: "Oui" },
      { key: "non", label: `Cage inviolée ${a} : Non`, short: "Non" },
    ],
    win: w.cleanSheet("away"),
  },
  {
    key: "score_exact",
    label: "Score exact",
    short: "Score exact",
    category: "scores",
    partition: true,
    outcomes: () => [
      { key: "1_0", label: "Score exact 1-0", short: "1-0" },
      { key: "0_0", label: "Score exact 0-0", short: "0-0" },
      { key: "0_1", label: "Score exact 0-1", short: "0-1" },
      { key: "2_0", label: "Score exact 2-0", short: "2-0" },
      { key: "1_1", label: "Score exact 1-1", short: "1-1" },
      { key: "0_2", label: "Score exact 0-2", short: "0-2" },
      { key: "2_1", label: "Score exact 2-1", short: "2-1" },
      { key: "2_2", label: "Score exact 2-2", short: "2-2" },
      { key: "1_2", label: "Score exact 1-2", short: "1-2" },
      { key: "3_0", label: "Score exact 3-0", short: "3-0" },
      { key: "3_1", label: "Score exact 3-1", short: "3-1" },
      { key: "0_3", label: "Score exact 0-3", short: "0-3" },
      { key: "1_3", label: "Score exact 1-3", short: "1-3" },
      { key: "other", label: "Autre score", short: "Autre score" },
    ],
    win: w.scoreExact,
  },
];

const MARKET_BY_KEY = new Map(MARKETS.map((m) => [m.key, m]));

export function isKnownMarket(key: string): boolean {
  return MARKET_BY_KEY.has(key);
}

/** Somme exacte de la probabilité sur la grille finale [finalHome][finalAway]. */
function rawProbOnModel(m: MarketDef, outcomeKey: string, model: LiveScoreModel): number {
  let prob = 0;
  for (let h = 0; h < model.grid.length; h++) {
    const row = model.grid[h];
    for (let a = 0; a < row.length; a++) {
      const cell = row[a];
      if (cell > 0 && m.win(outcomeKey, h, a)) {
        prob += cell;
      }
    }
  }
  return prob;
}

/** Extrait la minute numérique depuis un libellé (« 37' » → 37, « MT » → 45, « 90+2' » → 90). */
export function minuteNumber(minute: string | null | undefined): number {
  if (!minute) return 0;
  const trimmed = minute.trim().toUpperCase();
  if (trimmed === "MT" || trimmed === "HT" || trimmed.includes("MI-TEMPS")) return 45;
  const plus = /^(\d+)\s*\+\s*\d+/.exec(trimmed);
  if (plus) return Math.max(0, Math.min(90, parseInt(plus[1], 10)));
  const m = /^\d+/.exec(trimmed);
  const n = m ? parseInt(m[0], 10) : 0;
  return Math.max(0, Math.min(90, n));
}

function maxReachableAdditionalGoals(minute: number): number {
  if (minute >= 90) return 0;
  const remaining = Math.max(1, 90 - minute);
  return Math.min(12, Math.max(2, Math.ceil(remaining / 5) + 1));
}

/**
 * Retourne `true` si l'issue est déjà mathématiquement décidée (acquise ou devenue impossible)
 * au vu du score actuel et du temps restant.
 */
export function marketOutcomeSettled(
  market: string,
  outcome: string,
  homeScore: number,
  awayScore: number,
  minute: string | number | null | undefined
): boolean {
  const def = MARKET_BY_KEY.get(market);
  if (!def) return false;
  if (!def.outcomes("Domicile", "Extérieur").some((o) => o.key === outcome)) return false;

  const min = typeof minute === "number" ? minute : minuteNumber(minute);
  if (min >= 90) return true;

  const maxAdd = maxReachableAdditionalGoals(min);
  let sawTrue = false;
  let sawFalse = false;

  for (let addH = 0; addH <= maxAdd; addH++) {
    for (let addA = 0; addH + addA <= maxAdd; addA++) {
      if (def.win(outcome, homeScore + addH, awayScore + addA)) sawTrue = true;
      else sawFalse = true;
      if (sawTrue && sawFalse) return false;
    }
  }
  return true;
}

/**
 * Construit un marché complet (avant-match ou live) à partir du modèle joint unifié.
 */
function buildMarketGroup(
  m: MarketDef,
  home: string,
  away: string,
  model: LiveScoreModel,
  homeScore: number,
  awayScore: number,
  minute: number,
  isLive: boolean,
  bets?: BetLike[]
): MarketGroup | null {
  const overround = effectiveMargin(m.key, model.margin);
  const maxOdds = MARKET_MAX_ODDS[m.key] ?? 65;
  const specs = m.outcomes(home, away);

  // Cas 1 : marché structuré en lignes Plus/Moins (total_ou, home_total, away_total)
  if (m.rows) {
    const rowSpecs = m.rows(home, away);
    const builtRows: MarketRow[] = [];
    const builtOutcomes: MarketOutcome[] = [];

    for (const rSpec of rowSpecs) {
      const rowEntries = rSpec.keys
        .map((k) => specs.find((s) => s.key === k))
        .filter((s): s is OutcomeSpec => Boolean(s))
        .map((s) => {
          const prob = rawProbOnModel(m, s.key, model);
          const settled = isLive
            ? marketOutcomeSettled(m.key, s.key, homeScore, awayScore, minute) ||
              prob < 0.0015 ||
              prob > 0.994
            : false;
          return { spec: s, prob, settled };
        });

      // Si une issue d'une ligne Plus/Moins est décidée, toute la ligne est retirée
      if (rowEntries.length < 2 || rowEntries.some((e) => e.settled)) continue;

      const oddsPair = partitionOutcomeOdds(
        rowEntries.map((e) => e.prob),
        overround,
        maxOdds
      );
      const rowOutcomes: MarketOutcome[] = rowEntries.map((e, idx) => ({
        key: e.spec.key,
        label: e.spec.label,
        short: e.spec.short,
        odds: exposureAdjustedOdds(m.key, e.spec.key, oddsPair[idx], bets),
      }));

      builtRows.push({ label: rSpec.label, outcomes: rowOutcomes });
      builtOutcomes.push(...rowOutcomes);
    }

    if (builtRows.length === 0) return null;
    return {
      key: m.key,
      label: m.label,
      short: m.short,
      category: m.category,
      outcomes: builtOutcomes,
      rows: builtRows,
    };
  }

  // Cas 2 : marché standard sans sous-lignes
  const entries = specs.map((s) => {
    const prob = rawProbOnModel(m, s.key, model);
    const settled = isLive
      ? marketOutcomeSettled(m.key, s.key, homeScore, awayScore, minute) ||
        prob < 0.0012 ||
        prob > 0.994
      : false;
    return { spec: s, prob, settled };
  });

  // Sur les marchés binaires Oui/Non ou Pair/Impair, on retire la paire complète si un côté est décidé
  if (m.partition && specs.length === 2 && entries.some((e) => e.settled)) {
    return null;
  }

  const open = entries.filter((e) => !e.settled);
  if (open.length === 0) return null;

  let outcomes: MarketOutcome[];
  if (m.partition && open.length >= 2) {
    const sumOpen = open.reduce((acc, e) => acc + e.prob, 0);
    if (sumOpen > 0.96) {
      const oddsList = partitionOutcomeOdds(
        open.map((e) => e.prob / sumOpen),
        overround,
        maxOdds
      );
      outcomes = open.map((e, idx) => ({
        key: e.spec.key,
        label: e.spec.label,
        short: e.spec.short,
        odds: exposureAdjustedOdds(m.key, e.spec.key, oddsList[idx], bets),
      }));
    } else {
      outcomes = open.map((e) => ({
        key: e.spec.key,
        label: e.spec.label,
        short: e.spec.short,
        odds: exposureAdjustedOdds(
          m.key,
          e.spec.key,
          binaryOutcomeOdds(e.prob, overround, maxOdds),
          bets
        ),
      }));
    }
  } else {
    outcomes = open.map((e) => ({
      key: e.spec.key,
      label: e.spec.label,
      short: e.spec.short,
      odds: exposureAdjustedOdds(
        m.key,
        e.spec.key,
        binaryOutcomeOdds(e.prob, overround, maxOdds),
        bets
      ),
    }));
  }

  return {
    key: m.key,
    label: m.label,
    short: m.short,
    category: m.category,
    outcomes,
  };
}

export function buildMarkets(home: string, away: string, bets?: BetLike[]): MarketGroup[] {
  const model = liveScoreModel(home, away, 0, 0, 0);
  const out: MarketGroup[] = [];
  for (const m of MARKETS) {
    const grp = buildMarketGroup(m, home, away, model, 0, 0, 0, false, bets);
    if (grp) out.push(grp);
  }
  return out;
}

export function buildLiveMarkets(
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  minute: number,
  opts?: { homeForm?: number; awayForm?: number; redHome?: number; redAway?: number },
  bets?: BetLike[]
): MarketGroup[] {
  const model = liveScoreModel(home, away, homeScore, awayScore, minute, opts);
  const out: MarketGroup[] = [];
  for (const m of MARKETS) {
    const grp = buildMarketGroup(m, home, away, model, homeScore, awayScore, minute, true, bets);
    if (grp) out.push(grp);
  }
  return out;
}

export function marketOddsFor(
  market: string,
  outcome: string,
  home: string,
  away: string,
  bets?: BetLike[]
): number | null {
  const def = MARKET_BY_KEY.get(market);
  if (!def) return null;
  const model = liveScoreModel(home, away, 0, 0, 0);
  const grp = buildMarketGroup(def, home, away, model, 0, 0, 0, false, bets);
  return grp?.outcomes.find((o) => o.key === outcome)?.odds ?? null;
}

export function liveMarketOddsFor(
  market: string,
  outcome: string,
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  minute: number,
  opts?: { homeForm?: number; awayForm?: number; redHome?: number; redAway?: number },
  bets?: BetLike[]
): number | null {
  const def = MARKET_BY_KEY.get(market);
  if (!def) return null;
  const model = liveScoreModel(home, away, homeScore, awayScore, minute, opts);
  const grp = buildMarketGroup(def, home, away, model, homeScore, awayScore, minute, true, bets);
  return grp?.outcomes.find((o) => o.key === outcome)?.odds ?? null;
}

export function marketLabelFor(
  market: string,
  outcome: string,
  home: string,
  away: string
): string | null {
  const def = MARKET_BY_KEY.get(market);
  if (!def) return null;
  const spec = def.outcomes(home, away).find((o) => o.key === outcome);
  return spec ? spec.label : null;
}

export function marketWin(
  market: string,
  outcome: string,
  homeScore: number,
  awayScore: number
): boolean {
  const def = MARKET_BY_KEY.get(market);
  if (!def) return false;
  return def.win(outcome, homeScore, awayScore);
}

export function closingOddsFor(
  market: string,
  outcome: string,
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  opts?: { homeForm?: number; awayForm?: number; redHome?: number; redAway?: number }
): number | null {
  const def = MARKET_BY_KEY.get(market);
  if (!def) return null;
  if (!def.outcomes(home, away).some((o) => o.key === outcome)) return null;

  const model = liveScoreModel(home, away, 0, 0, 0, opts);
  const overround = effectiveMargin(market, model.margin);
  const prob = rawProbOnModel(def, outcome, model);
  if (prob <= 0) return null;
  return binaryOutcomeOdds(prob, overround, 250);
}

export function liveOutcomeProbability(
  market: string,
  outcome: string,
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  minute: number,
  opts?: { homeForm?: number; awayForm?: number; redHome?: number; redAway?: number }
): number | null {
  const def = MARKET_BY_KEY.get(market);
  if (!def) return null;
  if (!def.outcomes(home, away).some((o) => o.key === outcome)) return null;

  if (market === "result") {
    const p = liveResultProbs(home, away, homeScore, awayScore, minute, opts);
    return outcome === "home" ? p.home : outcome === "draw" ? p.draw : p.away;
  }

  const model = liveScoreModel(home, away, homeScore, awayScore, minute, opts);
  return rawProbOnModel(def, outcome, model);
}

export interface CustomMarketGroup {
  key: string;
  label: string;
  short: string;
  outcomes: MarketOutcome[];
  rows?: MarketRow[];
}

export function customMarketOdds(
  markets: CustomMarketGroup[] | null | undefined,
  market: string,
  outcome: string
): number | null {
  if (!markets || markets.length === 0) return null;
  const g = markets.find((m) => m.key === market);
  if (!g) return null;
  if (g.rows) {
    for (const r of g.rows) {
      const hit = r.outcomes.find((o) => o.key === outcome);
      if (hit) return hit.odds;
    }
    return null;
  }
  return g.outcomes.find((o) => o.key === outcome)?.odds ?? null;
}

export function customMarketLabel(
  markets: CustomMarketGroup[] | null | undefined,
  market: string,
  outcome: string
): string | null {
  if (!markets || markets.length === 0) return null;
  const g = markets.find((m) => m.key === market);
  if (!g) return null;
  if (g.rows) {
    for (const r of g.rows) {
      const hit = r.outcomes.find((o) => o.key === outcome);
      if (hit) return hit.label;
    }
    return null;
  }
  return g.outcomes.find((o) => o.key === outcome)?.label ?? null;
}

export function marketCatalog(): Array<{ key: string; label: string; short: string; outcomes: MarketOutcome[] }> {
  return MARKETS.map((m) => {
    const spec = m.outcomes("Domicile", "Extérieur");
    return {
      key: m.key,
      label: m.label,
      short: m.short,
      outcomes: spec.map((o) => ({ key: o.key, label: o.label, short: o.short, odds: 2 })),
    };
  });
}
