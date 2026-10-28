import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import type { MatchTimelineEvent } from "@/db/fixtures";
import {
  adminSettings,
  matches,
  type MatchRow,
  type RealLiveFeedProbs,
  type RealMatchStats,
  type RealStatSnapshot,
} from "@/db/schema";
import {
  computeRealLiveHeadline1x2Odds,
  isFirstHalfCompleted,
  isRealMatchPostIncidentSuspended,
} from "@/lib/markets";
import {
  ensureMatchStoreHydrated,
  getCachedOpenManualMatches,
  invalidateAllActiveCaches,
} from "@/lib/active-state-cache";
import {
  pickPreferredPlayerLabel,
  reconcileRedCardCounts,
  samePlayerIdentity,
  sanitizeMatchEvents,
} from "@/lib/match-events";
import {
  officialLeagueLabel,
  resolveEspnSlugForLeague,
  TOP_DISCOVERY_LEAGUE_SLUGS,
} from "@/lib/real-leagues";
import { normalizeEspnLiveClockSeconds } from "@/lib/live-clock";
import { teamLogo } from "@/lib/team-logos";

const ESPN_SOCCER_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

/** Fréquence maximale de rafraîchissement des matchs réels en direct ou proches du coup d'envoi (10 s). */
const LIVE_FEED_SYNC_MS = 10_000;
/** Fréquence de vérification de fond lorsqu'il n'y a que des matchs réels à venir lointains. */
const IDLE_FEED_SYNC_MS = 180_000;
/** Fréquence maximale d'interrogation du résumé détaillé (`boxscore` stats + `pickcenter` + `winprobability`) par match live (15 s). */
const SUMMARY_FETCH_INTERVAL_MS = 15_000;
/**
 * Fenêtre courte de confirmation anti-VAR (25 s) appliquée UNIQUEMENT lorsqu'un match réel
 * était activement suivi en direct jusqu'au coup de sifflet final.
 */
export const REAL_FT_CONFIRM_DELAY_MS = 25_000;
/**
 * Seuil d'absence de synchronisation (2 min 30 s) au-delà duquel une fin officielle détectée
 * au réveil du site est clôturée immédiatement sans sas anti-VAR différé.
 */
const ABSENCE_SYNC_GAP_MS = 150_000;
/**
 * Durée depuis le coup d'envoi (2h10) au-delà de laquelle le temps réglementaire (90 min)
 * est terminé depuis assez longtemps pour clôturer immédiatement sans sas anti-VAR.
 */
const REAL_MATCH_ENDED_LONG_AGO_MS = 130 * 60_000;
/** Délai d'acceptation anti « pari tardif » sur un pari ou cash-out en direct (3 secondes). */
const LIVE_ACCEPTANCE_BUFFER_MS = 3_000;
/** Verrouillage préventif des paris live si le flux automatique d'un match live ne répond plus (> 90 s). */
export const STALE_LIVE_FEED_MAX_MS = 90_000;

export type RealMatchSettlementMode = "auto" | "confirm";

export interface ParsedFeedMatch {
  externalId: string;
  externalLeague: string;
  leagueLabel: string;
  homeTeam: string;
  awayTeam: string;
  homeAliases: string[];
  awayAliases: string[];
  homeLogo: string | null;
  awayLogo: string | null;
  startsAt: Date;
  status: "upcoming" | "live" | "finished" | "postponed";
  minute: string | null;
  homeScore: number | null;
  awayScore: number | null;
  htHomeScore: number | null;
  htAwayScore: number | null;
  redHome: number;
  redAway: number;
  events: MatchTimelineEvent[];
  realStats: RealMatchStats | null;
  venue: string | null;
  suggestedOdds: {
    oddsHome: number;
    oddsDraw: number;
    oddsAway: number;
    source: "bookmaker" | "elo_form";
    expectedTotalGoals: number;
  };
  liveFeedProbs: RealLiveFeedProbs | null;
}

export interface DiscoveredOfficialFixture {
  externalId: string;
  externalLeague: string;
  leagueLabel: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo: string | null;
  awayLogo: string | null;
  startsAt: string;
  status: "upcoming" | "live";
  minute: string | null;
  homeScore: number | null;
  awayScore: number | null;
  htHomeScore?: number | null;
  htAwayScore?: number | null;
  redHome?: number;
  redAway?: number;
  events?: MatchTimelineEvent[];
  realStats?: RealMatchStats | null;
  venue?: string | null;
  oddsHome: number;
  oddsDraw: number;
  oddsAway: number;
  alreadyImported: boolean;
  existingMatchId: number | null;
}

export interface RealSyncSummary {
  activeCount: number;
  syncedCount: number;
  linkedCount: number;
  liveCount: number;
  settledCount: number;
  pendingConfirmCount: number;
}

type JsonRec = Record<string, unknown>;

function asRec(v: unknown): JsonRec | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as JsonRec) : null;
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : v != null && typeof v === "number" ? String(v) : "";
}

function asNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const cleaned = v.trim().replace(",", ".").replace(/%$/, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const obj = asRec(v);
  if (obj) {
    if ("value" in obj) {
      const nv = asNum(obj.value);
      if (nv != null) return nv;
    }
    if ("displayValue" in obj) return asNum(obj.displayValue);
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function formatYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Génère la liste ordonnée des dates UTC `YYYYMMDD` comprises entre `fromDate` et `toDate`.
 * Crucial : l'endpoint ESPN Soccer v2 `/scoreboard` accepte `?dates=YYYYMMDD` par journée unique
 * mais rejette les plages `?dates=YYYYMMDD-YYYYMMDD` avec HTTP 400.
 */
export function buildUtcDayYmds(fromDate: Date, toDate: Date, maxDays = 15): string[] {
  const startUtc = Date.UTC(
    fromDate.getUTCFullYear(),
    fromDate.getUTCMonth(),
    fromDate.getUTCDate()
  );
  const endUtc = Date.UTC(
    toDate.getUTCFullYear(),
    toDate.getUTCMonth(),
    toDate.getUTCDate()
  );
  const out: string[] = [];
  const stepMs = 24 * 3600_000;
  for (let ts = startUtc; ts <= endUtc && out.length < maxDays; ts += stepMs) {
    out.push(formatYmd(new Date(ts)));
  }
  if (out.length === 0) out.push(formatYmd(fromDate));
  return out;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Alias français ↔ internationaux pour relier sans erreur un club saisi en français. */
const CLUB_CANONICAL_SYNONYMS: Record<string, string> = {
  psg: "paris saint germain",
  "paris sg": "paris saint germain",
  "paris saint germain": "paris saint germain",
  om: "olympique marseille",
  marseille: "olympique marseille",
  "olympique de marseille": "olympique marseille",
  ol: "olympique lyonnais",
  lyon: "olympique lyonnais",
  "fc barcelone": "barcelona",
  barcelone: "barcelona",
  "fc barcelona": "barcelona",
  barcelona: "barcelona",
  "atletico madrid": "atletico madrid",
  "club atletico de madrid": "atletico madrid",
  "fc seville": "sevilla",
  seville: "sevilla",
  sevilla: "sevilla",
  valence: "valencia",
  valencia: "valencia",
  gerone: "girona",
  girona: "girona",
  "bayern munich": "bayern munchen",
  "fc bayern munich": "bayern munchen",
  "bayern munchen": "bayern munchen",
  dortmund: "borussia dortmund",
  "borussia dortmund": "borussia dortmund",
  leverkusen: "bayer leverkusen",
  "bayer 04 leverkusen": "bayer leverkusen",
  "eintracht francfort": "eintracht frankfurt",
  "eintracht frankfurt": "eintracht frankfurt",
  "inter milan": "internazionale",
  inter: "internazionale",
  internazionale: "internazionale",
  "fc internazionale milano": "internazionale",
  "ac milan": "milan",
  milan: "milan",
  naples: "napoli",
  napoli: "napoli",
  "ssc napoli": "napoli",
  "as rome": "roma",
  "as roma": "roma",
  roma: "roma",
  latium: "lazio",
  lazio: "lazio",
  "ss lazio": "lazio",
  "manchester utd": "manchester united",
  "man utd": "manchester united",
  "man united": "manchester united",
  "man city": "manchester city",
  spurs: "tottenham hotspur",
  tottenham: "tottenham hotspur",
  newcastle: "newcastle united",
  "west ham": "west ham united",
  wolves: "wolverhampton wanderers",
  brighton: "brighton hove albion",
  sporting: "sporting cp",
  "sporting lisbonne": "sporting cp",
};

export function normalizeClubKey(raw: string): string {
  const base = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(fc|cf|sc|ac|as|ssc|rc|rcd|ud|cd|fk|sk|afc|sv|vfb|tsg|1)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return CLUB_CANONICAL_SYNONYMS[base] ?? CLUB_CANONICAL_SYNONYMS[raw.toLowerCase().trim()] ?? base;
}

export function clubsMatchCanonical(
  nameA: string,
  aliasesB: string | string[]
): boolean {
  const keyA = normalizeClubKey(nameA);
  if (!keyA) return false;
  const list = Array.isArray(aliasesB) ? aliasesB : [aliasesB];
  for (const cand of list) {
    const keyB = normalizeClubKey(cand);
    if (!keyB) continue;
    if (keyA === keyB) return true;
    if (keyA.length >= 5 && keyB.length >= 5 && (keyA.includes(keyB) || keyB.includes(keyA))) {
      return true;
    }
  }
  return false;
}

function normalizeDisplayMinute(rawClock: string): string {
  const cleaned = rawClock.replace(/\s+/g, "").replace(/['’]\+/g, "+");
  if (!cleaned) return "LIVE";
  if (/^(MT|HT)$/i.test(cleaned)) return "MT";
  const stopMatch = /^(\d{1,3})\+(\d{1,2})(?::\d{1,2})?['’]?$/.exec(cleaned);
  if (stopMatch) {
    return `${Number(stopMatch[1])}+${Math.max(1, Number(stopMatch[2]))}’`;
  }
  const regMatch = /^(\d{1,3})(?::\d{1,2})?['’]?$/.exec(cleaned);
  if (regMatch) {
    return `${Math.max(1, Number(regMatch[1]))}’`;
  }
  return cleaned.endsWith("’")
    ? cleaned
    : cleaned.endsWith("'")
      ? `${cleaned.slice(0, -1)}’`
      : `${cleaned}’`;
}

function isExtraTimeDetail(
  rawClock: string,
  periodNum: number | null,
  secVal: number | null
): boolean {
  if (periodNum != null && periodNum > 2) return true;
  const mPlus = /(\d+)\s*['’]?\s*\+\s*(\d+)/.exec(rawClock);
  if (mPlus) {
    // 45’+2’ -> base 45 (réglementaire) ; 90’+4’ -> base 90 (réglementaire) ; 105’+1’ -> prolongation
    return Number(mPlus[1]) > 90;
  }
  const mSimple = /(\d+)/.exec(rawClock);
  if (mSimple) {
    return Number(mSimple[1]) > 90;
  }
  if (secVal != null && secVal > 6_000 && periodNum !== 2) {
    return true;
  }
  return false;
}

function parseClockMinuteInt(
  rawClock: string,
  periodNum: number | null,
  secVal: number | null
): number {
  const mPlus = /(\d+)\s*['’]?\s*\+\s*(\d+)/.exec(rawClock);
  if (mPlus) {
    const base = Number(mPlus[1]);
    if (base <= 45) return 45;
    if (base <= 90) return 90;
    return clamp(base + Number(mPlus[2]), 91, 120);
  }
  const mSimple = /(\d+)/.exec(rawClock);
  if (mSimple) {
    const m = Number(mSimple[1]);
    if (periodNum === 1) return clamp(m, 1, 45);
    if (periodNum === 2) return clamp(Math.max(46, m), 46, 90);
    return clamp(m, 1, 90);
  }
  if (secVal != null && secVal >= 0) {
    const m = Math.max(1, Math.round(secVal / 60));
    if (periodNum === 1) return clamp(m, 1, 45);
    if (periodNum === 2) return clamp(Math.max(46, m), 46, 90);
    return clamp(m, 1, 90);
  }
  return periodNum === 1 ? 30 : 65;
}

/**
 * Convertit une cote américaine (`"+160"`, `"-185"`, `"EVEN"`) ou décimale (`2.45`)
 * en probabilité implicite brute `(0..1)`.
 */
function oddsTokenToImpliedProb(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const upper = raw.trim().toUpperCase();
    if (!upper) return null;
    if (upper === "EVEN" || upper === "EV") return 0.5;
  }
  const n = asNum(raw);
  if (n == null || !Number.isFinite(n) || n === 0) return null;
  if (n > 1.01 && n < 50) {
    return 1 / n;
  }
  if (n <= -100) {
    const abs = Math.abs(n);
    return abs / (abs + 100);
  }
  if (n >= 100) {
    return 100 / (n + 100);
  }
  return null;
}

function extractSideSubNodeToken(subNode: unknown): unknown {
  const r = asRec(subNode);
  if (!r) return subNode;
  return r.odds ?? r.moneyLine ?? r.value ?? null;
}

function extractPreMatchMoneylineSideProb(sideNode: unknown): number | null {
  const rec = asRec(sideNode);
  if (!rec) return oddsTokenToImpliedProb(sideNode);
  // Privilégie la cote pré-match (`close` puis `open`) sur la cote live (`current`)
  // afin que la base 90 min d'un match reste ancrée sur les cotes pré-match.
  return (
    oddsTokenToImpliedProb(extractSideSubNodeToken(rec.close)) ??
    oddsTokenToImpliedProb(extractSideSubNodeToken(rec.open)) ??
    oddsTokenToImpliedProb(rec.moneyLine ?? rec.odds ?? rec.value)
  );
}

function extractLiveCurrentSideProb(sideNode: unknown): {
  currentProb: number | null;
  preProb: number | null;
} {
  const rec = asRec(sideNode);
  if (!rec) return { currentProb: null, preProb: null };
  const currentProb = oddsTokenToImpliedProb(extractSideSubNodeToken(rec.current));
  const preProb =
    oddsTokenToImpliedProb(extractSideSubNodeToken(rec.close)) ??
    oddsTokenToImpliedProb(extractSideSubNodeToken(rec.open)) ??
    oddsTokenToImpliedProb(rec.moneyLine ?? rec.odds ?? rec.value);
  return { currentProb, preProb };
}

function poissonOverProb(lambdaTotal: number, line: number): number {
  const kMax = Math.floor(line);
  let cdf = 0;
  let term = Math.exp(-lambdaTotal);
  cdf += term;
  for (let k = 1; k <= kMax; k++) {
    term *= lambdaTotal / k;
    cdf += term;
  }
  return clamp(1 - cdf, 0.01, 0.99);
}

function solveExpectedGoalsFromOverLine(line: number, fairOverProb: number): number {
  let lo = 1.2;
  let hi = 4.6;
  const target = clamp(fairOverProb, 0.12, 0.88);
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) * 0.5;
    if (poissonOverProb(mid, line) < target) lo = mid;
    else hi = mid;
  }
  return round2((lo + hi) * 0.5);
}

/**
 * Ratings Elo réels (échelle ClubElo européenne/mondiale 1400..2030) indexés par `normalizeClubKey`.
 * Utilisés en combinaison avec le standing de la compétition et le bilan de la saison lorsque
 * le flux ESPN ne publie pas encore les cotes bookmaker US.
 */
const REAL_CLUB_ELO: Record<string, number> = {
  // Élite européenne & Ligue des Champions
  "real madrid": 1995,
  "manchester city": 1985,
  "bayern munchen": 1970,
  liverpool: 1965,
  arsenal: 1960,
  barcelona: 1955,
  "paris saint germain": 1945,
  internazionale: 1945,
  "bayer leverkusen": 1915,
  "atletico madrid": 1900,
  chelsea: 1885,
  "borussia dortmund": 1880,
  juventus: 1870,
  napoli: 1875,
  milan: 1865,
  atalanta: 1875,
  "aston villa": 1855,
  "newcastle united": 1855,
  "tottenham hotspur": 1845,
  "manchester united": 1825,
  "rb leipzig": 1845,
  "sporting cp": 1850,
  benfica: 1845,
  porto: 1830,
  "psv eindhoven": 1820,
  feyenoord: 1795,
  ajax: 1780,

  // Premier League & Championship
  "brighton hove albion": 1805,
  bournemouth: 1785,
  fulham: 1785,
  brentford: 1775,
  "nottingham forest": 1780,
  "west ham united": 1770,
  "crystal palace": 1770,
  everton: 1745,
  "wolverhampton wanderers": 1735,
  "leicester city": 1705,
  "leeds united": 1725,
  burnley: 1705,
  sunderland: 1690,
  "ipswich town": 1685,
  southampton: 1685,
  "sheffield united": 1680,

  // LaLiga
  "athletic bilbao": 1835,
  villarreal: 1825,
  "real sociedad": 1810,
  "real betis": 1800,
  girona: 1775,
  sevilla: 1760,
  "celta vigo": 1755,
  osasuna: 1750,
  "ca osasuna": 1750,
  mallorca: 1745,
  "rcd majorque": 1745,
  "rayo vallecano": 1745,
  valencia: 1735,
  getafe: 1735,
  alaves: 1715,
  espanyol: 1705,
  "las palmas": 1695,
  leganes: 1690,
  "real valladolid": 1675,

  // Serie A
  roma: 1825,
  lazio: 1825,
  fiorentina: 1810,
  bologna: 1805,
  torino: 1755,
  udinese: 1735,
  genoa: 1725,
  como: 1725,
  parma: 1705,
  empoli: 1700,
  cagliari: 1700,
  verona: 1695,
  "hellas verona": 1695,
  lecce: 1685,
  monza: 1680,
  venezia: 1670,

  // Bundesliga
  stuttgart: 1825,
  "vfb stuttgart": 1825,
  "eintracht frankfurt": 1815,
  freiburg: 1785,
  "sc freiburg": 1785,
  wolfsburg: 1755,
  "borussia monchengladbach": 1750,
  mainz: 1755,
  "mainz 05": 1755,
  werder: 1745,
  "werder bremen": 1745,
  hoffenheim: 1735,
  augsburg: 1730,
  "union berlin": 1730,
  heidenheim: 1700,
  "st pauli": 1690,
  bochum: 1675,

  // Ligue 1 & Ligue 2
  monaco: 1835,
  "as monaco": 1835,
  "olympique marseille": 1830,
  lille: 1825,
  losc: 1825,
  "olympique lyonnais": 1805,
  nice: 1790,
  "ogc nice": 1790,
  lens: 1785,
  "rc lens": 1785,
  rennes: 1770,
  "stade rennais": 1770,
  brest: 1765,
  "stade brestois": 1765,
  strasbourg: 1745,
  toulouse: 1745,
  reims: 1730,
  "stade de reims": 1730,
  nantes: 1715,
  auxerre: 1705,
  angers: 1680,
  "saint etienne": 1685,
  "le havre": 1680,
  montpellier: 1680,
  lorient: 1685,
  metz: 1675,
  "paris fc": 1690,

  // Autres grands clubs européens & mondiaux
  galatasaray: 1795,
  fenerbahce: 1790,
  besiktas: 1740,
  trabzonspor: 1720,
  "club brugge": 1785,
  "union sg": 1765,
  anderlecht: 1730,
  celtic: 1775,
  rangers: 1740,
  "red bull salzburg": 1745,
  "sturm graz": 1735,
  "shakhtar donetsk": 1745,
  olympiacos: 1755,
  paok: 1735,
  panathinaikos: 1725,
  "sparta prague": 1745,
  "slavia prague": 1765,
  "dinamo zagreb": 1730,
  "young boys": 1710,
  braga: 1765,
  "sc braga": 1765,
  "al hilal": 1810,
  "al nassr": 1775,
  "al ittihad": 1765,
  flamengo: 1785,
  palmeiras: 1785,
  "river plate": 1760,
  "boca juniors": 1735,
  "inter miami": 1725,

  // Sélections nationales majeures
  spain: 2010,
  espagne: 2010,
  france: 1995,
  argentina: 2005,
  argentine: 2005,
  england: 1965,
  angleterre: 1965,
  germany: 1945,
  allemagne: 1945,
  portugal: 1945,
  brazil: 1940,
  bresil: 1940,
  netherlands: 1925,
  "pays bas": 1925,
  italy: 1915,
  italie: 1915,
  colombia: 1900,
  belgium: 1885,
  belgique: 1885,
  morocco: 1875,
  maroc: 1875,
  senegal: 1845,
  nigeria: 1820,
  "ivory coast": 1825,
  "cote divoire": 1825,
  algeria: 1810,
  egypt: 1805,
  cameroon: 1790,
  benin: 1650,
};

function leagueBaselineEloAndGoals(externalLeague: string): {
  baseElo: number;
  avgGoals: number;
} {
  const slug = (externalLeague || "").toLowerCase();
  if (slug === "uefa.champions") return { baseElo: 1845, avgGoals: 2.94 };
  if (slug === "eng.1") return { baseElo: 1775, avgGoals: 2.88 };
  if (slug === "esp.1") return { baseElo: 1745, avgGoals: 2.56 };
  if (slug === "ita.1") return { baseElo: 1745, avgGoals: 2.62 };
  if (slug === "ger.1") return { baseElo: 1745, avgGoals: 3.04 };
  if (slug === "fra.1") return { baseElo: 1725, avgGoals: 2.70 };
  if (slug === "uefa.europa") return { baseElo: 1755, avgGoals: 2.82 };
  if (slug === "uefa.europa.conf") return { baseElo: 1690, avgGoals: 2.76 };
  if (slug === "por.1" || slug === "ned.1") return { baseElo: 1665, avgGoals: 2.86 };
  if (slug === "tur.1" || slug === "bel.1") return { baseElo: 1650, avgGoals: 2.78 };
  if (slug.endsWith(".2")) return { baseElo: 1595, avgGoals: 2.52 };
  return { baseElo: 1680, avgGoals: 2.68 };
}

function resolveClubElo(teamNames: string[], fallbackLeagueElo: number): number {
  for (const raw of teamNames) {
    if (!raw) continue;
    const key = normalizeClubKey(raw);
    if (REAL_CLUB_ELO[key] != null) return REAL_CLUB_ELO[key];
    for (const [knownKey, elo] of Object.entries(REAL_CLUB_ELO)) {
      if (knownKey.length >= 5 && key.length >= 5 && (key.includes(knownKey) || knownKey.includes(key))) {
        return elo;
      }
    }
  }
  return fallbackLeagueElo;
}

function parseSeasonRecordAdjustmentElo(comp: JsonRec): number {
  const records = asArr(comp.records ?? comp.record);
  for (const r of records) {
    const rec = asRec(r);
    const sum = asStr(rec?.summary || rec?.displayValue);
    const m = /^(\d+)-(\d+)-(\d+)$/.exec(sum);
    if (m) {
      const w = Number(m[1]);
      const d = Number(m[2]);
      const l = Number(m[3]);
      const gp = w + d + l;
      if (gp >= 1) {
        const ppgNorm = (w * 3 + d) / (gp * 3); // 0..1 (moyenne ligue ≈ 0,46)
        const shrinkage = gp / (gp + 10); // évite tout sur-ajustement en début de saison
        return clamp((ppgNorm - 0.46) * 210 * shrinkage, -88, 88);
      }
    }
  }
  return 0;
}

function computeSuggested1x2Odds(
  comp: JsonRec,
  homeComp: JsonRec,
  awayComp: JsonRec,
  externalLeague: string,
  homeNames: string[],
  awayNames: string[]
): {
  oddsHome: number;
  oddsDraw: number;
  oddsAway: number;
  source: "bookmaker" | "elo_form";
  expectedTotalGoals: number;
} {
  const { baseElo, avgGoals } = leagueBaselineEloAndGoals(externalLeague);

  for (const rawOddsItem of asArr(comp.odds)) {
    const oddsRec = asRec(rawOddsItem);
    if (!oddsRec) continue;
    const mlNode = asRec(oddsRec.moneyline);
    const pH =
      extractPreMatchMoneylineSideProb(mlNode?.home) ??
      extractPreMatchMoneylineSideProb(oddsRec.homeTeamOdds);
    const pA =
      extractPreMatchMoneylineSideProb(mlNode?.away) ??
      extractPreMatchMoneylineSideProb(oddsRec.awayTeamOdds);
    const pD =
      extractPreMatchMoneylineSideProb(mlNode?.draw) ??
      extractPreMatchMoneylineSideProb(oddsRec.drawOdds) ??
      oddsTokenToImpliedProb(oddsRec.drawOdds);

    if (pH != null && pA != null) {
      const rawD = pD ?? clamp(0.265 - Math.abs(pH - pA) * 0.16, 0.14, 0.31);
      const sum = pH + rawD + pA || 1;
      const overround = 1.058;

      let expectedTotalGoals = avgGoals;
      const ouLine = asNum(oddsRec.overUnder);
      if (ouLine != null && ouLine >= 1.5 && ouLine <= 4.5) {
        const totNode = asRec(oddsRec.total);
        const pOver =
          extractPreMatchMoneylineSideProb(totNode?.over) ??
          oddsTokenToImpliedProb(oddsRec.overOdds);
        const pUnder =
          extractPreMatchMoneylineSideProb(totNode?.under) ??
          oddsTokenToImpliedProb(oddsRec.underOdds);
        if (pOver != null && pUnder != null && pOver + pUnder > 0.5) {
          expectedTotalGoals = solveExpectedGoalsFromOverLine(
            ouLine,
            pOver / (pOver + pUnder)
          );
        } else {
          expectedTotalGoals = clamp(ouLine + 0.18, 1.85, 3.85);
        }
      }

      return {
        oddsHome: round2(clamp(1 / ((pH / sum) * overround), 1.06, 22)),
        oddsDraw: round2(clamp(1 / ((rawD / sum) * overround), 2.35, 14)),
        oddsAway: round2(clamp(1 / ((pA / sum) * overround), 1.06, 22)),
        source: "bookmaker",
        expectedTotalGoals,
      };
    }
  }

  // Modèle structurel Club Elo + niveau de compétition + forme saison pondérée (remplace le simple V-N-D)
  const eloH = resolveClubElo(homeNames, baseElo) + parseSeasonRecordAdjustmentElo(homeComp);
  const eloA = resolveClubElo(awayNames, baseElo) + parseSeasonRecordAdjustmentElo(awayComp);
  const homeAdv = comp.neutralSite === true ? 0 : 62;
  const eloDiff = clamp(eloH + homeAdv - eloA, -460, 460);

  const winExpH = 1 / (1 + Math.pow(10, -eloDiff / 315));
  const pDraw = clamp(
    0.235 * Math.exp(-Math.pow(eloDiff / 380, 2)) + 0.062,
    0.125,
    0.298
  );
  const decisive = 1 - pDraw;
  const pHome = clamp(decisive * winExpH, 0.035, 0.86);
  const pAway = clamp(decisive * (1 - winExpH), 0.035, 0.86);
  const sum = pHome + pDraw + pAway || 1;
  const overround = 1.058;

  // Un grand écart Elo augmente légèrement l'espérance de buts totale
  const mismatchBoost = Math.min(0.42, (Math.abs(eloDiff) / 400) * 0.34);
  const expectedTotalGoals = round2(clamp(avgGoals + mismatchBoost, 2.15, 3.55));

  return {
    oddsHome: round2(clamp(1 / ((pHome / sum) * overround), 1.09, 21)),
    oddsDraw: round2(clamp(1 / ((pDraw / sum) * overround), 2.75, 9.5)),
    oddsAway: round2(clamp(1 / ((pAway / sum) * overround), 1.09, 21)),
    source: "elo_form",
    expectedTotalGoals,
  };
}

function normalizeProbValue(raw: unknown): number | null {
  const n = asNum(raw);
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  if (n > 1.0001 && n <= 100) return n / 100;
  if (n <= 1.0001) return clamp(n, 0, 1);
  return null;
}

function isLiveTripletCoherentWithScore(
  pH: number,
  pD: number,
  pA: number,
  preOdds: { oddsHome: number; oddsDraw: number; oddsAway: number },
  homeScore: number,
  awayScore: number,
  minuteInt: number
): boolean {
  const invSum = 1 / preOdds.oddsHome + 1 / preOdds.oddsDraw + 1 / preOdds.oddsAway || 1;
  const preH = 1 / preOdds.oddsHome / invSum;
  const preD = 1 / preOdds.oddsDraw / invSum;
  const preA = 1 / preOdds.oddsAway / invSum;

  if (homeScore > awayScore && pH < preH - 0.03) return false;
  if (awayScore > homeScore && pA < preA - 0.03) return false;
  if (homeScore - awayScore >= 2 && minuteInt >= 55 && pH < 0.72) return false;
  if (awayScore - homeScore >= 2 && minuteInt >= 55 && pA < 0.72) return false;
  if (homeScore === awayScore && minuteInt >= 72 && pD < preD - 0.02) return false;
  return true;
}

/**
 * Extrait les cotes live `current` bookmaker et les probabilités live ESPN (`situation`, `winprobability`),
 * avec garde-fous stricts contre les lignes figées pré-match afin d'alimenter `realMatchScoreModel`.
 */
function extractLiveFeedSignals(params: {
  comp: JsonRec;
  root?: JsonRec | null;
  status: ParsedFeedMatch["status"];
  homeScore: number | null;
  awayScore: number | null;
  minute: string | null;
  clockSeconds: number | null;
  preOdds: { oddsHome: number; oddsDraw: number; oddsAway: number };
}): RealLiveFeedProbs | null {
  if (params.status !== "live") return null;
  const hScore = params.homeScore ?? 0;
  const aScore = params.awayScore ?? 0;
  const minInt =
    params.minute === "MT"
      ? 45
      : params.clockSeconds != null
        ? clamp(Math.floor(params.clockSeconds / 60) + 1, 1, 90)
        : parseClockMinuteInt(params.minute ?? "1", null, null);

  let bookLive: { pH: number; pD: number; pA: number } | null = null;
  for (const rawOddsItem of asArr(params.comp.odds)) {
    const oddsRec = asRec(rawOddsItem);
    if (!oddsRec) continue;
    const mlNode = asRec(oddsRec.moneyline);
    const hSide = mlNode?.home ? extractLiveCurrentSideProb(mlNode.home) : extractLiveCurrentSideProb(oddsRec.homeTeamOdds);
    const aSide = mlNode?.away ? extractLiveCurrentSideProb(mlNode.away) : extractLiveCurrentSideProb(oddsRec.awayTeamOdds);
    const dSide = mlNode?.draw ? extractLiveCurrentSideProb(mlNode.draw) : extractLiveCurrentSideProb(oddsRec.drawOdds);

    if (hSide.currentProb != null && aSide.currentProb != null && dSide.currentProb != null) {
      const sCur = hSide.currentProb + dSide.currentProb + aSide.currentProb;
      if (sCur < 0.95 || sCur > 1.25) continue;
      const pH = hSide.currentProb / sCur;
      const pD = dSide.currentProb / sCur;
      const pA = aSide.currentProb / sCur;

      // Vérifie que `current` est bien une ligne live dynamique et non une recopie statique de `open`/`close`
      let movedVsPre = minInt <= 6 && hScore === 0 && aScore === 0;
      if (!movedVsPre && hSide.preProb != null && aSide.preProb != null && dSide.preProb != null) {
        const sPre = hSide.preProb + dSide.preProb + aSide.preProb || 1;
        const maxDelta = Math.max(
          Math.abs(pH - hSide.preProb / sPre),
          Math.abs(pD - dSide.preProb / sPre),
          Math.abs(pA - aSide.preProb / sPre)
        );
        movedVsPre = maxDelta >= 0.032;
      }

      if (
        movedVsPre &&
        isLiveTripletCoherentWithScore(pH, pD, pA, params.preOdds, hScore, aScore, minInt)
      ) {
        bookLive = { pH, pD, pA };
        break;
      }
    }
  }

  let espnLive: { pH: number; pD: number; pA: number } | null = null;
  const probCandidates: unknown[] = [];
  const situationProb = asRec(asRec(params.comp.situation)?.lastPlay)?.probability;
  if (situationProb) probCandidates.push(situationProb);
  const winProbArr = asArr(params.root?.winprobability);
  if (winProbArr.length > 0) probCandidates.push(winProbArr[winProbArr.length - 1]);
  const compProbs = asArr(params.comp.probabilities);
  if (compProbs.length > 0) probCandidates.push(compProbs[compProbs.length - 1]);

  for (const cand of probCandidates) {
    const rec = asRec(cand);
    if (!rec) continue;
    const rawH = normalizeProbValue(rec.homeWinPercentage ?? rec.homeWinProbability);
    const rawA = normalizeProbValue(rec.awayWinPercentage ?? rec.awayWinProbability);
    const rawD = normalizeProbValue(
      rec.tiePercentage ?? rec.drawPercentage ?? rec.drawProbability
    );
    if (rawH != null && rawA != null) {
      const dVal = rawD ?? clamp(1 - rawH - rawA, 0.01, 0.90);
      const s = rawH + dVal + rawA;
      if (s >= 0.90 && s <= 1.10) {
        const pH = rawH / s;
        const pD = dVal / s;
        const pA = rawA / s;
        if (isLiveTripletCoherentWithScore(pH, pD, pA, params.preOdds, hScore, aScore, minInt)) {
          espnLive = { pH, pD, pA };
          break;
        }
      }
    }
  }

  if (!bookLive && !espnLive) return null;

  const updatedAtSec = params.clockSeconds ?? minInt * 60;
  if (bookLive && espnLive) {
    const pHome = bookLive.pH * 0.72 + espnLive.pH * 0.28;
    const pDraw = bookLive.pD * 0.72 + espnLive.pD * 0.28;
    const pAway = bookLive.pA * 0.72 + espnLive.pA * 0.28;
    const s = pHome + pDraw + pAway || 1;
    return {
      pHome: round2((pHome / s) * 100) / 100,
      pDraw: round2((pDraw / s) * 100) / 100,
      pAway: round2((pAway / s) * 100) / 100,
      source: "blended",
      updatedAtSec,
    };
  }
  if (bookLive) {
    return {
      pHome: Math.round(bookLive.pH * 1000) / 1000,
      pDraw: Math.round(bookLive.pD * 1000) / 1000,
      pAway: Math.round(bookLive.pA * 1000) / 1000,
      source: "bookmaker_live",
      updatedAtSec,
    };
  }
  return {
    pHome: Math.round(espnLive!.pH * 1000) / 1000,
    pDraw: Math.round(espnLive!.pD * 1000) / 1000,
    pAway: Math.round(espnLive!.pA * 1000) / 1000,
    source: "espn_live",
    updatedAtSec,
  };
}

function extractStatMap(statsArr: unknown[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of statsArr) {
    const r = asRec(item);
    if (!r) continue;
    const name = asStr(r.name || r.abbreviation || r.label).toLowerCase();
    const val = asStr(r.displayValue ?? r.value);
    if (name && val) out.set(name, val);
  }
  return out;
}

function parseShotsSummary(val: string | undefined): { total: number | null; onTarget: number | null } {
  if (!val) return { total: null, onTarget: null };
  const m = /(\d+)\s*\(\s*(\d+)\s*\)/.exec(val);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return { total: Math.max(a, b), onTarget: Math.min(a, b) };
  }
  const n = asNum(val);
  return { total: n, onTarget: null };
}

function buildRealStatsFromMaps(
  homeMap: Map<string, string>,
  awayMap: Map<string, string>,
  htHomeScore: number | null,
  htAwayScore: number | null,
  nowIso: string,
  clockSeconds: number | null = null,
  clockPeriod: number | null = null
): RealMatchStats | null {
  const numFrom = (map: Map<string, string>, keys: string[]): number | null => {
    for (const k of keys) {
      const hit = map.get(k);
      if (hit != null) {
        const parsed = asNum(hit);
        if (parsed != null) return parsed;
      }
    }
    return null;
  };

  const posH = numFrom(homeMap, ["possessionpct", "possession"]);
  const posA = numFrom(awayMap, ["possessionpct", "possession"]);

  const sumShotsH = parseShotsSummary(homeMap.get("shotssummary"));
  const sumShotsA = parseShotsSummary(awayMap.get("shotssummary"));

  const shotsTotalHome = numFrom(homeMap, ["totalshots", "shots"]) ?? sumShotsH.total;
  const shotsTotalAway = numFrom(awayMap, ["totalshots", "shots"]) ?? sumShotsA.total;
  const shotsOnTargetHome =
    numFrom(homeMap, ["shotsontarget", "sog"]) ?? sumShotsH.onTarget;
  const shotsOnTargetAway =
    numFrom(awayMap, ["shotsontarget", "sog"]) ?? sumShotsA.onTarget;

  const cornersHome = numFrom(homeMap, ["woncorners", "corners", "cornerkicks"]);
  const cornersAway = numFrom(awayMap, ["woncorners", "corners", "cornerkicks"]);
  const foulsHome = numFrom(homeMap, ["foulscommitted", "fouls"]);
  const foulsAway = numFrom(awayMap, ["foulscommitted", "fouls"]);
  const offsidesHome = numFrom(homeMap, ["offsides"]);
  const offsidesAway = numFrom(awayMap, ["offsides"]);
  const savesHome = numFrom(homeMap, ["saves"]);
  const savesAway = numFrom(awayMap, ["saves"]);
  const yellowCardsHome = numFrom(homeMap, ["yellowcards"]);
  const yellowCardsAway = numFrom(awayMap, ["yellowcards"]);

  const hasAny =
    posH != null ||
    shotsTotalHome != null ||
    shotsOnTargetHome != null ||
    cornersHome != null ||
    foulsHome != null ||
    savesHome != null ||
    htHomeScore != null ||
    clockSeconds != null;

  if (!hasAny) return null;

  return {
    possessionHome: posH != null ? Math.round(posH) : posA != null ? Math.max(0, 100 - Math.round(posA)) : null,
    possessionAway: posA != null ? Math.round(posA) : posH != null ? Math.max(0, 100 - Math.round(posH)) : null,
    shotsTotalHome,
    shotsTotalAway,
    shotsOnTargetHome,
    shotsOnTargetAway,
    cornersHome,
    cornersAway,
    foulsHome,
    foulsAway,
    offsidesHome,
    offsidesAway,
    savesHome,
    savesAway,
    yellowCardsHome,
    yellowCardsAway,
    htHomeScore,
    htAwayScore,
    clockSeconds,
    clockPeriod,
    updatedAt: nowIso,
  };
}

function parseDetailsEvents(
  rawDetails: unknown[],
  homeTeamId: string,
  awayTeamId: string,
  homeTeamName = "",
  awayTeamName = "",
  homeScore: number | null = null,
  awayScore: number | null = null
): { events: MatchTimelineEvent[]; redHome: number; redAway: number } {
  interface ParsedCandidate {
    type: "goal" | "red";
    team: "home" | "away";
    minute: number;
    stoppageMin: number;
    player?: string;
    playId: string;
    athleteId: string;
    secBucket: number | null;
  }

  const candidates: ParsedCandidate[] = [];

  for (const raw of rawDetails) {
    const d = asRec(raw);
    if (!d) continue;

    const periodRec = asRec(d.period);
    const periodNum = asNum(periodRec?.number);
    const clockObj = asRec(d.clock);
    const rawClockBase = asStr(clockObj?.displayValue);
    const addedClockObj = asRec(d.addedClock);
    const addedClockStr = asStr(addedClockObj?.displayValue);
    const rawClock =
      addedClockStr && !rawClockBase.includes("+")
        ? `${rawClockBase}${addedClockStr.startsWith("+") ? "" : "+"}${addedClockStr}`
        : rawClockBase;
    const secVal = asNum(clockObj?.value);

    // Règlement paris 1xBet temps réglementaire (90 min) : on ignore prolongation (> 90') et tirs au but
    if (d.shootout === true || isExtraTimeDetail(rawClock, periodNum, secVal)) continue;

    const teamObj = asRec(d.team);
    const teamId = asStr(teamObj?.id);
    const teamDisplay = asStr(teamObj?.displayName || teamObj?.shortDisplayName || teamObj?.name);
    const side: "home" | "away" | null =
      teamId && homeTeamId && teamId === homeTeamId
        ? "home"
        : teamId && awayTeamId && teamId === awayTeamId
          ? "away"
          : teamDisplay && homeTeamName && clubsMatchCanonical(teamDisplay, homeTeamName)
            ? "home"
            : teamDisplay && awayTeamName && clubsMatchCanonical(teamDisplay, awayTeamName)
              ? "away"
              : null;
    if (!side) continue;

    const typeObj = asRec(d.type);
    const typeText = asStr(typeObj?.text).toLowerCase();
    const isPenaltyMiss =
      typeText.includes("missed") ||
      typeText.includes("saved") ||
      d.DidNotScore === true;

    const isGoal =
      !isPenaltyMiss &&
      (d.scoringPlay === true ||
        typeText === "goal" ||
        typeText.includes("goal") ||
        typeText.includes("penalty - scored"));

    const isRed =
      !isGoal &&
      (d.redCard === true ||
        typeText.includes("red card") ||
        typeText.includes("second yellow"));

    if (!isGoal && !isRed) continue;

    const minute = parseClockMinuteInt(rawClock, periodNum, secVal);
    const mStop = /\+\s*(\d+)/.exec(rawClock);
    const stoppageMin = mStop ? Number(mStop[1]) : 0;

    const athletes = asArr(d.athletesInvolved);
    const firstAth = asRec(athletes[0]);
    const participants = asArr(d.participants);
    const firstPartAth = asRec(asRec(participants[0])?.athlete);

    const playId = asStr(d.id);
    const athleteId = asStr(firstAth?.id || firstPartAth?.id);
    const secBucket = secVal != null && secVal >= 0 ? Math.round(secVal) : null;

    let player =
      asStr(firstAth?.shortName || firstAth?.displayName) ||
      asStr(firstPartAth?.shortName || firstPartAth?.displayName) ||
      undefined;

    if (isGoal && player) {
      if (d.ownGoal === true || typeText.includes("own goal")) {
        player = `${player} (CSC)`;
      } else if (d.penaltyKick === true || typeText.includes("penalty")) {
        player = `${player} (P)`;
      }
    }

    const evType: "goal" | "red" = isGoal ? "goal" : "red";

    // Déduplication primaire inter-tableaux ESPN (`header.details` porte `shortName`,
    // `keyEvents` porte uniquement `displayName`, mais tous deux partagent `athlete.id` et `clock.value`).
    const duplicate = candidates.find((prev) => {
      if (prev.type !== evType || prev.team !== side) return false;
      if (playId && prev.playId && playId === prev.playId) return true;
      if (evType === "red" && athleteId && prev.athleteId && athleteId === prev.athleteId) {
        return true;
      }
      if (athleteId && prev.athleteId && athleteId === prev.athleteId) {
        const sameClockSec =
          secBucket != null &&
          prev.secBucket != null &&
          Math.abs(secBucket - prev.secBucket) <= 60;
        if (stoppageMin === prev.stoppageMin && (sameClockSec || Math.abs(minute - prev.minute) <= 1)) {
          return true;
        }
      }
      if (
        minute === prev.minute &&
        stoppageMin === prev.stoppageMin &&
        (!player || !prev.player || samePlayerIdentity(player, prev.player))
      ) {
        return true;
      }
      return false;
    });

    if (duplicate) {
      duplicate.player = pickPreferredPlayerLabel(duplicate.player, player);
      if (!duplicate.playId && playId) duplicate.playId = playId;
      if (!duplicate.athleteId && athleteId) duplicate.athleteId = athleteId;
      if (duplicate.secBucket == null && secBucket != null) duplicate.secBucket = secBucket;
      continue;
    }

    candidates.push({
      type: evType,
      team: side,
      minute,
      stoppageMin,
      ...(player ? { player } : {}),
      playId,
      athleteId,
      secBucket,
    });
  }

  const rawEvents: MatchTimelineEvent[] = candidates.map((c) => ({
    type: c.type,
    team: c.team,
    minute: c.minute,
    ...(c.player ? { player: c.player } : {}),
  }));

  const events = sanitizeMatchEvents(rawEvents, homeScore, awayScore);
  const redHome = events.filter((e) => e.type === "red" && e.team === "home").length;
  const redAway = events.filter((e) => e.type === "red" && e.team === "away").length;
  return { events, redHome, redAway };
}

function extractLinescores90AndHt(
  compSide: JsonRec,
  rawScore: number | null,
  period: number,
  isCompleted: boolean,
  statusName: string
): { regScore: number | null; htScore: number | null } {
  // Compatible à la fois avec `{ value: 0 }` (scoreboard) et `{ displayValue: "0" }` (summary)
  const ls = asArr(compSide.linescores)
    .map((x) => asNum(x))
    .filter((n): n is number => n != null);

  const htScore =
    ls.length >= 1 && (period >= 2 || isCompleted || statusName === "STATUS_HALFTIME")
      ? ls[0]
      : null;

  const wentBeyond90 =
    period > 2 ||
    statusName.includes("AET") ||
    statusName.includes("PEN") ||
    statusName.includes("OVERTIME") ||
    statusName.includes("SHOOTOUT");

  if (wentBeyond90 && ls.length >= 2) {
    return { regScore: ls[0] + ls[1], htScore: ls[0] };
  }

  return { regScore: rawScore, htScore };
}

function pickTeamLabel(teamObj: JsonRec | null): { display: string; full: string; short: string } {
  const full = asStr(teamObj?.displayName || teamObj?.name);
  const short = asStr(teamObj?.shortDisplayName || teamObj?.name);
  const display = full && full.length <= 26 ? full : (short || full);
  return { display, full: full || display, short: short || display };
}

/**
 * Parse défensif d'un événement du Scoreboard public ESPN Soccer.
 */
export function parseEspnScoreboardEvent(
  rawEvent: unknown,
  externalLeague: string,
  leagueLabelFallback?: string,
  nowIso = new Date().toISOString()
): ParsedFeedMatch | null {
  const ev = asRec(rawEvent);
  if (!ev) return null;

  const externalId = asStr(ev.id);
  const comp = asRec(asArr(ev.competitions)[0]) ?? ev;
  const competitors = asArr(comp.competitors);
  if (!externalId || competitors.length < 2) return null;

  const homeComp =
    competitors.map(asRec).find((c) => asStr(c?.homeAway).toLowerCase() === "home") ??
    asRec(competitors[0]);
  const awayComp =
    competitors.map(asRec).find((c) => asStr(c?.homeAway).toLowerCase() === "away") ??
    asRec(competitors[1]);
  if (!homeComp || !awayComp) return null;

  const homeTeamObj = asRec(homeComp.team);
  const awayTeamObj = asRec(awayComp.team);

  const hNames = pickTeamLabel(homeTeamObj);
  const aNames = pickTeamLabel(awayTeamObj);
  const homeTeam = hNames.display;
  const awayTeam = aNames.display;
  if (!homeTeam || !awayTeam) return null;

  const homeTeamId = asStr(homeTeamObj?.id || homeComp.id);
  const awayTeamId = asStr(awayTeamObj?.id || awayComp.id);

  const homeLogoUrl =
    asStr(homeTeamObj?.logo) ||
    asStr(asRec(asArr(homeTeamObj?.logos)[0])?.href) ||
    teamLogo(homeTeam) ||
    (homeTeamId && /^\d+$/.test(homeTeamId)
      ? `https://a.espncdn.com/i/teamlogos/soccer/500/${homeTeamId}.png`
      : null);
  const awayLogoUrl =
    asStr(awayTeamObj?.logo) ||
    asStr(asRec(asArr(awayTeamObj?.logos)[0])?.href) ||
    teamLogo(awayTeam) ||
    (awayTeamId && /^\d+$/.test(awayTeamId)
      ? `https://a.espncdn.com/i/teamlogos/soccer/500/${awayTeamId}.png`
      : null);

  const dateStr = asStr(comp.date || ev.date);
  const startsAt = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(startsAt.getTime())) return null;

  const statusObj = asRec(comp.status) ?? asRec(ev.status);
  const statusType = asRec(statusObj?.type);
  const state = asStr(statusType?.state).toLowerCase(); // "pre" | "in" | "post"
  const statusName = asStr(statusType?.name).toUpperCase();
  const completed = statusType?.completed === true;
  const period = asNum(statusObj?.period) ?? 1;
  const displayClock = asStr(statusObj?.displayClock);
  const rawClockSeconds = asNum(statusObj?.clock);

  const isPostponedOrCancelled =
    statusName.includes("POSTPONED") ||
    statusName.includes("CANCELED") ||
    statusName.includes("CANCELLED") ||
    statusName.includes("ABANDONED") ||
    statusName.includes("SUSPENDED");

  // En football 1xBet (90 min), dès l'entrée en prolongation (period > 2), le temps réglementaire est terminé !
  const regularTimeEnded =
    !isPostponedOrCancelled &&
    (completed ||
      state === "post" ||
      period > 2 ||
      statusName.includes("FULL_TIME") ||
      statusName.includes("FINAL") ||
      statusName.includes("OVERTIME") ||
      statusName.includes("SHOOTOUT"));

  const status: ParsedFeedMatch["status"] = isPostponedOrCancelled
    ? "postponed"
    : regularTimeEnded
      ? "finished"
      : state === "in"
        ? "live"
        : "upcoming";

  const rawHomeScore = status === "upcoming" ? null : asNum(homeComp.score);
  const rawAwayScore = status === "upcoming" ? null : asNum(awayComp.score);

  const { regScore: homeScore, htScore: htHomeRaw } = extractLinescores90AndHt(
    homeComp,
    rawHomeScore,
    period,
    regularTimeEnded,
    statusName
  );
  const { regScore: awayScore, htScore: htAwayRaw } = extractLinescores90AndHt(
    awayComp,
    rawAwayScore,
    period,
    regularTimeEnded,
    statusName
  );

  const { events, redHome: detailRedH, redAway: detailRedA } = parseDetailsEvents(
    asArr(comp.details),
    homeTeamId,
    awayTeamId,
    hNames.full,
    aNames.full,
    homeScore,
    awayScore
  );

  // Déduction complémentaire du score MT si tous les buts du match sont présents dans `events`
  const goalEvents = events.filter((e) => e.type === "goal");
  const exactGoalCoverage =
    homeScore != null &&
    awayScore != null &&
    goalEvents.filter((g) => g.team === "home").length === homeScore &&
    goalEvents.filter((g) => g.team === "away").length === awayScore;

  const htHomeScore =
    htHomeRaw ??
    (exactGoalCoverage && (period >= 2 || regularTimeEnded || statusName === "STATUS_HALFTIME")
      ? goalEvents.filter((g) => g.team === "home" && g.minute <= 45).length
      : null);
  const htAwayScore =
    htAwayRaw ??
    (exactGoalCoverage && (period >= 2 || regularTimeEnded || statusName === "STATUS_HALFTIME")
      ? goalEvents.filter((g) => g.team === "away" && g.minute <= 45).length
      : null);

  const homeStatMap = extractStatMap(asArr(homeComp.statistics));
  const awayStatMap = extractStatMap(asArr(awayComp.statistics));
  const statRedH = asNum(homeStatMap.get("redcards")) ?? 0;
  const statRedA = asNum(awayStatMap.get("redcards")) ?? 0;

  const minute =
    status === "finished"
      ? "Terminé"
      : status === "postponed"
        ? "Reporté"
        : status === "live"
          ? statusName === "STATUS_HALFTIME"
            ? "MT"
            : normalizeDisplayMinute(displayClock)
          : null;

  const liveClockSeconds =
    status === "live" && minute && minute !== "MT"
      ? normalizeEspnLiveClockSeconds(rawClockSeconds, period, minute)
      : null;

  const homeAliases = Array.from(
    new Set([homeTeam, hNames.full, hNames.short, asStr(homeTeamObj?.abbreviation)].filter(Boolean))
  );
  const awayAliases = Array.from(
    new Set([awayTeam, aNames.full, aNames.short, asStr(awayTeamObj?.abbreviation)].filter(Boolean))
  );

  const suggestedOdds = computeSuggested1x2Odds(
    comp,
    homeComp,
    awayComp,
    externalLeague,
    homeAliases,
    awayAliases
  );

  const liveFeedProbs = extractLiveFeedSignals({
    comp,
    root: ev,
    status,
    homeScore,
    awayScore,
    minute,
    clockSeconds: liveClockSeconds,
    preOdds: suggestedOdds,
  });

  const baseRealStats =
    status === "upcoming"
      ? null
      : buildRealStatsFromMaps(
          homeStatMap,
          awayStatMap,
          htHomeScore,
          htAwayScore,
          nowIso,
          liveClockSeconds,
          status === "live" ? period : null
        );

  const realStats: RealMatchStats | null =
    baseRealStats != null
      ? {
          ...baseRealStats,
          liveFeedProbs,
          feedTotalGoalsExpected: suggestedOdds.expectedTotalGoals,
        }
      : status === "live" && (liveFeedProbs != null || liveClockSeconds != null)
        ? {
            possessionHome: null,
            possessionAway: null,
            shotsTotalHome: null,
            shotsTotalAway: null,
            shotsOnTargetHome: null,
            shotsOnTargetAway: null,
            cornersHome: null,
            cornersAway: null,
            foulsHome: null,
            foulsAway: null,
            offsidesHome: null,
            offsidesAway: null,
            savesHome: null,
            savesAway: null,
            yellowCardsHome: null,
            yellowCardsAway: null,
            htHomeScore,
            htAwayScore,
            clockSeconds: liveClockSeconds,
            clockPeriod: period,
            liveFeedProbs,
            feedTotalGoalsExpected: suggestedOdds.expectedTotalGoals,
            updatedAt: nowIso,
          }
        : null;

  const venueObj = asRec(comp.venue);
  const venue = asStr(venueObj?.fullName) || null;

  return {
    externalId,
    externalLeague,
    leagueLabel: leagueLabelFallback ?? officialLeagueLabel(externalLeague),
    homeTeam,
    awayTeam,
    homeAliases,
    awayAliases,
    homeLogo: homeLogoUrl || null,
    awayLogo: awayLogoUrl || null,
    startsAt,
    status,
    minute,
    homeScore,
    awayScore,
    htHomeScore,
    htAwayScore,
    redHome: Math.max(detailRedH, statRedH),
    redAway: Math.max(detailRedA, statRedA),
    events,
    realStats,
    venue,
    suggestedOdds,
    liveFeedProbs,
  };
}

/**
 * Parse défensif du endpoint `summary?event=<id>` d'ESPN Soccer (boxscore complet + keyEvents + pickcenter + winprobability).
 */
export function parseEspnSummaryPayload(
  rawSummary: unknown,
  externalLeague = "all",
  nowIso = new Date().toISOString()
): ParsedFeedMatch | null {
  const root = asRec(rawSummary);
  if (!root) return null;

  const header = asRec(root.header);
  const headerComp = asRec(asArr(header?.competitions)[0]);
  if (!headerComp) return null;

  const headerLeague = asRec(header?.league);
  const resolvedLeague =
    externalLeague && externalLeague !== "all"
      ? externalLeague
      : asStr(headerLeague?.slug) || "all";
  const leagueFallback = officialLeagueLabel(
    resolvedLeague,
    asStr(headerLeague?.name) || "Football"
  );

  // Fusionne `keyEvents` dans `details` et injecte `pickcenter` + `winprobability` pour conserver les cotes live/pré-match
  const combinedDetails = [
    ...asArr(headerComp.details),
    ...asArr(root.keyEvents),
  ];
  const combinedOdds =
    asArr(headerComp.odds).length > 0
      ? asArr(headerComp.odds)
      : asArr(root.pickcenter);

  const syntheticEvent: JsonRec = {
    id: header?.id ?? headerComp.id,
    date: headerComp.date,
    winprobability: root.winprobability,
    predictor: root.predictor,
    competitions: [
      {
        ...headerComp,
        details: combinedDetails,
        odds: combinedOdds,
      },
    ],
  };

  const base = parseEspnScoreboardEvent(
    syntheticEvent,
    resolvedLeague,
    leagueFallback,
    nowIso
  );
  if (!base) return null;

  // Enrichissement prioritaire avec `boxscore.teams` (possession, tirs, tirs cadrés, corners, fautes, arrêts…)
  const boxscore = asRec(root.boxscore);
  const boxTeams = asArr(boxscore?.teams);
  if (boxTeams.length >= 2) {
    const competitors = asArr(headerComp.competitors).map(asRec);
    const homeTeamComp =
      competitors.find((c) => asStr(c?.homeAway).toLowerCase() === "home") ?? competitors[0];
    const awayTeamComp =
      competitors.find((c) => asStr(c?.homeAway).toLowerCase() === "away") ?? competitors[1];
    const homeId = asStr(asRec(homeTeamComp?.team)?.id || homeTeamComp?.id);
    const awayId = asStr(asRec(awayTeamComp?.team)?.id || awayTeamComp?.id);

    let boxHome = asRec(boxTeams[0]);
    let boxAway = asRec(boxTeams[1]);
    for (const bt of boxTeams) {
      const rec = asRec(bt);
      const tid = asStr(asRec(rec?.team)?.id);
      const ha = asStr(rec?.homeAway).toLowerCase();
      if ((tid && tid === homeId) || ha === "home") boxHome = rec;
      else if ((tid && tid === awayId) || ha === "away") boxAway = rec;
    }

    const hMap = extractStatMap(asArr(boxHome?.statistics));
    const aMap = extractStatMap(asArr(boxAway?.statistics));
    const boxHomeLogo =
      asStr(asRec(boxHome?.team)?.logo) ||
      asStr(asRec(asArr(asRec(boxHome?.team)?.logos)[0])?.href);
    const boxAwayLogo =
      asStr(asRec(boxAway?.team)?.logo) ||
      asStr(asRec(asArr(asRec(boxAway?.team)?.logos)[0])?.href);
    if (!base.homeLogo && boxHomeLogo) base.homeLogo = boxHomeLogo;
    if (!base.awayLogo && boxAwayLogo) base.awayLogo = boxAwayLogo;

    const richStats = buildRealStatsFromMaps(
      hMap,
      aMap,
      base.htHomeScore,
      base.htAwayScore,
      nowIso,
      base.realStats?.clockSeconds ?? null,
      base.realStats?.clockPeriod ?? null
    );
    if (richStats) {
      base.realStats = {
        ...richStats,
        liveFeedProbs: base.liveFeedProbs ?? base.realStats?.liveFeedProbs ?? null,
        feedTotalGoalsExpected:
          base.suggestedOdds.expectedTotalGoals ??
          base.realStats?.feedTotalGoalsExpected ??
          null,
      };
    }
    const statRedH = asNum(hMap.get("redcards")) ?? 0;
    const statRedA = asNum(aMap.get("redcards")) ?? 0;
    base.redHome = Math.max(base.redHome, statRedH);
    base.redAway = Math.max(base.redAway, statRedA);
  }

  return base;
}

/* ============================================================================
 *  COUCHE RÉSEAU SÉCURISÉE & REQUÊTES PAR JOURNÉE UNIQUE (`?dates=YYYYMMDD`)
 * ========================================================================== */

async function fetchJsonSafe(url: string, timeoutMs = 6_000): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; SportsFeedSync/1.1)",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

interface SingleScoreboardResult {
  ok: boolean;
  calendarType: string;
  calendarYmds: string[];
  items: ParsedFeedMatch[];
}

function extractCalendarYmds(lgObj: JsonRec | null): string[] {
  const cal = asArr(lgObj?.calendar);
  const out = new Set<string>();
  for (const entry of cal) {
    if (typeof entry === "string") {
      const d = new Date(entry);
      if (!Number.isNaN(d.getTime())) out.add(formatYmd(d));
    }
  }
  return [...out].sort();
}

async function fetchLeagueSingleScoreboard(
  leagueSlug: string,
  ymd?: string,
  timeoutMs = 6_000
): Promise<SingleScoreboardResult> {
  const qs = ymd ? `?dates=${encodeURIComponent(ymd)}&limit=100` : "?limit=100";
  const url = `${ESPN_SOCCER_BASE}/${encodeURIComponent(leagueSlug)}/scoreboard${qs}`;
  const json = await fetchJsonSafe(url, timeoutMs);
  const root = asRec(json);
  if (!root) {
    return { ok: false, calendarType: "", calendarYmds: [], items: [] };
  }

  const lgObj = asRec(asArr(root.leagues)[0]);
  const calendarType = asStr(lgObj?.calendarType).toLowerCase();
  const calendarYmds = extractCalendarYmds(lgObj);
  const fallbackLabel = officialLeagueLabel(leagueSlug, asStr(lgObj?.name) || "Football");
  const nowIso = new Date().toISOString();
  const items: ParsedFeedMatch[] = [];

  for (const rawEv of asArr(root.events)) {
    const parsed = parseEspnScoreboardEvent(rawEv, leagueSlug, fallbackLabel, nowIso);
    if (parsed) items.push(parsed);
  }

  return { ok: true, calendarType, calendarYmds, items };
}

function mergeParsedFeedMap(target: Map<string, ParsedFeedMatch>, incoming: ParsedFeedMatch[]): void {
  const rank = (s: ParsedFeedMatch["status"]) =>
    s === "finished" ? 4 : s === "live" ? 3 : s === "postponed" ? 2 : 1;

  for (const item of incoming) {
    const prev = target.get(item.externalId);
    if (!prev || rank(item.status) >= rank(prev.status)) {
      target.set(item.externalId, item);
    }
  }
}

async function fetchLeagueScoreboardForDays(
  leagueSlug: string,
  requestedYmds: string[]
): Promise<ParsedFeedMatch[]> {
  const uniqueDays = [...new Set(requestedYmds)].sort();
  if (uniqueDays.length === 0) return [];

  const merged = new Map<string, ParsedFeedMatch>();

  if (uniqueDays.length === 1) {
    const single = await fetchLeagueSingleScoreboard(leagueSlug, uniqueDays[0], 5_500);
    mergeParsedFeedMap(merged, single.items);
    return [...merged.values()];
  }

  // Appel initial sans `dates` pour récupérer à la fois la journée courante et `calendar`
  const base = await fetchLeagueSingleScoreboard(leagueSlug, undefined, 5_500);
  mergeParsedFeedMap(merged, base.items);

  let daysToQuery = uniqueDays;
  if (base.ok && base.calendarType === "day" && base.calendarYmds.length > 0) {
    const calSet = new Set(base.calendarYmds);
    daysToQuery = uniqueDays.filter((d) => calSet.has(d));
  }

  const dayResults = await mapWithConcurrency(daysToQuery, 5, (ymd) =>
    fetchLeagueSingleScoreboard(leagueSlug, ymd, 5_500)
  );
  for (const res of dayResults) {
    mergeParsedFeedMap(merged, res.items);
  }

  return [...merged.values()];
}

async function fetchMatchSummary(
  externalId: string,
  leagueSlug?: string | null
): Promise<ParsedFeedMatch | null> {
  const slug = leagueSlug && leagueSlug.trim() ? leagueSlug.trim() : "all";
  const url = `${ESPN_SOCCER_BASE}/${encodeURIComponent(slug)}/summary?event=${encodeURIComponent(externalId)}`;
  const t0 = Date.now();
  const json = await fetchJsonSafe(url, 3_800);
  if (json) {
    const parsed = parseEspnSummaryPayload(json, slug);
    if (parsed) return parsed;
  }
  // N'essaie le repli `/all/summary` que si le 1er appel a répondu rapidement (ex. slug 404),
  // jamais après un timeout réseau pour ne pas cumuler 2 attentes de 4–6 s.
  if (slug !== "all" && Date.now() - t0 < 2_200) {
    const fallbackUrl = `${ESPN_SOCCER_BASE}/all/summary?event=${encodeURIComponent(externalId)}`;
    const fallbackJson = await fetchJsonSafe(fallbackUrl, 3_200);
    if (fallbackJson) return parseEspnSummaryPayload(fallbackJson, slug);
  }
  return null;
}

let cachedSettlementMode: { mode: RealMatchSettlementMode; ts: number } | null = null;

export async function getRealMatchSettlementMode(): Promise<RealMatchSettlementMode> {
  if (cachedSettlementMode && Date.now() - cachedSettlementMode.ts < 15_000) {
    return cachedSettlementMode.mode;
  }
  try {
    const [row] = await db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.settingKey, "real_match_settlement_mode"));
    const raw = (row?.value as { mode?: string } | undefined)?.mode;
    const mode: RealMatchSettlementMode = raw === "confirm" ? "confirm" : "auto";
    cachedSettlementMode = { mode, ts: Date.now() };
    return mode;
  } catch {
    return "auto";
  }
}

export async function setRealMatchSettlementMode(
  mode: RealMatchSettlementMode
): Promise<RealMatchSettlementMode> {
  await db
    .insert(adminSettings)
    .values({
      settingKey: "real_match_settlement_mode",
      value: { mode },
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: adminSettings.settingKey,
      set: { value: { mode }, updatedAt: new Date() },
    });
  cachedSettlementMode = { mode, ts: Date.now() };
  return mode;
}

/* ============================================================================
 *  APPLICATION D'UNE MISE À JOUR OFFICIELLE SUR UNE LIGNE `matches` (RÉELLE)
 * ========================================================================== */

const lastSummaryFetchByExtId = new Map<string, number>();

function mergeRealStatsForLiveOrFinished(
  prevStats: RealMatchStats | null | undefined,
  incomingStats: RealMatchStats | null | undefined,
  feed: ParsedFeedMatch,
  nowIso: string
): RealMatchStats | null {
  if (!prevStats && !incomingStats && !feed.liveFeedProbs) return null;

  const base: RealMatchStats = {
    possessionHome: incomingStats?.possessionHome ?? prevStats?.possessionHome ?? null,
    possessionAway: incomingStats?.possessionAway ?? prevStats?.possessionAway ?? null,
    shotsTotalHome: incomingStats?.shotsTotalHome ?? prevStats?.shotsTotalHome ?? null,
    shotsTotalAway: incomingStats?.shotsTotalAway ?? prevStats?.shotsTotalAway ?? null,
    shotsOnTargetHome:
      incomingStats?.shotsOnTargetHome ?? prevStats?.shotsOnTargetHome ?? null,
    shotsOnTargetAway:
      incomingStats?.shotsOnTargetAway ?? prevStats?.shotsOnTargetAway ?? null,
    cornersHome: incomingStats?.cornersHome ?? prevStats?.cornersHome ?? null,
    cornersAway: incomingStats?.cornersAway ?? prevStats?.cornersAway ?? null,
    foulsHome: incomingStats?.foulsHome ?? prevStats?.foulsHome ?? null,
    foulsAway: incomingStats?.foulsAway ?? prevStats?.foulsAway ?? null,
    offsidesHome: incomingStats?.offsidesHome ?? prevStats?.offsidesHome ?? null,
    offsidesAway: incomingStats?.offsidesAway ?? prevStats?.offsidesAway ?? null,
    savesHome: incomingStats?.savesHome ?? prevStats?.savesHome ?? null,
    savesAway: incomingStats?.savesAway ?? prevStats?.savesAway ?? null,
    yellowCardsHome:
      incomingStats?.yellowCardsHome ?? prevStats?.yellowCardsHome ?? null,
    yellowCardsAway:
      incomingStats?.yellowCardsAway ?? prevStats?.yellowCardsAway ?? null,
    htHomeScore:
      feed.htHomeScore ??
      incomingStats?.htHomeScore ??
      prevStats?.htHomeScore ??
      null,
    htAwayScore:
      feed.htAwayScore ??
      incomingStats?.htAwayScore ??
      prevStats?.htAwayScore ??
      null,
    clockSeconds:
      incomingStats?.clockSeconds ??
      (feed.status === "live" ? prevStats?.clockSeconds ?? null : null),
    clockPeriod:
      incomingStats?.clockPeriod ??
      (feed.status === "live" ? prevStats?.clockPeriod ?? null : null),
    liveFeedProbs:
      feed.status === "live"
        ? (feed.liveFeedProbs ??
          incomingStats?.liveFeedProbs ??
          prevStats?.liveFeedProbs ??
          null)
        : null,
    feedTotalGoalsExpected:
      feed.suggestedOdds.expectedTotalGoals ??
      incomingStats?.feedTotalGoalsExpected ??
      prevStats?.feedTotalGoalsExpected ??
      null,
    updatedAt: incomingStats?.updatedAt ?? nowIso,
  };

  if (feed.status === "finished") {
    return base;
  }

  // Fenêtre glissante de snapshots pour mesurer la pression offensive des 10–15 dernières minutes
  const prevSnaps: RealStatSnapshot[] = Array.isArray(prevStats?.statSnapshots)
    ? [...prevStats.statSnapshots]
    : [];
  const curSec = base.clockSeconds;
  const hasAnyOffenseMetric =
    base.shotsOnTargetHome != null ||
    base.shotsTotalHome != null ||
    base.cornersHome != null;

  if (curSec != null && curSec >= 0 && hasAnyOffenseMetric) {
    const candSnap: RealStatSnapshot = {
      sec: Math.round(curSec),
      sotH: Math.max(0, base.shotsOnTargetHome ?? 0),
      sotA: Math.max(0, base.shotsOnTargetAway ?? 0),
      shH: Math.max(0, base.shotsTotalHome ?? 0),
      shA: Math.max(0, base.shotsTotalAway ?? 0),
      corH: Math.max(0, base.cornersHome ?? 0),
      corA: Math.max(0, base.cornersAway ?? 0),
    };
    const last = prevSnaps[prevSnaps.length - 1];
    if (!last) {
      prevSnaps.push(candSnap);
    } else if (candSnap.sec >= last.sec) {
      const statChanged =
        candSnap.sotH !== last.sotH ||
        candSnap.sotA !== last.sotA ||
        candSnap.shH !== last.shH ||
        candSnap.shA !== last.shA ||
        candSnap.corH !== last.corH ||
        candSnap.corA !== last.corA;
      if (candSnap.sec - last.sec >= 45 || (statChanged && candSnap.sec - last.sec >= 15)) {
        prevSnaps.push(candSnap);
      }
    }
  }

  if (prevSnaps.length > 0) {
    base.statSnapshots = prevSnaps.slice(-14);
  }
  return base;
}

export async function applyFeedUpdateToRealMatch(
  m: MatchRow,
  feed: ParsedFeedMatch,
  settlementMode: RealMatchSettlementMode,
  nowMs = Date.now()
): Promise<
  | "upcoming"
  | "upcoming_unchanged"
  | "live"
  | "settled"
  | "pending_confirm"
  | "postponed"
  | "ignored"
> {
  if (m.source !== "manual") return "ignored"; // Garde-fou absolu : ne touche jamais aux matchs virtuels

  const now = new Date(nowMs);
  const nowIso = now.toISOString();
  const prevHome = m.homeScore ?? 0;
  const prevAway = m.awayScore ?? 0;
  const prevRedH = m.redHome ?? 0;
  const prevRedA = m.redAway ?? 0;
  const adminLockedOdds = m.regime === "admin_odds_locked";

  // Match reporté ou annulé : on suspend immédiatement sans jamais régler à 0-0
  if (feed.status === "postponed") {
    await db
      .update(matches)
      .set({
        externalId: m.externalId ?? feed.externalId,
        externalLeague: m.externalLeague ?? feed.externalLeague,
        suspended: true,
        minute: "Reporté",
        feedSyncedAt: now,
        feedStatusNote: "POSTPONED: Match officiellement reporté/interrompu — marchés suspendus",
      })
      .where(and(eq(matches.id, m.id), eq(matches.source, "manual")));
    return "postponed";
  }

  // Match toujours à venir : rafraîchit aussi automatiquement les cotes pré-match jusqu'au coup d'envoi
  // (sauf si l'admin a explicitement figé des cotes manuelles via `admin_odds_locked`).
  if (feed.status === "upcoming") {
    const nextExtId = m.externalId ?? feed.externalId;
    const nextExtLeague = m.externalLeague ?? feed.externalLeague;
    const nextHomeLogo = m.homeLogo || feed.homeLogo;
    const nextAwayLogo = m.awayLogo || feed.awayLogo;
    const kickoffChanged = Math.abs(m.startsAt.getTime() - feed.startsAt.getTime()) > 60_000;
    const metaChanged =
      m.externalId !== nextExtId ||
      m.externalLeague !== nextExtLeague ||
      m.homeLogo !== nextHomeLogo ||
      m.awayLogo !== nextAwayLogo;

    const nextOddsHome = adminLockedOdds ? m.oddsHome : feed.suggestedOdds.oddsHome;
    const nextOddsDraw = adminLockedOdds ? m.oddsDraw : feed.suggestedOdds.oddsDraw;
    const nextOddsAway = adminLockedOdds ? m.oddsAway : feed.suggestedOdds.oddsAway;
    const oddsChanged =
      !adminLockedOdds &&
      (Math.abs(m.oddsHome - nextOddsHome) >= 0.03 ||
        Math.abs((m.oddsDraw ?? 3.2) - (nextOddsDraw ?? 3.2)) >= 0.03 ||
        Math.abs(m.oddsAway - nextOddsAway) >= 0.03);

    const staleStamp = !m.feedSyncedAt || nowMs - m.feedSyncedAt.getTime() >= 30 * 60_000;

    if (kickoffChanged || metaChanged || oddsChanged || staleStamp) {
      await db
        .update(matches)
        .set({
          externalId: nextExtId,
          externalLeague: nextExtLeague,
          startsAt: feed.startsAt,
          homeLogo: nextHomeLogo,
          awayLogo: nextAwayLogo,
          oddsHome: nextOddsHome,
          oddsDraw: nextOddsDraw,
          oddsAway: nextOddsAway,
          feedSyncedAt: now,
          feedStatusNote:
            feed.suggestedOdds.source === "bookmaker"
              ? "Relié au flux officiel · Cotes bookmaker synchronisées"
              : "Relié au flux officiel · Cotes Elo + forme synchronisées",
        })
        .where(and(eq(matches.id, m.id), eq(matches.source, "manual")));
      return kickoffChanged || metaChanged || oddsChanged ? "upcoming" : "upcoming_unchanged";
    }
    return "upcoming_unchanged";
  }

  const nextHome = feed.homeScore ?? prevHome;
  const nextAway = feed.awayScore ?? prevAway;
  const rawCandidateEvents =
    feed.events.length > 0 ? feed.events : (m.events ?? []);
  const mergedEvents = sanitizeMatchEvents(
    rawCandidateEvents,
    nextHome,
    nextAway
  );
  const reconciledReds = reconcileRedCardCounts(
    m.events,
    mergedEvents,
    prevRedH,
    prevRedA
  );
  const nextRedH =
    feed.realStats != null || feed.events.length > 0
      ? Math.max(feed.redHome, mergedEvents.filter((e) => e.type !== "goal" && e.team === "home").length)
      : Math.max(reconciledReds.redHome, feed.redHome);
  const nextRedA =
    feed.realStats != null || feed.events.length > 0
      ? Math.max(feed.redAway, mergedEvents.filter((e) => e.type !== "goal" && e.team === "away").length)
      : Math.max(reconciledReds.redAway, feed.redAway);

  const incidentChanged =
    m.status === "live" &&
    (nextHome !== prevHome ||
      nextAway !== prevAway ||
      nextRedH !== prevRedH ||
      nextRedA !== prevRedA);

  const mergedStats = mergeRealStatsForLiveOrFinished(
    m.realStats,
    feed.realStats,
    feed,
    nowIso
  );
  const nextHtHome = feed.htHomeScore ?? m.htHomeScore ?? null;
  const nextHtAway = feed.htAwayScore ?? m.htAwayScore ?? null;

  // Si ESPN fournit de vraies cotes pré-match `close`/`open` bookmaker, on ancre la base 90 min dessus
  const baseOddsHome =
    !adminLockedOdds && feed.suggestedOdds.source === "bookmaker"
      ? feed.suggestedOdds.oddsHome
      : m.oddsHome;
  const baseOddsDraw =
    !adminLockedOdds && feed.suggestedOdds.source === "bookmaker"
      ? feed.suggestedOdds.oddsDraw
      : m.oddsDraw;
  const baseOddsAway =
    !adminLockedOdds && feed.suggestedOdds.source === "bookmaker"
      ? feed.suggestedOdds.oddsAway
      : m.oddsAway;

  // Match en direct
  if (feed.status === "live") {
    const nextMinute = feed.minute ?? m.minute ?? "1’";
    const prevLiveHeadline =
      m.status === "live"
        ? computeRealLiveHeadline1x2Odds(m)
        : {
            oddsHome: baseOddsHome,
            oddsDraw: baseOddsDraw,
            oddsAway: baseOddsAway,
          };
    const nextLiveHeadline = computeRealLiveHeadline1x2Odds({
      ...m,
      status: "live",
      minute: nextMinute,
      homeScore: nextHome,
      awayScore: nextAway,
      htHomeScore: nextHtHome,
      htAwayScore: nextHtAway,
      redHome: nextRedH,
      redAway: nextRedA,
      oddsHome: baseOddsHome,
      oddsDraw: baseOddsDraw,
      oddsAway: baseOddsAway,
      events: mergedEvents,
      realStats: mergedStats,
    });

    const nextTickHistory = Array.isArray(m.tickHistory) ? [...m.tickHistory] : [];
    const minNum = parseClockMinuteInt(nextMinute, null, mergedStats?.clockSeconds ?? null);
    if (Math.abs(nextLiveHeadline.oddsHome - prevLiveHeadline.oddsHome) >= 0.04) {
      nextTickHistory.push({
        minute: minNum,
        market: "result",
        selection: "home",
        from: prevLiveHeadline.oddsHome,
        to: nextLiveHeadline.oddsHome,
      });
    }
    if (
      prevLiveHeadline.oddsDraw != null &&
      nextLiveHeadline.oddsDraw != null &&
      Math.abs(nextLiveHeadline.oddsDraw - prevLiveHeadline.oddsDraw) >= 0.04
    ) {
      nextTickHistory.push({
        minute: minNum,
        market: "result",
        selection: "draw",
        from: prevLiveHeadline.oddsDraw,
        to: nextLiveHeadline.oddsDraw,
      });
    }
    if (Math.abs(nextLiveHeadline.oddsAway - prevLiveHeadline.oddsAway) >= 0.04) {
      nextTickHistory.push({
        minute: minNum,
        market: "result",
        selection: "away",
        from: prevLiveHeadline.oddsAway,
        to: nextLiveHeadline.oddsAway,
      });
    }

    await db
      .update(matches)
      .set({
        externalId: m.externalId ?? feed.externalId,
        externalLeague: m.externalLeague ?? feed.externalLeague,
        status: "live",
        minute: nextMinute,
        homeScore: nextHome,
        awayScore: nextAway,
        htHomeScore: nextHtHome,
        htAwayScore: nextHtAway,
        redHome: nextRedH,
        redAway: nextRedA,
        oddsHome: baseOddsHome,
        oddsDraw: baseOddsDraw,
        oddsAway: baseOddsAway,
        events: mergedEvents,
        tickHistory: nextTickHistory.slice(-14),
        realStats: mergedStats,
        homeLogo: m.homeLogo || feed.homeLogo,
        awayLogo: m.awayLogo || feed.awayLogo,
        ...(incidentChanged ? { lastGoalAt: now } : {}),
        // Si le match était auto-suspendu lors d'une fausse alerte de fin, on le rouvre
        ...(m.feedFinishedAt ? { feedFinishedAt: null, suspended: false } : {}),
        feedSyncedAt: now,
        feedStatusNote: `Direct synchronisé (${nextMinute})`,
      })
      .where(and(eq(matches.id, m.id), eq(matches.source, "manual")));
    return "live";
  }

  // Coup de sifflet final détecté (`feed.status === "finished"`)
  const firstFtAt = m.feedFinishedAt ?? now;
  const scoreChangedAtFt =
    m.feedFinishedAt != null && (nextHome !== prevHome || nextAway !== prevAway);
  // Si un but VAR tardif a rectifié le score pendant la fenêtre de confirmation, on repart pour 25s
  const effectiveFtStart = scoreChangedAtFt ? now : firstFtAt;
  // Si le match s'est terminé pendant une absence de visiteurs (match resté en `upcoming` en base
  // ou aucune synchro serveur dans les 2 min 30 précédant la découverte de la fin), inutile d'ouvrir
  // un sas anti-VAR à retardement au réveil du site : on clôture et règle immédiatement.
  const finishedDuringAbsence =
    m.feedFinishedAt == null &&
    (m.status !== "live" ||
      !m.feedSyncedAt ||
      nowMs - m.feedSyncedAt.getTime() > ABSENCE_SYNC_GAP_MS);
  const endedLongAgo =
    nowMs - m.startsAt.getTime() > REAL_MATCH_ENDED_LONG_AGO_MS;
  const confirmationReady =
    finishedDuringAbsence ||
    endedLongAgo ||
    nowMs - effectiveFtStart.getTime() >= REAL_FT_CONFIRM_DELAY_MS;

  if (settlementMode === "confirm") {
    // Mode validation 1-clic admin : scores, stats et suspension automatiques, règlement au clic admin
    await db
      .update(matches)
      .set({
        externalId: m.externalId ?? feed.externalId,
        externalLeague: m.externalLeague ?? feed.externalLeague,
        status: "live",
        suspended: true,
        minute: "Fin (à valider)",
        homeScore: nextHome,
        awayScore: nextAway,
        htHomeScore: nextHtHome,
        htAwayScore: nextHtAway,
        redHome: nextRedH,
        redAway: nextRedA,
        events: mergedEvents,
        realStats: mergedStats,
        homeLogo: m.homeLogo || feed.homeLogo,
        awayLogo: m.awayLogo || feed.awayLogo,
        feedSyncedAt: now,
        feedFinishedAt: effectiveFtStart,
        feedStatusNote: `PENDING_FT_CONFIRM: Score final officiel ${nextHome}-${nextAway} prêt · En attente de validation admin`,
      })
      .where(and(eq(matches.id, m.id), eq(matches.source, "manual")));
    return "pending_confirm";
  }

  if (!confirmationReady) {
    const secsLeft = Math.max(
      5,
      Math.ceil((REAL_FT_CONFIRM_DELAY_MS - (nowMs - effectiveFtStart.getTime())) / 1_000)
    );
    await db
      .update(matches)
      .set({
        externalId: m.externalId ?? feed.externalId,
        externalLeague: m.externalLeague ?? feed.externalLeague,
        status: "live",
        suspended: true,
        minute: "Fin · Vérif.",
        homeScore: nextHome,
        awayScore: nextAway,
        htHomeScore: nextHtHome,
        htAwayScore: nextHtAway,
        redHome: nextRedH,
        redAway: nextRedA,
        events: mergedEvents,
        realStats: mergedStats,
        homeLogo: m.homeLogo || feed.homeLogo,
        awayLogo: m.awayLogo || feed.awayLogo,
        feedSyncedAt: now,
        feedFinishedAt: effectiveFtStart,
        feedStatusNote: `ANTI_VAR_CHECK: Fin officielle détectée (${nextHome}-${nextAway}) · Vérification anti-VAR (${secsLeft}s)`,
      })
      .where(and(eq(matches.id, m.id), eq(matches.source, "manual")));
    return "pending_confirm";
  }

  // Confirmation anti-VAR écoulée en mode "auto" : clôture officielle -> règlement automatique immédiat
  await db
    .update(matches)
    .set({
      externalId: m.externalId ?? feed.externalId,
      externalLeague: m.externalLeague ?? feed.externalLeague,
      status: "finished",
      suspended: false,
      minute: "Terminé",
      homeScore: nextHome,
      awayScore: nextAway,
      htHomeScore: nextHtHome,
      htAwayScore: nextHtAway,
      redHome: nextRedH,
      redAway: nextRedA,
      events: mergedEvents,
      realStats: mergedStats,
      homeLogo: m.homeLogo || feed.homeLogo,
      awayLogo: m.awayLogo || feed.awayLogo,
      finishedAt: now,
      feedSyncedAt: now,
      feedFinishedAt: effectiveFtStart,
      feedStatusNote: `Clôturé et réglé automatiquement (${nextHome}-${nextAway})`,
    })
    .where(and(eq(matches.id, m.id), eq(matches.source, "manual")));
  return "settled";
}

/* ============================================================================
 *  SYNCHRONISATION AUTOMATIQUE GROUPÉE & ANTI-PARI TARDIF EN DIRECT
 * ========================================================================== */

let lastRealSyncAt = 0;
let inFlightRealSync: Promise<RealSyncSummary> | null = null;

export function isRealFeedSyncInFlight(): boolean {
  return inFlightRealSync !== null;
}

export async function hasOverdueRealMatches(nowMs = Date.now()): Promise<boolean> {
  await ensureMatchStoreHydrated();
  const cachedManual = getCachedOpenManualMatches().filter((m) => m.autoSync);
  return cachedManual.some(
    (m) =>
      m.feedFinishedAt != null ||
      (m.status !== "finished" &&
        nowMs - m.startsAt.getTime() >= 110 * 60_000 &&
        (!m.feedSyncedAt || nowMs - m.feedSyncedAt.getTime() > 45_000))
  );
}

const EMPTY_SYNC_SUMMARY: RealSyncSummary = {
  activeCount: 0,
  syncedCount: 0,
  linkedCount: 0,
  liveCount: 0,
  settledCount: 0,
  pendingConfirmCount: 0,
};

export async function syncRealMatchesThrottled(force = false): Promise<RealSyncSummary> {
  if (inFlightRealSync) {
    return inFlightRealSync;
  }

  const nowMs = Date.now();
  await ensureMatchStoreHydrated();
  const precheckManual = getCachedOpenManualMatches().filter((m) => m.autoSync);
  const ftConfirmationDueNow = precheckManual.some(
    (m) =>
      m.feedFinishedAt != null &&
      nowMs - m.feedFinishedAt.getTime() >= REAL_FT_CONFIRM_DELAY_MS
  );

  if (!force && !ftConfirmationDueNow && nowMs - lastRealSyncAt < LIVE_FEED_SYNC_MS) {
    return EMPTY_SYNC_SUMMARY;
  }

  inFlightRealSync = (async (): Promise<RealSyncSummary> => {
    try {
      await ensureMatchStoreHydrated();
      const cachedManual = getCachedOpenManualMatches().filter((m) => m.autoSync);

      // Fast-path en RAM (0 requête SQL vers Neon) lorsqu'il n'y a aucun match réel autoSync
      if (!force && cachedManual.length === 0) {
        lastRealSyncAt = Date.now();
        return { ...EMPTY_SYNC_SUMMARY };
      }

      const cachedHasUrgent = cachedManual.some(
        (m) =>
          m.status === "live" ||
          m.feedFinishedAt != null ||
          !m.externalId ||
          m.startsAt.getTime() <= nowMs + 20 * 60_000
      );

      // Fast-path en RAM (0 requête SQL vers Neon) s'il n'y a que des matchs réels lointains
      if (!force && !cachedHasUrgent && nowMs - lastRealSyncAt < IDLE_FEED_SYNC_MS) {
        return { ...EMPTY_SYNC_SUMMARY, activeCount: cachedManual.length };
      }

      const openManual = await db
        .select()
        .from(matches)
        .where(
          and(
            eq(matches.source, "manual"),
            eq(matches.autoSync, true),
            ne(matches.status, "finished")
          )
        );

      if (openManual.length === 0) {
        lastRealSyncAt = Date.now();
        return { ...EMPTY_SYNC_SUMMARY };
      }

      const hasUrgent = openManual.some(
        (m) =>
          m.status === "live" ||
          m.feedFinishedAt != null ||
          !m.externalId ||
          m.startsAt.getTime() <= nowMs + 20 * 60_000
      );

      if (!force && !hasUrgent && nowMs - lastRealSyncAt < IDLE_FEED_SYNC_MS) {
        return { ...EMPTY_SYNC_SUMMARY, activeCount: openManual.length };
      }

      // Cible uniquement les matchs actifs, déjà débutés, imminents (< 3h), non reliés
      // ou non rafraîchis depuis >= 30 min : évite de requêter 14 jours de calendriers
      // sur 100+ matchs à venir à chaque cycle de 15 s sur Vercel Serverless.
      const candidatesToSync = openManual.filter(
        (m) =>
          force ||
          m.status === "live" ||
          m.feedFinishedAt != null ||
          !m.externalId ||
          !m.feedSyncedAt ||
          m.startsAt.getTime() <= nowMs + 3 * 3600_000 ||
          nowMs - m.feedSyncedAt.getTime() >= 30 * 60_000
      );

      if (candidatesToSync.length === 0) {
        lastRealSyncAt = Date.now();
        return { ...EMPTY_SYNC_SUMMARY, activeCount: openManual.length };
      }

      const settlementMode = await getRealMatchSettlementMode();

      // Regroupe uniquement les dates UTC exactes nécessaires par compétition (zéro requête inutile)
      const daysBySlug = new Map<string, Set<string>>();
      const todayYmd = formatYmd(new Date(nowMs));

      for (const m of candidatesToSync) {
        const slug = m.externalLeague || resolveEspnSlugForLeague(m.league);
        if (!slug) continue;
        let bucket = daysBySlug.get(slug);
        if (!bucket) {
          bucket = new Set<string>();
          daysBySlug.set(slug, bucket);
        }
        bucket.add(todayYmd);
        bucket.add(formatYmd(m.startsAt));
        if (!m.externalId) {
          bucket.add(formatYmd(new Date(m.startsAt.getTime() - 24 * 3600_000)));
          bucket.add(formatYmd(new Date(m.startsAt.getTime() + 24 * 3600_000)));
        }
      }

      const scoreboards = await mapWithConcurrency(
        [...daysBySlug.entries()],
        6,
        async ([slug, daySet]) => ({
          slug,
          items: await fetchLeagueScoreboardForDays(slug, [...daySet]),
        })
      );

      const byExternalId = new Map<string, ParsedFeedMatch>();
      const bySlugItems = new Map<string, ParsedFeedMatch[]>();
      for (const { slug, items } of scoreboards) {
        bySlugItems.set(slug, items);
        for (const item of items) {
          byExternalId.set(item.externalId, item);
        }
      }

      const summary: RealSyncSummary = {
        activeCount: openManual.length,
        syncedCount: 0,
        linkedCount: 0,
        liveCount: 0,
        settledCount: 0,
        pendingConfirmCount: 0,
      };

      interface ResolvedSyncEntry {
        m: MatchRow;
        wasUnlinked: boolean;
        feedMatch: ParsedFeedMatch | null;
        extId: string | null;
        extLeague: string | null;
        summaryPriority: number; // > 0 si un appel `/summary` enrichit utilement ce match
      }

      const resolvedEntries: ResolvedSyncEntry[] = candidatesToSync.map((m) => {
        const wasUnlinked = !m.externalId;
        let feedMatch: ParsedFeedMatch | null = m.externalId
          ? (byExternalId.get(m.externalId) ?? null)
          : null;

        // Auto-liaison prudente si le match a été créé manuellement sans `externalId`
        if (!feedMatch && !m.externalId) {
          const slug = m.externalLeague || resolveEspnSlugForLeague(m.league);
          const candidates = slug
            ? (bySlugItems.get(slug) ?? [...byExternalId.values()])
            : [...byExternalId.values()];
          const hit = candidates.find(
            (cand) =>
              Math.abs(cand.startsAt.getTime() - m.startsAt.getTime()) <= 48 * 3600_000 &&
              clubsMatchCanonical(m.homeTeam, cand.homeAliases) &&
              clubsMatchCanonical(m.awayTeam, cand.awayAliases)
          );
          if (hit) feedMatch = hit;
        }

        const extId = feedMatch?.externalId ?? m.externalId ?? null;
        const extLeague =
          feedMatch?.externalLeague ?? m.externalLeague ?? resolveEspnSlugForLeague(m.league);
        const lastSum = extId ? (lastSummaryFetchByExtId.get(extId) ?? 0) : 0;
        const needsUrgentHtSummary =
          Boolean(feedMatch) &&
          feedMatch!.status === "live" &&
          isFirstHalfCompleted(feedMatch!.minute, feedMatch!.status) &&
          feedMatch!.htHomeScore == null &&
          m.htHomeScore == null;

        let summaryPriority = 0;
        if (extId) {
          if (needsUrgentHtSummary) {
            summaryPriority = 4;
          } else if (
            feedMatch?.status === "live" &&
            (force || nowMs - lastSum >= SUMMARY_FETCH_INTERVAL_MS)
          ) {
            summaryPriority = 3;
          } else if (
            feedMatch?.status === "upcoming" &&
            feedMatch.suggestedOdds.source !== "bookmaker" &&
            m.regime !== "admin_odds_locked" &&
            m.startsAt.getTime() <= nowMs + 6 * 3600_000 &&
            (force || nowMs - lastSum >= 20 * 60_000)
          ) {
            summaryPriority = 2;
          } else if (!feedMatch && m.startsAt.getTime() <= nowMs + 2 * 3600_000) {
            summaryPriority = 2;
          } else if (
            feedMatch?.status === "finished" &&
            feedMatch.htHomeScore == null &&
            m.htHomeScore == null
          ) {
            summaryPriority = 3;
          } else if (
            feedMatch?.status === "finished" &&
            feedMatch.realStats == null &&
            m.realStats == null &&
            (force || nowMs - lastSum >= SUMMARY_FETCH_INTERVAL_MS)
          ) {
            summaryPriority = 1;
          }
        }

        return { m, wasUnlinked, feedMatch, extId, extLeague, summaryPriority };
      });

      // Enrichissement `/summary` en parallèle borné (max 10 par cycle) au lieu d'une boucle
      // séquentielle bloquante lorsque 20–30 matchs du dimanche soir se terminent ensemble.
      const MAX_SUMMARY_ENRICH_PER_SYNC = 10;
      const toEnrich = resolvedEntries
        .filter((e) => e.summaryPriority > 0 && e.extId)
        .sort((a, b) => b.summaryPriority - a.summaryPriority)
        .slice(0, MAX_SUMMARY_ENRICH_PER_SYNC);

      await mapWithConcurrency(toEnrich, 6, async (entry) => {
        if (!entry.extId) return;
        lastSummaryFetchByExtId.set(entry.extId, nowMs);
        const sbBefore = entry.feedMatch;
        const rich = await fetchMatchSummary(entry.extId, entry.extLeague);
        if (rich) {
          if (
            sbBefore &&
            sbBefore.suggestedOdds.source === "bookmaker" &&
            rich.suggestedOdds.source !== "bookmaker"
          ) {
            rich.suggestedOdds = sbBefore.suggestedOdds;
          }
          if (sbBefore?.liveFeedProbs && !rich.liveFeedProbs) {
            rich.liveFeedProbs = sbBefore.liveFeedProbs;
            if (rich.realStats) {
              rich.realStats.liveFeedProbs = sbBefore.liveFeedProbs;
            }
          }
          entry.feedMatch = rich;
        }
      });

      const entriesWithFeed = resolvedEntries.filter((e) => e.feedMatch !== null);
      const outcomes = await mapWithConcurrency(entriesWithFeed, 6, async (entry) => {
        const outcome = await applyFeedUpdateToRealMatch(
          entry.m,
          entry.feedMatch!,
          settlementMode,
          Date.now()
        );
        return { outcome, wasUnlinked: entry.wasUnlinked };
      });

      for (const { outcome, wasUnlinked } of outcomes) {
        if (outcome !== "ignored" && outcome !== "upcoming_unchanged") {
          summary.syncedCount += 1;
          if (wasUnlinked) summary.linkedCount += 1;
          if (outcome === "live") summary.liveCount += 1;
          if (outcome === "settled") summary.settledCount += 1;
          if (outcome === "pending_confirm") summary.pendingConfirmCount += 1;
        }
      }

      if (summary.syncedCount > 0) {
        invalidateAllActiveCaches();
      }
      lastRealSyncAt = Date.now();
      return summary;
    } finally {
      inFlightRealSync = null;
    }
  })();

  return inFlightRealSync;
}

/**
 * Force la synchronisation immédiate d'un match réel précis (utilisé par l'admin ou la vérif live).
 */
export async function syncSingleRealMatchNow(matchId: number): Promise<MatchRow | null> {
  const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!m || m.source !== "manual") return m ?? null;

  const settlementMode = await getRealMatchSettlementMode();
  let feedMatch: ParsedFeedMatch | null = null;

  const slug = m.externalLeague || resolveEspnSlugForLeague(m.league);
  if (m.externalId) {
    feedMatch = await fetchMatchSummary(m.externalId, slug);
  } else {
    const candidateSlugs = slug ? [slug] : [...TOP_DISCOVERY_LEAGUE_SLUGS];
    const searchDays = buildUtcDayYmds(
      new Date(m.startsAt.getTime() - 24 * 3600_000),
      new Date(m.startsAt.getTime() + 48 * 3600_000),
      5
    );
    for (const candSlug of candidateSlugs) {
      const list = await fetchLeagueScoreboardForDays(candSlug, searchDays);
      const hit = list.find(
        (cand) =>
          clubsMatchCanonical(m.homeTeam, cand.homeAliases) &&
          clubsMatchCanonical(m.awayTeam, cand.awayAliases)
      );
      if (hit) {
        feedMatch = (await fetchMatchSummary(hit.externalId, candSlug)) ?? hit;
        break;
      }
    }
  }

  if (feedMatch) {
    await applyFeedUpdateToRealMatch(m, feedMatch, settlementMode, Date.now());
  }

  const [updated] = await db.select().from(matches).where(eq(matches.id, matchId));
  return updated ?? m;
}

