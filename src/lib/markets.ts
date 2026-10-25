import {
  binaryOutcomeOdds,
  extractMatchTimelineStats,
  liveHalfSplitModel,
  liveResultProbs,
  liveScoreModel,
  partitionOutcomeOdds,
  type LiveHalfSplitModel,
  type LiveScoreModel,
  type MatchTimelineEvent,
  type MatchTimelineStats,
} from "@/db/fixtures";
import { getCachedMarketCalibratorMultiplier } from "./ml-weights";
import { marginOverround, type BetLike } from "./risk";

export type MarketCategory = "main" | "halftime" | "goals" | "teams" | "scores";

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

export interface MarketModelOpts {
  homeForm?: number;
  awayForm?: number;
  redHome?: number;
  redAway?: number;
  events?: MatchTimelineEvent[] | null;
  matchId?: number;
}

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
  /** true si les issues forment une partition conditionnelle (ex. DNB remboursé sur nul). */
  conditionalPartition?: boolean;
  /** Minute live à partir de laquelle ce marché est fermé aux nouvelles mises (ex. 41' pour la 1re MT). */
  liveCloseMinute?: number;
  outcomes: (home: string, away: string) => OutcomeSpec[];
  rows?: (home: string, away: string) => MarketRowSpec[];
  /** Évaluation exacte d'une issue sur score final + chronologie (mi-temps & 1er but). */
  win: (outcome: string, home: number, away: number, tl: MatchTimelineStats) => boolean;
  /** Indique si le ticket est remboursé (void/push) sur ce résultat final (ex. DNB sur match nul). */
  isVoid?: (outcome: string, home: number, away: number, tl: MatchTimelineStats) => boolean;
  /** Probabilité directe issue du sous-modèle Mi-Temps / 1er but lorsqu'elle ne dépend pas que du score final. */
  splitProb?: (outcome: string, split: LiveHalfSplitModel) => number;
}

const SCORE_EXACT_LISTED = new Set([
  "1_0", "2_0", "2_1",
  "0_0", "1_1", "2_2",
  "0_1", "0_2", "1_2",
  "3_0", "3_1", "0_3", "1_3",
]);

const MARKET_MAX_ODDS: Record<string, number> = {
  result: 100,
  dnb: 60,
  double_chance: 25,
  handicap_euro: 90,
  result_total: 100,
  result_btts: 100,
  winning_margin: 95,
  goal_range: 65,
  ht_result: 70,
  ht_total_ou: 50,
  ht_ft: 110,
  first_team_to_score: 60,
  highest_scoring_half: 50,
  total_exact: 90,
  score_exact: 120,
};

const DEFAULT_MAX_ODDS = 80;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Marge effective d'un marché = marge de base (avant-match ou live) × ratio de liquidité du marché. */
function effectiveMargin(market: string, baseMargin = marginOverround("result")): number {
  return Math.round(baseMargin * (marginOverround(market) / marginOverround("result")) * 10000) / 10000;
}

/**
 * Cotes fixes non mutualisées enrichies par l'auto-calibrateur bayésien ML :
 * si un segment `(marché, tranche de cote)` dérive statistiquement au fil de
 * l'historique réglé, le multiplicateur appris ajuste automatiquement la marge.
 */
function exposureAdjustedOdds(
  market: string,
  _outcome: string,
  modelOdds: number,
  _bets?: BetLike[]
): number {
  void _outcome;
  void _bets;
  const calMult = getCachedMarketCalibratorMultiplier(market, modelOdds);
  if (calMult === 1.0) return modelOdds;
  return round2(Math.max(1.01, modelOdds / calMult));
}

function htSymbol(htH: number, htA: number): "1" | "X" | "2" {
  return htH > htA ? "1" : htH === htA ? "X" : "2";
}

