import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import type { MatchTimelineEvent } from "@/db/fixtures";
import { adminSettings, matches, type MatchRow, type RealMatchStats } from "@/db/schema";
import { isRealMatchPostIncidentSuspended } from "@/lib/markets";
import {
  officialLeagueLabel,
  resolveEspnSlugForLeague,
  TOP_DISCOVERY_LEAGUE_SLUGS,
} from "@/lib/real-leagues";
import { teamLogo } from "@/lib/team-logos";

const ESPN_SOCCER_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

/** Fréquence maximale de rafraîchissement des matchs réels en direct ou proches du coup d'envoi. */
const LIVE_FEED_SYNC_MS = 15_000;
/** Fréquence de vérification de fond lorsqu'il n'y a que des matchs réels à venir lointains. */
const IDLE_FEED_SYNC_MS = 180_000;
/** Fréquence maximale d'interrogation du résumé détaillé (`boxscore` stats) par match live. */
const SUMMARY_FETCH_INTERVAL_MS = 25_000;
/** Fenêtre de confirmation anti-VAR après détection du coup de sifflet final (90 secondes). */
export const REAL_FT_CONFIRM_DELAY_MS = 90_000;
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
  };
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
  const cleaned = rawClock.replace(/\s+/g, "").replace(/'\+/g, "+");
  if (!cleaned) return "LIVE";
  if (/^(MT|HT)$/i.test(cleaned)) return "MT";
  return cleaned.endsWith("'") ? cleaned : `${cleaned}'`;
}

function isExtraTimeDetail(
  rawClock: string,
  periodNum: number | null,
  secVal: number | null
): boolean {
  if (periodNum != null && periodNum > 2) return true;
  const mPlus = /(\d+)\s*'?\s*\+\s*(\d+)/.exec(rawClock);
  if (mPlus) {
    // 45'+2' -> base 45 (réglementaire) ; 90'+4' -> base 90 (réglementaire) ; 105'+1' -> prolongation
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
  const mPlus = /(\d+)\s*'?\s*\+\s*(\d+)/.exec(rawClock);
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

function extractMoneylineSideProb(sideNode: unknown): number | null {
  const rec = asRec(sideNode);
  if (!rec) return null;
  // Privilégie la cote pré-match (`close` puis `open`) sur la cote live (`current`)
  // afin que l'import d'un match en direct conserve de vraies cotes de base 90 min.
  const closeOdds = asRec(rec.close)?.odds;
  const openOdds = asRec(rec.open)?.odds;
  const currentOdds = asRec(rec.current)?.odds;
  return (
    oddsTokenToImpliedProb(closeOdds) ??
    oddsTokenToImpliedProb(openOdds) ??
    oddsTokenToImpliedProb(rec.moneyLine) ??
    oddsTokenToImpliedProb(currentOdds)
  );
}

function parseRecordStrength(comp: JsonRec): number {
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
      if (gp >= 2) {
        return (w * 3 + d) / (gp * 3); // points par match normalisés 0..1
      }
    }
  }
  return 0.48;
}