/**
 * Indique si un match réel en direct relié au flux automatique souffre d'un flux obsolète (> 90 s).
 */
export function isRealMatchFeedStale(
  m: Pick<MatchRow, "source" | "status" | "externalId" | "autoSync" | "feedSyncedAt">,
  nowMs = Date.now()
): boolean {
  if (m.source !== "manual" || m.status !== "live") return false;
  if (!m.externalId || !m.autoSync) return false;
  if (!m.feedSyncedAt) return false;
  return nowMs - m.feedSyncedAt.getTime() > STALE_LIVE_FEED_MAX_MS;
}

/**
 * Vérification anti « pari tardif » avant l'acceptation d'un pari ou d'un cash-out
 * sur un ou plusieurs matchs réels en direct.
 */
export async function verifyLiveRealMatchesBeforeBet(
  targetMatches: MatchRow[]
): Promise<{ ok: true; refreshedMap: Map<number, MatchRow> } | { ok: false; error: string }> {
  const liveReal = targetMatches.filter((m) => m.source === "manual" && m.status === "live");
  const refreshedMap = new Map<number, MatchRow>(targetMatches.map((m) => [m.id, m]));
  if (liveReal.length === 0) {
    return { ok: true, refreshedMap };
  }

  const now0 = Date.now();
  for (const m of liveReal) {
    if (m.suspended || isRealMatchPostIncidentSuspended(m, now0)) {
      return {
        ok: false,
        error: "Marchés momentanément suspendus suite à une action de jeu en direct",
      };
    }
    if (isRealMatchFeedStale(m, now0)) {
      return {
        ok: false,
        error: "Flux direct en cours de resynchronisation — réessayez dans quelques secondes",
      };
    }
  }

  const linkedLive = liveReal.filter((m) => Boolean(m.externalId && m.autoSync));
  if (linkedLive.length === 0) {
    return { ok: true, refreshedMap };
  }

  const snapshots = new Map(
    linkedLive.map((m) => [
      m.id,
      {
        homeScore: m.homeScore ?? 0,
        awayScore: m.awayScore ?? 0,
        redHome: m.redHome ?? 0,
        redAway: m.redAway ?? 0,
      },
    ])
  );

  // Buffer d'acceptation live type bookmaker (3 s) + relecture fraîche du flux officiel
  await new Promise((resolve) => setTimeout(resolve, LIVE_ACCEPTANCE_BUFFER_MS));

  const updatedList = await Promise.all(linkedLive.map((m) => syncSingleRealMatchNow(m.id)));
  const now1 = Date.now();

  for (const updated of updatedList) {
    if (!updated) {
      return { ok: false, error: "Match introuvable" };
    }
    refreshedMap.set(updated.id, updated);
    const snap = snapshots.get(updated.id)!;

    if (
      updated.status !== "live" ||
      updated.suspended ||
      isRealMatchPostIncidentSuspended(updated, now1) ||
      isRealMatchFeedStale(updated, now1)
    ) {
      return {
        ok: false,
        error: "Les marchés viennent d'être suspendus sur ce direct — veuillez revalider",
      };
    }

    if (
      (updated.homeScore ?? 0) !== snap.homeScore ||
      (updated.awayScore ?? 0) !== snap.awayScore ||
      (updated.redHome ?? 0) !== snap.redHome ||
      (updated.redAway ?? 0) !== snap.redAway
    ) {
      return {
        ok: false,
        error: "Action décisive détectée en direct (score ou carton modifié) — cotes actualisées",
      };
    }
  }

  return { ok: true, refreshedMap };
}