const w = {
  result: (o: string, h: number, a: number) =>
    o === "home" ? h > a : o === "away" ? a > h : h === a,
  dnb: (o: string, h: number, a: number) =>
    o === "home" ? h > a : o === "away" ? a > h : false,
  doubleChance: (o: string, h: number, a: number) =>
    o === "1X" ? h >= a : o === "X2" ? h <= a : h !== a,
  handicapEuro: (o: string, h: number, a: number) => {
    const m = /^he_(m|p)(\d+)_(home|draw|away)$/.exec(o);
    if (!m) return false;
    const sign = m[1] === "m" ? -1 : 1;
    const hcap = sign * Number(m[2]);
    const adjDiff = h + hcap - a;
    if (m[3] === "home") return adjDiff > 0;
    if (m[3] === "draw") return adjDiff === 0;
    return adjDiff < 0;
  },
  totalOU: (o: string, h: number, a: number) => {
    const m = /^ou_(\d+)_(\d+)_(over|under)$/.exec(o);
    if (!m) return false;
    const line = Number(`${m[1]}.${m[2]}`);
    return m[3] === "over" ? h + a > line : h + a <= line;
  },
  btts: (o: string, h: number, a: number) => (h > 0 && a > 0) === (o === "oui"),
  resultBtts: (o: string, h: number, a: number) => {
    const both = h > 0 && a > 0;
    switch (o) {
      case "home_yes":
        return h > a && both;
      case "home_no":
        return h > a && !both;
      case "draw_yes":
        return h === a && both;
      case "draw_no":
        return h === 0 && a === 0;
      case "away_yes":
        return a > h && both;
      case "away_no":
        return a > h && !both;
      default:
        return false;
    }
  },
  winningMargin: (o: string, h: number, a: number) => {
    const diff = h - a;
    switch (o) {
      case "h_1":
        return diff === 1;
      case "h_2":
        return diff === 2;
      case "h_3p":
        return diff >= 3;
      case "draw":
        return diff === 0;
      case "a_1":
        return diff === -1;
      case "a_2":
        return diff === -2;
      case "a_3p":
        return diff <= -3;
      default:
        return false;
    }
  },
  goalRange: (o: string, h: number, a: number) => {
    const tot = h + a;
    if (o === "0_1") return tot <= 1;
    if (o === "2_3") return tot >= 2 && tot <= 3;
    if (o === "4_5") return tot >= 4 && tot <= 5;
    if (o === "6p") return tot >= 6;
    return false;
  },
  htResult: (o: string, _h: number, _a: number, tl: MatchTimelineStats) =>
    o === "home" ? tl.htHome > tl.htAway : o === "away" ? tl.htAway > tl.htHome : tl.htHome === tl.htAway,
  htTotalOU: (o: string, _h: number, _a: number, tl: MatchTimelineStats) => {
    const m = /^ht_ou_(\d+)_(\d+)_(over|under)$/.exec(o);
    if (!m) return false;
    const line = Number(`${m[1]}.${m[2]}`);
    const tot = tl.htHome + tl.htAway;
    return m[3] === "over" ? tot > line : tot <= line;
  },
  htFt: (o: string, h: number, a: number, tl: MatchTimelineStats) => {
    const expected = `${htSymbol(tl.htHome, tl.htAway)}_${htSymbol(h, a)}`;
    return o === expected;
  },
  firstScorer: (o: string, _h: number, _a: number, tl: MatchTimelineStats) => o === tl.firstScorer,
  highestHalf: (o: string, _h: number, _a: number, tl: MatchTimelineStats) => {
    const g1 = tl.htHome + tl.htAway;
    const g2 = tl.h2Home + tl.h2Away;
    if (o === "h1") return g1 > g2;
    if (o === "equal") return g1 === g2;
    if (o === "h2") return g2 > g1;
    return false;
  },
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
    win: (o, h, a) => w.result(o, h, a),
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
    win: (o, h, a) => w.doubleChance(o, h, a),
  },
  {
    key: "dnb",
    label: "Remboursé si match nul (DNB)",
    short: "DNB",
    category: "main",
    partition: true,
    conditionalPartition: true,
    liveCloseMinute: 75,
    outcomes: (h, a) => [
      { key: "home", label: `${h} (remboursé si nul)`, short: "1 (DNB)" },
      { key: "away", label: `${a} (remboursé si nul)`, short: "2 (DNB)" },
    ],
    win: (o, h, a) => w.dnb(o, h, a),
    isVoid: (_o, h, a) => h === a,
  },
  {
    key: "handicap_euro",
    label: "Handicap européen (3 issues)",
    short: "Handicap 1N2",
    category: "main",
    partition: false,
    outcomes: (h, a) => [
      { key: "he_m1_home", label: `${h} (-1)`, short: "1" },
      { key: "he_m1_draw", label: `Nul (${h} -1)`, short: "N" },
      { key: "he_m1_away", label: `${a} (+1)`, short: "2" },
      { key: "he_p1_home", label: `${h} (+1)`, short: "1" },
      { key: "he_p1_draw", label: `Nul (${h} +1)`, short: "N" },
      { key: "he_p1_away", label: `${a} (-1)`, short: "2" },
      { key: "he_m2_home", label: `${h} (-2)`, short: "1" },
      { key: "he_m2_draw", label: `Nul (${h} -2)`, short: "N" },
      { key: "he_m2_away", label: `${a} (+2)`, short: "2" },
      { key: "he_p2_home", label: `${h} (+2)`, short: "1" },
      { key: "he_p2_draw", label: `Nul (${h} +2)`, short: "N" },
      { key: "he_p2_away", label: `${a} (-2)`, short: "2" },
    ],
    rows: () => [
      { label: "-1", keys: ["he_m1_home", "he_m1_draw", "he_m1_away"] },
      { label: "+1", keys: ["he_p1_home", "he_p1_draw", "he_p1_away"] },
      { label: "-2", keys: ["he_m2_home", "he_m2_draw", "he_m2_away"] },
      { label: "+2", keys: ["he_p2_home", "he_p2_draw", "he_p2_away"] },
    ],
    win: (o, h, a) => w.handicapEuro(o, h, a),
  },
  {
    key: "total_ou",
    label: "Total de buts (Plus / Moins)",
    short: "Plus/Moins",
    category: "main",
    partition: false,
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
    win: (o, h, a) => w.totalOU(o, h, a),
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
    win: (o, h, a) => w.btts(o, h, a),
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
    win: (o, h, a) => w.resultOver25(o, h, a),
  },
  {
    key: "result_btts",
    label: "Résultat & Les 2 équipes marquent",
    short: "1N2 + BTTS",
    category: "main",
    partition: true,
    outcomes: (h, a) => [
      { key: "home_yes", label: `${h} & Les 2 marquent : Oui`, short: "1 & Oui" },
      { key: "home_no", label: `${h} & Les 2 marquent : Non`, short: "1 & Non" },
      { key: "draw_yes", label: "Nul & Les 2 marquent : Oui", short: "N & Oui" },
      { key: "draw_no", label: "Nul & Les 2 marquent : Non (0-0)", short: "N & Non" },
      { key: "away_yes", label: `${a} & Les 2 marquent : Oui`, short: "2 & Oui" },
      { key: "away_no", label: `${a} & Les 2 marquent : Non`, short: "2 & Non" },
    ],
    win: (o, h, a) => w.resultBtts(o, h, a),
  },
  {
    key: "ht_result",
    label: "Résultat à la mi-temps",
    short: "1N2 MT",
    category: "halftime",
    partition: true,
    liveCloseMinute: 41,
    outcomes: (h, a) => [
      { key: "home", label: `Mi-temps : Victoire ${h}`, short: "1 (MT)" },
      { key: "draw", label: "Mi-temps : Match nul", short: "N (MT)" },
      { key: "away", label: `Mi-temps : Victoire ${a}`, short: "2 (MT)" },
    ],
    win: w.htResult,
    splitProb: (o, s) =>
      o === "home" ? s.htResult.home : o === "draw" ? s.htResult.draw : s.htResult.away,
  },
  {
    key: "ht_total_ou",
    label: "Total de buts — 1re mi-temps",
    short: "Buts 1re MT",
    category: "halftime",
    partition: false,
    liveCloseMinute: 41,
    outcomes: () => [
      { key: "ht_ou_0_5_over", label: "1re MT : Plus de 0,5 but", short: "Plus" },
      { key: "ht_ou_0_5_under", label: "1re MT : Moins de 0,5 but", short: "Moins" },
      { key: "ht_ou_1_5_over", label: "1re MT : Plus de 1,5 buts", short: "Plus" },
      { key: "ht_ou_1_5_under", label: "1re MT : Moins de 1,5 buts", short: "Moins" },
    ],
    rows: () => [
      { label: "0,5", keys: ["ht_ou_0_5_over", "ht_ou_0_5_under"] },
      { label: "1,5", keys: ["ht_ou_1_5_over", "ht_ou_1_5_under"] },
    ],
    win: w.htTotalOU,
    splitProb: (o, s) => {
      const m = /^ht_ou_(\d+)_(\d+)_(over|under)$/.exec(o);
      if (!m) return 0;
      const line = Number(`${m[1]}.${m[2]}`);
      const pOver = s.htOver(line);
      return m[3] === "over" ? pOver : Math.max(0, 1 - pOver);
    },
  },
  {
    key: "highest_scoring_half",
    label: "Mi-temps la plus prolifique",
    short: "MT + prolifique",
    category: "halftime",
    partition: true,
    outcomes: () => [
      { key: "h1", label: "Mi-temps la plus prolifique : 1re MT", short: "1re MT" },
      { key: "equal", label: "Autant de buts dans chaque mi-temps", short: "Égalité" },
      { key: "h2", label: "Mi-temps la plus prolifique : 2e MT", short: "2e MT" },
    ],
    win: w.highestHalf,
    splitProb: (o, s) =>
      o === "h1" ? s.highestHalf.h1 : o === "equal" ? s.highestHalf.equal : s.highestHalf.h2,
  },
  {
    key: "goal_range",
    label: "Fourchette de buts (Multi-buts)",
    short: "Multi-buts",
    category: "goals",
    partition: true,
    outcomes: () => [
      { key: "0_1", label: "0 ou 1 but dans le match", short: "0–1 but" },
      { key: "2_3", label: "2 ou 3 buts dans le match", short: "2–3 buts" },
      { key: "4_5", label: "4 ou 5 buts dans le match", short: "4–5 buts" },
      { key: "6p", label: "6 buts ou plus dans le match", short: "6+ buts" },
    ],
    win: (o, h, a) => w.goalRange(o, h, a),
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
    win: (o, h, a) => w.totalExact(o, h, a),
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
    win: (o, h, a) => w.oddEven(o, h, a),
  },
  {
    key: "first_team_to_score",
    label: "Première équipe à marquer",
    short: "1er but",
    category: "teams",
    partition: true,
    outcomes: (h, a) => [
      { key: "home", label: `${h} ouvre le score`, short: "1" },
      { key: "none", label: "Aucun but (0-0)", short: "Aucun" },
      { key: "away", label: `${a} ouvre le score`, short: "2" },
    ],
    win: w.firstScorer,
    splitProb: (o, s) =>
      o === "home" ? s.firstScorer.home : o === "none" ? s.firstScorer.none : s.firstScorer.away,
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
    win: (o, h, a) => w.teamTotal("h")(o, h, a),
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
    win: (o, h, a) => w.teamTotal("a")(o, h, a),
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
    win: (o, h, a) => w.toNil("home")(o, h, a),
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
    win: (o, h, a) => w.toNil("away")(o, h, a),
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
    win: (o, h, a) => w.cleanSheet("home")(o, h, a),
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
    win: (o, h, a) => w.cleanSheet("away")(o, h, a),
  },
  {
    key: "winning_margin",
    label: "Marge du vainqueur (écart de buts)",
    short: "Écart buts",
    category: "scores",
    partition: true,
    outcomes: (h, a) => [
      { key: "h_1", label: `${h} gagne par 1 but`, short: "Dom. +1" },
      { key: "a_1", label: `${a} gagne par 1 but`, short: "Ext. +1" },
      { key: "h_2", label: `${h} gagne par 2 buts`, short: "Dom. +2" },
      { key: "a_2", label: `${a} gagne par 2 buts`, short: "Ext. +2" },
      { key: "h_3p", label: `${h} gagne par 3+ buts`, short: "Dom. 3+" },
      { key: "a_3p", label: `${a} gagne par 3+ buts`, short: "Ext. 3+" },
      { key: "draw", label: "Match nul (écart 0)", short: "Match nul" },
    ],
    win: (o, h, a) => w.winningMargin(o, h, a),
  },
  {
    key: "ht_ft",
    label: "Mi-temps / Fin de match",
    short: "MT / FM",
    category: "scores",
    partition: true,
    liveCloseMinute: 41,
    outcomes: (h, a) => [
      { key: "1_1", label: `MT / FM : ${h} / ${h}`, short: "1 / 1" },
      { key: "X_1", label: `MT / FM : Nul / ${h}`, short: "N / 1" },
      { key: "2_1", label: `MT / FM : ${a} / ${h}`, short: "2 / 1" },
      { key: "1_X", label: `MT / FM : ${h} / Nul`, short: "1 / N" },
      { key: "X_X", label: "MT / FM : Nul / Nul", short: "N / N" },
      { key: "2_X", label: `MT / FM : ${a} / Nul`, short: "2 / N" },
      { key: "1_2", label: `MT / FM : ${h} / ${a}`, short: "1 / 2" },
      { key: "X_2", label: `MT / FM : Nul / ${a}`, short: "N / 2" },
      { key: "2_2", label: `MT / FM : ${a} / ${a}`, short: "2 / 2" },
    ],
    win: w.htFt,
    splitProb: (o, s) => s.htFt[o as keyof LiveHalfSplitModel["htFt"]] ?? 0,
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
    win: (o, h, a) => w.scoreExact(o, h, a),
  },
];

