import type { ClientMatch } from "@/lib/api";
import { resolveEspnSlugForLeague } from "@/lib/real-leagues";

export type MatchStatusFilter = "all" | "live" | "upcoming" | "finished";
export type OddsProfileFilter = "all" | "favorite" | "tight";
export type StatusFilter = MatchStatusFilter;
export type OddsProfile = OddsProfileFilter;

export const VIRTUAL_FILTER_VALUE = "__virtual__";

export function isClearFavoriteMatch(m: ClientMatch): boolean {
  return Math.min(m.oddsHome, m.oddsAway) <= 1.85;
}

const TIER_S_CLUBS = [
  "real madrid",
  "barcelon",
  "paris saint-germain",
  "psg",
  "manchester city",
  "liverpool",
  "arsenal",
  "bayern",
  "inter milan",
  "internazionale",
];

const TIER_A_CLUBS = [
  "chelsea",
  "manchester united",
  "atletico",
  "atlético",
  "juventus",
  "ac milan",
  "dortmund",
  "marseille",
  "naples",
  "napoli",
  "leverkusen",
  "tottenham",
];

const TIER_B_CLUBS = [
  "monaco",
  "lyon",
  "lille",
  "aston villa",
  "newcastle",
  "athletic",
  "real betis",
  "villarreal",
  "rome",
  "roma",
  "atalanta",
  "benfica",
  "porto",
  "sporting",
  "ajax",
  "psv",
  "galatasaray",
  "fenerbah",
];

function clubPopularityScore(teamName: string): number {
  const n = teamName.toLowerCase();
  if (TIER_S_CLUBS.some((c) => n.includes(c))) return 20;
  if (TIER_A_CLUBS.some((c) => n.includes(c))) return 14;
  if (TIER_B_CLUBS.some((c) => n.includes(c))) return 9;
  return 4;
}

function leaguePopularityScore(league: string): number {
  const l = league.toLowerCase();
  if (
    l.includes("champions") ||
    l.includes("coupe du monde") ||
    l.includes("world cup") ||
    l === "can" ||
    l.includes("euro ")
  ) {
    return 50;
  }
  if (
    l.includes("premier league") ||
    l.includes("ligue 1") ||
    l.includes("laliga") ||
    l.includes("la liga") ||
    l.includes("serie a") ||
    l.includes("bundesliga")
  ) {
    return 42;
  }
  if (
    l.includes("ligue europa") ||
    l.includes("europa league") ||
    l.includes("nations")
  ) {
    return 34;
  }
  if (
    l.includes("conference") ||
    l.includes("fa cup") ||
    l.includes("copa del rey") ||
    l.includes("portugal") ||
    l.includes("eredivisie")
  ) {
    return 26;
  }
  return 18;
}

function scoreRealMatchBasePopularity(m: ClientMatch): number {
  const leaguePts = leaguePopularityScore(m.league);
  const clubsPts = clubPopularityScore(m.homeTeam) + clubPopularityScore(m.awayTeam);
  const oddsGap = Math.abs(m.oddsHome - m.oddsAway);
  const suspensePts = oddsGap <= 0.8 ? 8 : oddsGap <= 1.6 ? 4 : 0;
  return leaguePts + clubsPts + suspensePts;
}

function scoreRealLivePopularity(m: ClientMatch): number {
  const base = scoreRealMatchBasePopularity(m);
  const openBonus = m.suspended ? 0 : 12;
  const goalsBonus = Math.min(8, ((m.homeScore ?? 0) + (m.awayScore ?? 0)) * 2);
  return base + openBonus + goalsBonus;
}

function scoreRealPreMatchPopularity(
  m: ClientMatch,
  earliestUpcomingMs: number
): number {
  const base = scoreRealMatchBasePopularity(m);
  const kickoffMs = new Date(m.startsAt).getTime();
  const hoursAfterNext = Math.max(0, (kickoffMs - earliestUpcomingMs) / 3_600_000);
  const proximityPts =
    hoursAfterNext <= 10 ? 24 : hoursAfterNext <= 26 ? 15 : hoursAfterNext <= 54 ? 7 : 0;
  return base + proximityPts;
}