/* ============================================================================
 *  CATALOGUE D'IMPORT 1-CLIC DES VRAIS MATCHS OFFICIELS POUR `/admin`
 * ========================================================================== */

export async function discoverUpcomingRealMatches(
  leagueSlug = "top",
  daysAhead = 7
): Promise<{
  fixtures: DiscoveredOfficialFixture[];
  reachable: boolean;
  extendedWindow: boolean;
}> {
  const now = new Date();
  const clampedDays = clamp(daysAhead, 1, 14);
  const toDate = new Date(now.getTime() + clampedDays * 24 * 3600_000);
  const windowYmds = buildUtcDayYmds(now, toDate, 15);
  const todayYmd = windowYmds[0];
  const endYmd = windowYmds[windowYmds.length - 1];

  const isSingleCompetition = Boolean(leagueSlug && leagueSlug !== "top");
  const slugs = isSingleCompetition ? [leagueSlug] : [...TOP_DISCOVERY_LEAGUE_SLUGS];

  let reachable = false;
  let extendedWindow = false;
  const merged = new Map<string, ParsedFeedMatch>();

  // Étape 1 : appel initial léger par compétition (récupère la journée active + le calendrier officiel)
  const baseResults = await Promise.all(
    slugs.map(async (slug) => ({
      slug,
      res: await fetchLeagueSingleScoreboard(slug, undefined, 6_500),
    }))
  );

  const dayTasks: Array<{ slug: string; ymd: string }> = [];
  const cupFallbackSlugs: string[] = [];

  for (const { slug, res } of baseResults) {
    if (res.ok) reachable = true;
    // Conserve uniquement les événements dans l'horizon demandé (ou live aujourd'hui)
    const relevantBase = res.items.filter((it) => {
      if (it.status === "live") return true;
      if (it.status !== "upcoming") return false;
      const ymd = formatYmd(it.startsAt);
      return ymd >= todayYmd && ymd <= endYmd;
    });
    mergeParsedFeedMap(merged, relevantBase);

    if (res.ok && res.calendarType === "day" && res.calendarYmds.length > 0) {
      let targetYmds = res.calendarYmds.filter((d) => d >= todayYmd && d <= endYmd);
      // Si l'admin a choisi une ligue précise sans match dans la fenêtre (ex. trêve ou 24h en semaine),
      // on remonte automatiquement les 3 prochaines dates officielles du calendrier !
      if (targetYmds.length === 0 && isSingleCompetition) {
        targetYmds = res.calendarYmds.filter((d) => d >= todayYmd).slice(0, 3);
        if (targetYmds.length > 0) {
          extendedWindow = true;
          mergeParsedFeedMap(
            merged,
            res.items.filter((it) => it.status === "live" || it.status === "upcoming")
          );
        }
      }
      for (const ymd of targetYmds) {
        dayTasks.push({ slug, ymd });
      }
    } else {
      // Compétitions de coupe (ex. Ligue des Champions `calendarType: "list"`) : requête par jour
      for (const ymd of windowYmds) {
        dayTasks.push({ slug, ymd });
      }
      if (isSingleCompetition) {
        cupFallbackSlugs.push(slug);
      }
    }
  }

  // Étape 2 : requêtes unitaires `?dates=YYYYMMDD` avec contrôle de concurrence
  const dayFetched = await mapWithConcurrency(dayTasks, 8, async ({ slug, ymd }) =>
    fetchLeagueSingleScoreboard(slug, ymd, 6_500)
  );
  for (const df of dayFetched) {
    if (df.ok) reachable = true;
    mergeParsedFeedMap(merged, df.items);
  }

  // Étape 3 : si une coupe précise (ex. C1 / C3) n'a aucun match sur 1–7 j, scan automatique jusqu'à J+14
  let activeCandidates = [...merged.values()].filter(
    (f) => f.status === "upcoming" || f.status === "live"
  );
  if (activeCandidates.length === 0 && cupFallbackSlugs.length > 0 && clampedDays < 14) {
    const extStart = new Date(toDate.getTime() + 24 * 3600_000);
    const extEnd = new Date(now.getTime() + 14 * 24 * 3600_000);
    const extraYmds = buildUtcDayYmds(extStart, extEnd, 14);
    const extraTasks = cupFallbackSlugs.flatMap((slug) =>
      extraYmds.map((ymd) => ({ slug, ymd }))
    );
    const extraFetched = await mapWithConcurrency(extraTasks, 8, async ({ slug, ymd }) =>
      fetchLeagueSingleScoreboard(slug, ymd, 6_500)
    );
    for (const ef of extraFetched) {
      if (ef.ok) reachable = true;
      mergeParsedFeedMap(merged, ef.items);
    }
    activeCandidates = [...merged.values()].filter(
      (f) => f.status === "upcoming" || f.status === "live"
    );
    if (activeCandidates.length > 0) extendedWindow = true;
  }

  const candidateItems = activeCandidates.sort((a, b) => {
    if (a.status === "live" && b.status !== "live") return -1;
    if (b.status === "live" && a.status !== "live") return 1;
    return a.startsAt.getTime() - b.startsAt.getTime();
  });

  if (candidateItems.length === 0) {
    return { fixtures: [], reachable, extendedWindow };
  }

  const extIds = candidateItems.map((c) => c.externalId);
  const existingRows = await db
    .select({ id: matches.id, externalId: matches.externalId })
    .from(matches)
    .where(and(eq(matches.source, "manual"), inArray(matches.externalId, extIds)));

  const existingByExt = new Map<string, number>();
  for (const r of existingRows) {
    if (r.externalId) existingByExt.set(r.externalId, r.id);
  }

  const fixtures: DiscoveredOfficialFixture[] = candidateItems.map((item) => {
    const existingId = existingByExt.get(item.externalId) ?? null;
    return {
      externalId: item.externalId,
      externalLeague: item.externalLeague,
      leagueLabel: item.leagueLabel,
      homeTeam: item.homeTeam,
      awayTeam: item.awayTeam,
      homeLogo: item.homeLogo,
      awayLogo: item.awayLogo,
      startsAt: item.startsAt.toISOString(),
      status: item.status === "live" ? "live" : "upcoming",
      minute: item.minute,
      homeScore: item.homeScore,
      awayScore: item.awayScore,
      htHomeScore: item.htHomeScore,
      htAwayScore: item.htAwayScore,
      redHome: item.redHome,
      redAway: item.redAway,
      events: item.events,
      realStats: item.realStats,
      venue: item.venue,
      oddsHome: item.suggestedOdds.oddsHome,
      oddsDraw: item.suggestedOdds.oddsDraw,
      oddsAway: item.suggestedOdds.oddsAway,
      alreadyImported: existingId != null,
      existingMatchId: existingId,
    };
  });

  return { fixtures, reachable, extendedWindow };
}