function computeSuggested1x2Odds(comp: JsonRec, homeComp: JsonRec, awayComp: JsonRec): {
  oddsHome: number;
  oddsDraw: number;
  oddsAway: number;
} {
  const firstOdds = asRec(asArr(comp.odds)[0]);
  if (firstOdds) {
    const mlNode = asRec(firstOdds.moneyline);
    const pH =
      extractMoneylineSideProb(mlNode?.home) ??
      extractMoneylineSideProb(firstOdds.homeTeamOdds);
    const pA =
      extractMoneylineSideProb(mlNode?.away) ??
      extractMoneylineSideProb(firstOdds.awayTeamOdds);
    const pD =
      extractMoneylineSideProb(mlNode?.draw) ??
      extractMoneylineSideProb(firstOdds.drawOdds) ??
      oddsTokenToImpliedProb(firstOdds.drawOdds);

    if (pH != null && pA != null) {
      const rawD = pD ?? clamp(0.26 - Math.abs(pH - pA) * 0.14, 0.16, 0.31);
      const sum = pH + rawD + pA || 1;
      const overround = 1.06;
      return {
        oddsHome: round2(clamp(1 / ((pH / sum) * overround), 1.08, 18)),
        oddsDraw: round2(clamp(1 / ((rawD / sum) * overround), 2.4, 12)),
        oddsAway: round2(clamp(1 / ((pA / sum) * overround), 1.08, 18)),
      };
    }
  }

  // Repli intelligent sur le bilan officiel W-D-L de la saison + léger avantage terrain
  const strH = parseRecordStrength(homeComp);
  const strA = parseRecordStrength(awayComp);
  const diff = clamp(strH - strA + 0.06, -0.55, 0.55);
  const pDraw = clamp(0.27 - Math.abs(diff) * 0.16, 0.17, 0.3);
  const rem = 1 - pDraw;
  const shareH = 1 / (1 + Math.exp(-3.1 * diff));
  const pHome = rem * shareH;
  const pAway = rem * (1 - shareH);
  const overround = 1.06;

  return {
    oddsHome: round2(clamp(1 / (pHome * overround), 1.18, 12)),
    oddsDraw: round2(clamp(1 / (pDraw * overround), 2.75, 7.5)),
    oddsAway: round2(clamp(1 / (pAway * overround), 1.18, 12)),
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
  nowIso: string
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
    htHomeScore != null;

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
    updatedAt: nowIso,
  };
}