export function sortRealLiveByPopularity(list: ClientMatch[]): ClientMatch[] {
  if (list.length <= 1) return list;
  return list
    .map((m) => ({ m, s: scoreRealLivePopularity(m) }))
    .sort((a, b) => b.s - a.s || a.m.id - b.m.id)
    .map((x) => x.m);
}

function parseKickoffMs(iso: string | null | undefined): number {
  if (!iso) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

/**
 * Trie les matchs à venir strictement par date et heure de coup d'envoi
 * la plus proche d'abord (du plus présent au plus futur).
 * La notoriété ne départage que deux matchs programmés exactement à la même minute.
 */
export function sortRealUpcomingByPopularity(list: ClientMatch[]): ClientMatch[] {
  if (list.length <= 1) return list;
  const withTime = list.map((m) => ({
    m,
    t: parseKickoffMs(m.startsAt),
  }));
  let earliestMs = Infinity;
  for (const x of withTime) {
    if (x.t < earliestMs) earliestMs = x.t;
  }
  return withTime
    .map((x) => ({
      m: x.m,
      t: x.t,
      s: scoreRealPreMatchPopularity(x.m, earliestMs),
    }))
    .sort((a, b) => a.t - b.t || b.s - a.s || a.m.id - b.m.id)
    .map((x) => x.m);
}

export function sortByKickoffAsc(list: ClientMatch[]): ClientMatch[] {
  if (list.length <= 1) return list;
  return list
    .map((m) => ({ m, t: parseKickoffMs(m.startsAt) }))
    .sort((a, b) => a.t - b.t || a.m.id - b.m.id)
    .map((x) => x.m);
}

export function matchesSearchAndOdds(
  m: ClientMatch,
  qNorm: string,
  oddsProfile: OddsProfileFilter
): boolean {
  if (
    qNorm &&
    !m.homeTeam.toLowerCase().includes(qNorm) &&
    !m.awayTeam.toLowerCase().includes(qNorm) &&
    !m.league.toLowerCase().includes(qNorm)
  ) {
    return false;
  }
  if (oddsProfile === "favorite" && !isClearFavoriteMatch(m)) return false;
  if (oddsProfile === "tight" && isClearFavoriteMatch(m)) return false;
  return true;
}

const VIRTUAL_CLUBS_BY_SLUG: Record<string, string[]> = {
  "esp.1": [
    "real madrid",
    "barcelon",
    "atletico",
    "atlético",
    "athletic",
    "villarreal",
    "real sociedad",
    "real betis",
    "séville",
    "sevilla",
  ],
  "eng.1": [
    "manchester city",
    "liverpool",
    "arsenal",
    "chelsea",
    "newcastle",
    "aston villa",
    "tottenham",
    "manchester united",
    "brighton",
  ],
  "ger.1": ["bayern", "dortmund", "leverkusen", "leipzig"],
  "fra.1": [
    "paris sg",
    "paris saint-germain",
    "psg",
    "marseille",
    "monaco",
    "lille",
    "lyon",
    "nice",
    "lens",
    "toulouse",
  ],
  "ita.1": [
    "inter milan",
    "internazionale",
    "ac milan",
    "juventus",
    "naples",
    "napoli",
    "atalanta",
    "rome",
    "roma",
  ],
};

export function matchesClubForLeagueSlug(
  m: ClientMatch,
  slug: string | null
): boolean {
  if (!slug) return false;
  const clubs = VIRTUAL_CLUBS_BY_SLUG[slug];
  if (!clubs || clubs.length === 0) return false;
  const home = m.homeTeam.toLowerCase();
  const away = m.awayTeam.toLowerCase();
  return clubs.some((c) => home.includes(c) || away.includes(c));
}

export function matchesLeagueChoice(
  m: ClientMatch,
  leagueChoice: string,
  selectedSlug: string | null
): boolean {
  if (leagueChoice === "all" || leagueChoice === VIRTUAL_FILTER_VALUE) return true;
  if (m.league === leagueChoice) return true;
  if (!selectedSlug) return false;
  return resolveEspnSlugForLeague(m.league) === selectedSlug;
}

export function deduplicateLeagueNames(rawLeagues: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const lg of rawLeagues) {
    if (!lg || lg === VIRTUAL_FILTER_VALUE) continue;
    const slug = resolveEspnSlugForLeague(lg);
    const key = slug ? `slug:${slug}` : `raw:${lg.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(lg);
  }
  return unique;
}