const MARKET_BY_KEY = new Map(MARKETS.map((m) => [m.key, m]));

const DUMMY_TL: MatchTimelineStats = {
  htHome: 0,
  htAway: 0,
  h2Home: 0,
  h2Away: 0,
  firstScorer: "none",
};

export function isKnownMarket(key: string): boolean {
  return MARKET_BY_KEY.has(key);
}

export function isVoidableMarket(key: string): boolean {
  return Boolean(MARKET_BY_KEY.get(key)?.isVoid);
}

/** Somme exacte de la probabilité sur la grille finale [finalHome][finalAway] ou le modèle mi-temps. */
function rawProbOnModel(
  m: MarketDef,
  outcomeKey: string,
  model: LiveScoreModel,
  split?: LiveHalfSplitModel
): number {
  if (m.splitProb) {
    return split ? m.splitProb(outcomeKey, split) : 0;
  }
  let prob = 0;
  for (let h = 0; h < model.grid.length; h++) {
    const row = model.grid[h];
    for (let a = 0; a < row.length; a++) {
      const cell = row[a];
      if (cell > 0 && m.win(outcomeKey, h, a, DUMMY_TL)) {
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

function maxReachableAdditionalGoals(minute: number, capMinute = 90): number {
  if (minute >= capMinute) return 0;
  const remaining = Math.max(1, capMinute - minute);
  return Math.min(12, Math.max(2, Math.ceil(remaining / 5) + 1));
}

/**
 * Retourne `true` si l'issue est déjà mathématiquement décidée (acquise ou devenue impossible)
 * ou fermée aux nouvelles mises live au vu du score actuel et du temps restant.
 */
export function marketOutcomeSettled(
  market: string,
  outcome: string,
  homeScore: number,
  awayScore: number,
  minute: string | number | null | undefined,
  opts?: MarketModelOpts
): boolean {
  const def = MARKET_BY_KEY.get(market);
  if (!def) return false;
  if (!def.outcomes("Domicile", "Extérieur").some((o) => o.key === outcome)) return false;

  const min = typeof minute === "number" ? minute : minuteNumber(minute);
  if (min >= 90) return true;
  if (def.liveCloseMinute != null && min >= def.liveCloseMinute) return true;

  if (market === "first_team_to_score") {
    return homeScore + awayScore > 0;
  }

  if (market === "ht_result" || market === "ht_total_ou") {
    if (min >= 45) return true;
    const max1Add = maxReachableAdditionalGoals(min, 45);
    let sawTrue = false;
    let sawFalse = false;
    for (let addH = 0; addH <= max1Add; addH++) {
      for (let addA = 0; addH + addA <= max1Add; addA++) {
        const tl: MatchTimelineStats = {
          htHome: homeScore + addH,
          htAway: awayScore + addA,
          h2Home: 0,
          h2Away: 0,
          firstScorer: "none",
        };
        if (def.win(outcome, homeScore + addH, awayScore + addA, tl)) sawTrue = true;
        else sawFalse = true;
        if (sawTrue && sawFalse) return false;
      }
    }
    return true;
  }

  if (market === "ht_ft") {
    return min >= 45;
  }

  if (market === "highest_scoring_half") {
    if (min < 45) return false;
    const tlNow = extractMatchTimelineStats(homeScore, awayScore, opts?.events, opts?.matchId ?? 0);
    const fixedG1 = tlNow.htHome + tlNow.htAway;
    const curG2 = Math.max(0, homeScore + awayScore - fixedG1);
    const max2Add = maxReachableAdditionalGoals(min, 90);
    let sawTrue = false;
    let sawFalse = false;
    for (let add2 = 0; add2 <= max2Add; add2++) {
      const g2 = curG2 + add2;
      const hit =
        outcome === "h1" ? fixedG1 > g2 : outcome === "equal" ? fixedG1 === g2 : g2 > fixedG1;
      if (hit) sawTrue = true;
      else sawFalse = true;
      if (sawTrue && sawFalse) return false;
    }
    return true;
  }

  const maxAdd = maxReachableAdditionalGoals(min);
  let sawTrue = false;
  let sawFalse = false;

  for (let addH = 0; addH <= maxAdd; addH++) {
    for (let addA = 0; addH + addA <= maxAdd; addA++) {
      if (def.win(outcome, homeScore + addH, awayScore + addA, DUMMY_TL)) sawTrue = true;
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
  split: LiveHalfSplitModel,
  homeScore: number,
  awayScore: number,
  minute: number,
  isLive: boolean,
  opts?: MarketModelOpts,
  bets?: BetLike[]
): MarketGroup | null {
  if (isLive && m.liveCloseMinute != null && minute >= m.liveCloseMinute) {
    return null;
  }

  const overround = effectiveMargin(m.key, model.margin);
  const maxOdds = MARKET_MAX_ODDS[m.key] ?? DEFAULT_MAX_ODDS;
  const specs = m.outcomes(home, away);

  // Cas 1 : marché structuré en lignes (total_ou, ht_total_ou, home_total, away_total, handicap_euro)
  if (m.rows) {
    const rowSpecs = m.rows(home, away);
    const builtRows: MarketRow[] = [];
    const builtOutcomes: MarketOutcome[] = [];

    for (const rSpec of rowSpecs) {
      const expectedCols = rSpec.keys.length;
      const rowEntries = rSpec.keys
        .map((k) => specs.find((s) => s.key === k))
        .filter((s): s is OutcomeSpec => Boolean(s))
        .map((s) => {
          const prob = rawProbOnModel(m, s.key, model, split);
          const settled = isLive
            ? marketOutcomeSettled(m.key, s.key, homeScore, awayScore, minute, opts) ||
              prob < 0.008 ||
              prob > 0.985
            : prob < 0.006 || prob > 0.988;
          return { spec: s, prob, settled };
        });

      // Si une issue d'une ligne est décidée ou hors plage cotable, toute la ligne est retirée
      if (rowEntries.length < expectedCols || rowEntries.some((e) => e.settled)) continue;

      const sumRow = rowEntries.reduce((acc, e) => acc + e.prob, 0) || 1;
      const oddsTuple = partitionOutcomeOdds(
        rowEntries.map((e) => e.prob / sumRow),
        overround,
        maxOdds
      );
      const rowOutcomes: MarketOutcome[] = rowEntries.map((e, idx) => ({
        key: e.spec.key,
        label: e.spec.label,
        short: e.spec.short,
        odds: exposureAdjustedOdds(m.key, e.spec.key, oddsTuple[idx], bets),
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
    const prob = rawProbOnModel(m, s.key, model, split);
    const settled = isLive
      ? marketOutcomeSettled(m.key, s.key, homeScore, awayScore, minute, opts) ||
        prob < 0.006 ||
        prob > 0.985
      : false;
    return { spec: s, prob, settled };
  });

  // Sur les marchés binaires Oui/Non, DNB ou Pair/Impair, on retire la paire complète si un côté est décidé
  if (m.partition && specs.length === 2 && entries.some((e) => e.settled)) {
    return null;
  }

  const open = entries.filter((e) => !e.settled);
  if (open.length === 0) return null;

  let outcomes: MarketOutcome[];
  if (m.conditionalPartition) {
    // Ex. Draw No Bet : cotation conditionnelle sur les issues décisives (hors nul remboursé)
    const sumDecisive = open.reduce((acc, e) => acc + e.prob, 0);
    if (open.length < 2 || sumDecisive < (isLive ? 0.28 : 0.15)) {
      return null;
    }
    const condProbs = open.map((e) => e.prob / sumDecisive);
    if (isLive && condProbs.some((q) => q < 0.035 || q > 0.965)) {
      return null;
    }
    const oddsList = partitionOutcomeOdds(condProbs, overround, maxOdds);
    outcomes = open.map((e, idx) => ({
      key: e.spec.key,
      label: e.spec.label,
      short: e.spec.short,
      odds: exposureAdjustedOdds(m.key, e.spec.key, oddsList[idx], bets),
    }));
  } else if (m.partition && open.length >= 2) {
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

export function buildMarkets(
  home: string,
  away: string,
  opts?: MarketModelOpts,
  bets?: BetLike[]
): MarketGroup[] {
  const model = liveScoreModel(home, away, 0, 0, 0, opts);
  const split = liveHalfSplitModel(home, away, 0, 0, 0, opts, model);
  const out: MarketGroup[] = [];
  for (const m of MARKETS) {
    const grp = buildMarketGroup(m, home, away, model, split, 0, 0, 0, false, opts, bets);
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
  opts?: MarketModelOpts,
  bets?: BetLike[]
): MarketGroup[] {
  const model = liveScoreModel(home, away, homeScore, awayScore, minute, opts);
  const split = liveHalfSplitModel(home, away, homeScore, awayScore, minute, opts, model);
  const out: MarketGroup[] = [];
  for (const m of MARKETS) {
    const grp = buildMarketGroup(
      m,
      home,
      away,
      model,
      split,
      homeScore,
      awayScore,
      minute,
      true,
      opts,
      bets
    );
    if (grp) out.push(grp);
  }
  return out;
}

export function marketOddsFor(
  market: string,
  outcome: string,
  home: string,
  away: string,
  opts?: MarketModelOpts,
  bets?: BetLike[]
): number | null {
  const def = MARKET_BY_KEY.get(market);
  if (!def) return null;
  const model = liveScoreModel(home, away, 0, 0, 0, opts);
  const split = liveHalfSplitModel(home, away, 0, 0, 0, opts, model);
  const grp = buildMarketGroup(def, home, away, model, split, 0, 0, 0, false, opts, bets);
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
  opts?: MarketModelOpts,
  bets?: BetLike[]
): number | null {
  const def = MARKET_BY_KEY.get(market);
  if (!def) return null;
  const model = liveScoreModel(home, away, homeScore, awayScore, minute, opts);
  const split = liveHalfSplitModel(home, away, homeScore, awayScore, minute, opts, model);
  const grp = buildMarketGroup(
    def,
    home,
    away,
    model,
    split,
    homeScore,
    awayScore,
    minute,
    true,
    opts,
    bets
  );
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

/** Règlement complet d'un pari (victoire, défaite ou remboursement/void ex. DNB sur nul). */
export function marketSettle(
  market: string,
  outcome: string,
  homeScore: number,
  awayScore: number,
  events?: MatchTimelineEvent[] | null,
  matchId = 0
): { won: boolean; voided: boolean } {
  const def = MARKET_BY_KEY.get(market);
  if (!def) return { won: false, voided: true };
  const tl = extractMatchTimelineStats(homeScore, awayScore, events, matchId);
  if (def.isVoid && def.isVoid(outcome, homeScore, awayScore, tl)) {
    return { won: false, voided: true };
  }
  return {
    won: def.win(outcome, homeScore, awayScore, tl),
    voided: false,
  };
}

export function marketWin(
  market: string,
  outcome: string,
  homeScore: number,
  awayScore: number,
  events?: MatchTimelineEvent[] | null,
  matchId = 0
): boolean {
  return marketSettle(market, outcome, homeScore, awayScore, events, matchId).won;
}

export function closingOddsFor(
  market: string,
  outcome: string,
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  opts?: MarketModelOpts
): number | null {
  const def = MARKET_BY_KEY.get(market);
  if (!def) return null;
  if (!def.outcomes(home, away).some((o) => o.key === outcome)) return null;

  const model = liveScoreModel(home, away, 0, 0, 0, opts);
  const split = liveHalfSplitModel(home, away, 0, 0, 0, opts, model);
  const overround = effectiveMargin(market, model.margin);

  if (def.conditionalPartition) {
    const pHome = rawProbOnModel(def, "home", model, split);
    const pAway = rawProbOnModel(def, "away", model, split);
    const sum = pHome + pAway;
    if (sum <= 0.01) return null;
    const condProb = (outcome === "home" ? pHome : pAway) / sum;
    return binaryOutcomeOdds(condProb, overround, 250);
  }

  const prob = rawProbOnModel(def, outcome, model, split);
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
  opts?: MarketModelOpts
): number | null {
  const def = MARKET_BY_KEY.get(market);
  if (!def) return null;
  if (!def.outcomes(home, away).some((o) => o.key === outcome)) return null;

  if (market === "result") {
    const p = liveResultProbs(home, away, homeScore, awayScore, minute, opts);
    return outcome === "home" ? p.home : outcome === "draw" ? p.draw : p.away;
  }

  if (market === "dnb") {
    const p = liveResultProbs(home, away, homeScore, awayScore, minute, opts);
    const pWin = outcome === "home" ? p.home : p.away;
    // Probabilité équivalente prudente tenant compte du remboursement en cas de nul
    return Math.min(0.98, pWin + p.draw * 0.48);
  }

  const model = liveScoreModel(home, away, homeScore, awayScore, minute, opts);
  const split = liveHalfSplitModel(home, away, homeScore, awayScore, minute, opts, model);
  return rawProbOnModel(def, outcome, model, split);
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