function parseDetailsEvents(
  rawDetails: unknown[],
  homeTeamId: string,
  awayTeamId: string,
  homeTeamName = "",
  awayTeamName = ""
): { events: MatchTimelineEvent[]; redHome: number; redAway: number } {
  const events: MatchTimelineEvent[] = [];
  const seenKeys = new Set<string>();
  let redHome = 0;
  let redAway = 0;

  for (const raw of rawDetails) {
    const d = asRec(raw);
    if (!d) continue;

    const periodRec = asRec(d.period);
    const periodNum = asNum(periodRec?.number);
    const clockObj = asRec(d.clock);
    const rawClock = asStr(clockObj?.displayValue);
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

    const athletes = asArr(d.athletesInvolved);
    const firstAth = asRec(athletes[0]);
    const participants = asArr(d.participants);
    const firstPartAth = asRec(asRec(participants[0])?.athlete);
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

    const dedupeKey = `${isGoal ? "G" : "R"}|${side}|${minute}|${player ?? ""}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    if (isRed) {
      if (side === "home") redHome += 1;
      else redAway += 1;
    }

    events.push({
      type: isGoal ? "goal" : "red",
      team: side,
      minute,
      ...(player ? { player } : {}),
    });
  }

  events.sort((a, b) => a.minute - b.minute);
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
    teamLogo(homeTeam);
  const awayLogoUrl =
    asStr(awayTeamObj?.logo) ||
    asStr(asRec(asArr(awayTeamObj?.logos)[0])?.href) ||
    teamLogo(awayTeam);

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
    aNames.full
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

  const realStats =
    status === "upcoming"
      ? null
      : buildRealStatsFromMaps(homeStatMap, awayStatMap, htHomeScore, htAwayScore, nowIso);

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

  const venueObj = asRec(comp.venue);
  const venue = asStr(venueObj?.fullName) || null;

  return {
    externalId,
    externalLeague,
    leagueLabel: leagueLabelFallback ?? officialLeagueLabel(externalLeague),
    homeTeam,
    awayTeam,
    homeAliases: Array.from(
      new Set([homeTeam, hNames.full, hNames.short, asStr(homeTeamObj?.abbreviation)].filter(Boolean))
    ),
    awayAliases: Array.from(
      new Set([awayTeam, aNames.full, aNames.short, asStr(awayTeamObj?.abbreviation)].filter(Boolean))
    ),
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
    suggestedOdds: computeSuggested1x2Odds(comp, homeComp, awayComp),
  };
}

/**
 * Parse défensif du endpoint `summary?event=<id>` d'ESPN Soccer (boxscore complet + keyEvents).
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

  // Fusionne `keyEvents` dans `details` si `headerComp.details` est partiel ou absent
  const combinedDetails = [
    ...asArr(headerComp.details),
    ...asArr(root.keyEvents),
  ];

  const syntheticEvent: JsonRec = {
    id: header?.id ?? headerComp.id,
    date: headerComp.date,
    competitions: [
      {
        ...headerComp,
        details: combinedDetails,
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
    const richStats = buildRealStatsFromMaps(
      hMap,
      aMap,
      base.htHomeScore,
      base.htAwayScore,
      nowIso
    );
    if (richStats) {
      base.realStats = richStats;
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
  const json = await fetchJsonSafe(url, 6_000);
  if (json) {
    const parsed = parseEspnSummaryPayload(json, slug);
    if (parsed) return parsed;
  }
  if (slug !== "all") {
    const fallbackUrl = `${ESPN_SOCCER_BASE}/all/summary?event=${encodeURIComponent(externalId)}`;
    const fallbackJson = await fetchJsonSafe(fallbackUrl, 6_000);
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

export async function applyFeedUpdateToRealMatch(
  m: MatchRow,
  feed: ParsedFeedMatch,
  settlementMode: RealMatchSettlementMode,
  nowMs = Date.now()
): Promise<"upcoming" | "live" | "settled" | "pending_confirm" | "postponed" | "ignored"> {
  if (m.source !== "manual") return "ignored"; // Garde-fou absolu : ne touche jamais aux matchs virtuels

  const now = new Date(nowMs);
  const prevHome = m.homeScore ?? 0;
  const prevAway = m.awayScore ?? 0;
  const prevRedH = m.redHome ?? 0;
  const prevRedA = m.redAway ?? 0;

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

  // Match toujours à venir : met à jour l'heure exacte du coup d'envoi et les logos si absents
  if (feed.status === "upcoming") {
    await db
      .update(matches)
      .set({
        externalId: m.externalId ?? feed.externalId,
        externalLeague: m.externalLeague ?? feed.externalLeague,
        startsAt: feed.startsAt,
        homeLogo: m.homeLogo || feed.homeLogo,
        awayLogo: m.awayLogo || feed.awayLogo,
        feedSyncedAt: now,
        feedStatusNote: "Relié au flux officiel · En attente du coup d'envoi",
      })
      .where(and(eq(matches.id, m.id), eq(matches.source, "manual")));
    return "upcoming";
  }

  const nextHome = feed.homeScore ?? prevHome;
  const nextAway = feed.awayScore ?? prevAway;
  const nextRedH = Math.max(prevRedH, feed.redHome);
  const nextRedA = Math.max(prevRedA, feed.redAway);

  const incidentChanged =
    m.status === "live" &&
    (nextHome !== prevHome ||
      nextAway !== prevAway ||
      nextRedH !== prevRedH ||
      nextRedA !== prevRedA);

  const mergedEvents =
    feed.events.length > 0 ? feed.events : (m.events ?? []);
  const mergedStats = feed.realStats ?? m.realStats ?? null;
  const nextHtHome = feed.htHomeScore ?? m.htHomeScore ?? null;
  const nextHtAway = feed.htAwayScore ?? m.htAwayScore ?? null;

  // Match en direct
  if (feed.status === "live") {
    await db
      .update(matches)
      .set({
        externalId: m.externalId ?? feed.externalId,
        externalLeague: m.externalLeague ?? feed.externalLeague,
        status: "live",
        minute: feed.minute ?? m.minute ?? "1'",
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
        ...(incidentChanged ? { lastGoalAt: now } : {}),
        // Si le match était auto-suspendu lors d'une fausse alerte de fin, on le rouvre
        ...(m.feedFinishedAt ? { feedFinishedAt: null, suspended: false } : {}),
        feedSyncedAt: now,
        feedStatusNote: `Direct synchronisé (${feed.minute ?? "LIVE"})`,
      })
      .where(and(eq(matches.id, m.id), eq(matches.source, "manual")));
    return "live";
  }

  // Coup de sifflet final détecté (`feed.status === "finished"`)
  const firstFtAt = m.feedFinishedAt ?? now;
  const scoreChangedAtFt =
    m.feedFinishedAt != null && (nextHome !== prevHome || nextAway !== prevAway);
  // Si un but VAR tardif a rectifié le score pendant la fenêtre de confirmation, on repart pour 90s
  const effectiveFtStart = scoreChangedAtFt ? now : firstFtAt;
  const endedLongAgo = nowMs - m.startsAt.getTime() > 3.5 * 3600_000;
  const confirmationReady =
    endedLongAgo || nowMs - effectiveFtStart.getTime() >= REAL_FT_CONFIRM_DELAY_MS;

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
  if (!force && nowMs - lastRealSyncAt < LIVE_FEED_SYNC_MS) {
    return EMPTY_SYNC_SUMMARY;
  }

  inFlightRealSync = (async (): Promise<RealSyncSummary> => {
    try {
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

      const settlementMode = await getRealMatchSettlementMode();

      // Regroupe uniquement les dates UTC exactes nécessaires par compétition (zéro requête inutile)
      const daysBySlug = new Map<string, Set<string>>();
      const todayYmd = formatYmd(new Date(nowMs));

      for (const m of openManual) {
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

      const scoreboards = await Promise.all(
        [...daysBySlug.entries()].map(async ([slug, daySet]) => ({
          slug,
          items: await fetchLeagueScoreboardForDays(slug, [...daySet]),
        }))
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

      for (const m of openManual) {
        const wasUnlinked = !m.externalId;
        let feedMatch: ParsedFeedMatch | null = m.externalId
          ? (byExternalId.get(m.externalId) ?? null)
          : null;

        // Auto-liaison prudente si le match a été créé manuellement sans `externalId`
        if (!feedMatch && !m.externalId) {
          const slug = m.externalLeague || resolveEspnSlugForLeague(m.league);
          const candidates = slug ? (bySlugItems.get(slug) ?? [...byExternalId.values()]) : [...byExternalId.values()];
          const hit = candidates.find(
            (cand) =>
              Math.abs(cand.startsAt.getTime() - m.startsAt.getTime()) <= 48 * 3600_000 &&
              clubsMatchCanonical(m.homeTeam, cand.homeAliases) &&
              clubsMatchCanonical(m.awayTeam, cand.awayAliases)
          );
          if (hit) feedMatch = hit;
        }

        // Enrichit via `summary?event=<id>` si le match est absent du scoreboard du jour
        // ou s'il est en direct / terminé (pour récupérer le boxscore complet)
        const extId = feedMatch?.externalId ?? m.externalId;
        const extLeague =
          feedMatch?.externalLeague ?? m.externalLeague ?? resolveEspnSlugForLeague(m.league);
        const lastSum = extId ? (lastSummaryFetchByExtId.get(extId) ?? 0) : 0;
        const shouldEnrichSummary =
          Boolean(extId) &&
          (!feedMatch ||
            ((feedMatch.status === "live" || feedMatch.status === "finished") &&
              (force || nowMs - lastSum >= SUMMARY_FETCH_INTERVAL_MS)));

        if (extId && shouldEnrichSummary) {
          lastSummaryFetchByExtId.set(extId, nowMs);
          const rich = await fetchMatchSummary(extId, extLeague);
          if (rich) {
            feedMatch = rich;
          }
        }

        if (feedMatch) {
          const outcome = await applyFeedUpdateToRealMatch(m, feedMatch, settlementMode, Date.now());
          if (outcome !== "ignored") {
            summary.syncedCount += 1;
            if (wasUnlinked) summary.linkedCount += 1;
            if (outcome === "live") summary.liveCount += 1;
            if (outcome === "settled") summary.settledCount += 1;
            if (outcome === "pending_confirm") summary.pendingConfirmCount += 1;
          }
        }
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
