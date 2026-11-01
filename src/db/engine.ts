import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { settlePendingCombos } from "@/lib/combo";
import { settleMatchesBetsBatch } from "@/lib/settle";
import { adminSettings, appUser, bets, comboBets, matches, type MatchRow } from "@/db/schema";
import {
  expectedGoals,
  hashString,
  liveOddsFor,
  minuteGoalShare,
  oddsFor,
  pickScorerName,
  teamStrength,
} from "@/db/fixtures";
import {
  computeUserPatternRiskWeights,
  getGlobalHouseHealth,
} from "@/lib/house-brain";
import {
  ensureMatchStoreHydrated,
  getCachedActiveVirtualMatches,
  getCachedMatchById,
  getCachedPendingBookForMatches,
  invalidateAllActiveCaches,
  upsertCachedMatches,
} from "@/lib/active-state-cache";
import { minuteNumber } from "@/lib/markets";
import { buildServerClockAnchor } from "@/lib/live-clock";
import { ensureMlLoaded, recordMatchesFinishedBatchMl } from "@/lib/ml-engine";
import { createServerRng, hmacUint32 } from "@/lib/server-rng";
import { teamLogo, virtualClubNames, virtualTeamAliases, virtualTeamIdentity } from "@/lib/team-logos";
import { planVirtualQueue, sharesVirtualTeam, virtualPairKey, coprimeStride, buildVirtualFixturePool, VIRTUAL_REMATCH_GAP_MS, VIRTUAL_MAX_LIVE, VIRTUAL_KICKOFF_GAP_MS, VIRTUAL_LIVE_PRIME_HORIZON_MS, type VirtualFixtureWindow } from "@/lib/virtual-fixtures";
import { claimVirtualKickoff, VIRTUAL_SCHEDULE_LOCK } from "@/db/virtual-kickoff";

/** Suspension brève du marché après un but (~2,2 s). */
const GOAL_SUSPEND_MS = 2_200;
const TICK_THROTTLE_MS = 2_400;
/** Transition courte entre la fin d'un match et le coup d'envoi planifié du suivant sur un même canal. */
const INTER_MATCH_GAP_MS = 3_000;

/**
 * Rythme des matchs :
 * - Matchs virtuels automatiques (`source = "virtual"`) : durée totale de 10 minutes
 *   (95 pas d'horloge × [6 240 ms .. 6 400 ms] ≈ 9m53s .. 10m08s, moyenne exacte 10 min 00 s),
 *   avec au moins 3 minutes entre deux coups d'envoi successifs.
 * - Matchs manuels créés par l'admin (`source = "manual"`) : rythme réel confortable (40 s / min)
 *   pour laisser le pilotage complet à l'administrateur.
 */
export const MANUAL_MINUTE_REAL_MS = 40_000;
export const VIRTUAL_STEP_MIN_MS = 6_240; // ~9 min 53 s au total
export const VIRTUAL_STEP_MAX_MS = 6_400; // ~10 min 08 s au total (moyenne 10 min 00 s)
const TOTAL_CLOCK_STEPS = 95;

/** Plafond conservé pour les directs déjà existants. */
export const CONCURRENT_LIVE_VIRTUAL = VIRTUAL_MAX_LIVE;
const MIN_ACTIVE_VIRTUAL = 11;
const TARGET_ACTIVE_VIRTUAL = 12;

const MATCH_REGIMES = [
  "balanced",
  "tactical_lock",
  "high_tempo",
  "underdog_ambush",
  "favorite_surge",
  "late_drama",
] as const;

interface FixtureTemplate {
  league: string;
  home: string;
  away: string;
}

/** Affiches historiques, complétées par une coupe virtuelle de clubs variés. */
const CLASSIC_FIXTURES: FixtureTemplate[] = [
  { league: "Ligue 1", home: "Marseille", away: "Paris SG" },
  { league: "Premier League", home: "Chelsea", away: "Arsenal" },
  { league: "Ligue des Champions", home: "Bayern Munich", away: "Real Madrid" },
  { league: "Premier League", home: "Liverpool", away: "Manchester City" },
  { league: "Liga", home: "Atlético Madrid", away: "FC Barcelone" },
  { league: "Serie A", home: "Juventus", away: "Inter Milan" },
  { league: "Bundesliga", home: "Dortmund", away: "Leverkusen" },
  { league: "Ligue 1", home: "Lyon", away: "Monaco" },
  { league: "Serie A", home: "AC Milan", away: "Naples" },
  { league: "Liga", home: "Real Betis", away: "Villarreal" },
  { league: "Premier League", home: "Newcastle", away: "Aston Villa" },
  { league: "Ligue 1", home: "Nice", away: "Lille" },
  { league: "Ligue des Champions", home: "Inter Milan", away: "Paris SG" },
  { league: "Premier League", home: "Manchester United", away: "Tottenham" },
  { league: "Bundesliga", home: "RB Leipzig", away: "Bayern Munich" },
  { league: "Serie A", home: "AS Rome", away: "Atalanta" },
  { league: "Liga", home: "Real Sociedad", away: "Athletic Bilbao" },
  { league: "Ligue 1", home: "Rennes", away: "Lens" },
  { league: "Ligue des Champions", home: "FC Barcelone", away: "Liverpool" },
  { league: "Premier League", home: "Bournemouth", away: "Brighton" },
  { league: "Bundesliga", home: "Stuttgart", away: "Eintracht Francfort" },
  { league: "Serie A", home: "Fiorentina", away: "Latium" },
  { league: "Ligue 1", home: "Toulouse", away: "Strasbourg" },
  { league: "Liga", home: "Valence", away: "FC Séville" },
  { league: "Ligue 1", home: "Brest", away: "Paris SG" },
  { league: "Premier League", home: "Everton", away: "Liverpool" },
  { league: "Liga", home: "Getafe", away: "Real Madrid" },
  { league: "Bundesliga", home: "Augsbourg", away: "Bayern Munich" },
  { league: "Serie A", home: "Bologne", away: "AC Milan" },
  { league: "Premier League", home: "Crystal Palace", away: "Chelsea" },
  { league: "Ligue des Champions", home: "Sporting CP", away: "Arsenal" },
  { league: "Liga", home: "Gérone", away: "Atlético Madrid" },
  { league: "Serie A", home: "Turin", away: "Naples" },
  { league: "Bundesliga", home: "Fribourg", away: "Dortmund" },
  { league: "Ligue 1", home: "Reims", away: "Marseille" },
  { league: "Ligue des Champions", home: "PSV Eindhoven", away: "Manchester City" },
];

const FIXTURE_POOL = buildVirtualFixturePool(CLASSIC_FIXTURES, virtualClubNames());

/**
 * Oriente une affiche Domicile / Extérieur sans aucun biais exploitable :
 * alterne dynamiquement les favoris à domicile et les favoris en déplacement
 * pour maintenir une parité ~50/50 dans la file active.
 */
export function orientFixtureBalanced(
  fx: FixtureTemplate,
  seedTag: string,
  currentNetHomeStronger: number
): FixtureTemplate {
  const sA = teamStrength(fx.home);
  const sB = teamStrength(fx.away);
  const rng = createServerRng(`orient|${seedTag}|${fx.home}|${fx.away}`);

  if (Math.abs(sA - sB) <= 1) {
    return rng() < 0.5 ? fx : { league: fx.league, home: fx.away, away: fx.home };
  }

  const stronger = sA > sB ? fx.home : fx.away;
  const weaker = sA > sB ? fx.away : fx.home;

  // Si la file a déjà plus de favoris à domicile, place le club le plus fort à l'extérieur (et inversement)
  let putStrongerAway: boolean;
  if (currentNetHomeStronger >= 1) {
    putStrongerAway = rng() < 0.82;
  } else if (currentNetHomeStronger <= -1) {
    putStrongerAway = rng() < 0.18;
  } else {
    putStrongerAway = rng() < 0.54;
  }

  return putStrongerAway
    ? { league: fx.league, home: weaker, away: stronger }
    : { league: fx.league, home: stronger, away: weaker };
}

let lastTick = 0;
let inFlight: Promise<void> | null = null;

/** Pas d'horloge (ms par minute simulée) propre à chaque match. */
export function stepMsForMatch(matchId: number, source?: string | null): number {
  if (source === "manual") return MANUAL_MINUTE_REAL_MS;
  const h = hashString(`virt-tempo|${matchId}`);
  const span = VIRTUAL_STEP_MAX_MS - VIRTUAL_STEP_MIN_MS;
  return VIRTUAL_STEP_MIN_MS + (h % (span + 1));
}

/** Durée totale d'un match (ms) du coup d'envoi jusqu'au coup de sifflet final. */
export function matchDurationMs(matchId: number, source?: string | null): number {
  return TOTAL_CLOCK_STEPS * stepMsForMatch(matchId, source);
}

function expectedMatchEndMs(m: Pick<MatchRow, "id" | "source" | "startsAt">, now: number): number {
  return Math.max(now + 2_000, m.startsAt.getTime() + matchDurationMs(m.id, m.source));
}

/**
 * Calcule une heure de coup d'envoi cohérente avec une minute de jeu cible
 * (en tenant compte du temps additionnel 1re MT + pause mi-temps).
 */
export function backdateStartsAtForMinute(
  targetMinute: number,
  now = Date.now(),
  source: string | null = "manual",
  matchId = 1
): Date {
  const m = Math.max(1, Math.min(90, Math.floor(targetMinute)));
  const step = m <= 45 ? m : m + 3;
  const stepMs = stepMsForMatch(matchId, source);
  return new Date(now - (step - 1) * stepMs);
}

interface ClockState {
  minuteLabel: string;
  gameMinute: number;
  phase: "1H" | "1H_STOPPAGE" | "HT" | "2H" | "2H_STOPPAGE" | "FT";
}

export function computeClockState(startsAtMs: number, now: number, stepMs: number): ClockState {
  const elapsedMs = Math.max(0, now - startsAtMs);
  const step = Math.floor(elapsedMs / stepMs) + 1;

  if (step <= 45) return { minuteLabel: `${step}’`, gameMinute: step, phase: "1H" };
  if (step === 46) return { minuteLabel: "45+2’", gameMinute: 45, phase: "1H_STOPPAGE" };
  if (step === 47 || step === 48) return { minuteLabel: "MT", gameMinute: 45, phase: "HT" };
  if (step <= 93) {
    const gm = step - 3;
    return { minuteLabel: `${gm}’`, gameMinute: gm, phase: "2H" };
  }
  if (step === 94) return { minuteLabel: "90+2’", gameMinute: 90, phase: "2H_STOPPAGE" };
  if (step === TOTAL_CLOCK_STEPS) return { minuteLabel: "90+3’", gameMinute: 90, phase: "2H_STOPPAGE" };
  return { minuteLabel: "Terminé", gameMinute: 90, phase: "FT" };
}

/**
 * Replace proprement un match `live` excédentaire dans la file d'attente `upcoming`
 * afin de garantir qu'un seul match soit en direct à la fois.
 */
async function demoteLiveMatchToUpcoming(m: MatchRow, targetStartsAt: Date): Promise<MatchRow> {
  const hasCustom = m.source === "manual" && m.markets && m.markets.length > 0;
  const preOdds = hasCustom
    ? { oddsHome: m.oddsHome, oddsDraw: m.oddsDraw, oddsAway: m.oddsAway }
    : oddsFor(m.homeTeam, m.awayTeam, {
        homeForm: m.homeForm ?? 1,
        awayForm: m.awayForm ?? 1,
      });

  const homeLogo = teamLogo(m.homeTeam) || m.homeLogo;
  const awayLogo = teamLogo(m.awayTeam) || m.awayLogo;

  const [updated] = await db
    .update(matches)
    .set({
      status: "upcoming",
      homeScore: null,
      awayScore: null,
      minute: null,
      redHome: 0,
      redAway: 0,
      events: [],
      tickHistory: [],
      suspended: false,
      lastGoalAt: null,
      startsAt: targetStartsAt,
      oddsHome: preOdds.oddsHome,
      oddsDraw: preOdds.oddsDraw,
      oddsAway: preOdds.oddsAway,
      homeLogo,
      awayLogo,
    })
    .where(eq(matches.id, m.id))
    .returning();

  return updated ?? {
    ...m,
    status: "upcoming",
    homeScore: null,
    awayScore: null,
    minute: null,
    redHome: 0,
    redAway: 0,
    events: [],
    tickHistory: [],
    suspended: false,
    lastGoalAt: null,
    startsAt: targetStartsAt,
    oddsHome: preOdds.oddsHome,
    oddsDraw: preOdds.oddsDraw,
    oddsAway: preOdds.oddsAway,
    homeLogo,
    awayLogo,
  };
}

/**
 * Utilisé par l'API Admin lorsqu'un match VIRTUEL est lancé ou rouvert en direct :
 * garantit un plafond propre de `CONCURRENT_LIVE_VIRTUAL` matchs virtuels simultanés.
 * Les matchs RÉELS (`source = "manual"`) sont 100 % indépendants.
 */
export async function demoteOtherLiveMatches(keepMatchId: number, now = Date.now()): Promise<void> {
  const [keepMatch] = await db.select().from(matches).where(eq(matches.id, keepMatchId));
  if (!keepMatch || keepMatch.source === "manual") return;

  const others = await db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.status, "live"),
        eq(matches.source, "virtual"),
        ne(matches.id, keepMatchId)
      )
    );

  const maxOthers = Math.max(0, CONCURRENT_LIVE_VIRTUAL - 1);
  if (others.length <= maxOthers) return;

  others.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id - b.id);
  const toDemote = others.slice(maxOthers);
  let cursorMs = expectedMatchEndMs(keepMatch, now) + INTER_MATCH_GAP_MS;

  for (const extra of toDemote) {
    const demoted = await demoteLiveMatchToUpcoming(extra, new Date(cursorMs));
    upsertCachedMatches([demoted]);
    cursorMs += matchDurationMs(extra.id, "virtual") + INTER_MATCH_GAP_MS;
  }
}

let lastMilestoneDetected = false;
export function consumeRecentEngineMilestone(): boolean {
  const v = lastMilestoneDetected;
  lastMilestoneDetected = false;
  return v;
}

export async function runLiveEngine(): Promise<void> {
  await ensureSeeded();

  const now = Date.now();
  if (now - lastTick < TICK_THROTTLE_MS) {
    if (inFlight) await inFlight;
    return;
  }
  if (inFlight) {
    await inFlight;
    return;
  }

  lastTick = now;
  inFlight = executeTick(now).finally(() => {
    inFlight = null;
  });
  await inFlight;
}

export interface PendingMatchTicket {
  market: string;
  selection: string;
  stake: number;
  odds: number;
  riskWeight: number;
}

interface MatchBookPressure {
  tickets: PendingMatchTicket[];
  houseTightness: number;
}

/** Les mises et l'exposition ne modifient pas les probabilités de buts.
 * Les scénarios administrateur et le RNG nécessitent une revue distincte.
 */
export function computeDynamicStepTilts(
  _pressure: MatchBookPressure,
  _home: number,
  _away: number,
  _minute: number,
  _baseLambdaH: number,
  _baseLambdaA: number,
  _eventsSoFar?: Array<{ type: string; team: string; minute: number }>
): { hTilt: number; aTilt: number } {
  // Découplage strict pour l'équité sportive et l'indépendance RNG :
  // La neutralité de cette fonction ne constitue pas une certification RNG.
  return { hTilt: 1, aTilt: 1 };
}

export function regimeFactors(
  regime: string | null | undefined,
  minute: number,
  lambdaHome: number,
  lambdaAway: number
): { hMult: number; aMult: number } {
  const homeIsFav = lambdaHome >= lambdaAway;
  switch (regime) {
    case "tactical_lock":
      return { hMult: 0.85, aMult: 0.85 };
    case "high_tempo":
      return { hMult: 1.15, aMult: 1.15 };
    case "underdog_ambush":
      return homeIsFav ? { hMult: 0.89, aMult: 1.11 } : { hMult: 1.11, aMult: 0.89 };
    case "favorite_surge":
      return homeIsFav ? { hMult: 1.12, aMult: 0.88 } : { hMult: 0.88, aMult: 1.12 };
    case "late_drama":
      return minute >= 61 ? { hMult: 1.21, aMult: 1.21 } : { hMult: 0.87, aMult: 0.87 };
    default:
      return { hMult: 1, aMult: 1 };
  }
}

let cachedLiveSim: { enabled: boolean; ts: number } | null = null;
const LIVE_SIM_CACHE_TTL_MS = 5 * 60_000;

export function invalidateLiveSimCache() {
  cachedLiveSim = null;
}

async function isLiveSimEnabled(): Promise<boolean> {
  const now = Date.now();
  if (cachedLiveSim && now - cachedLiveSim.ts < LIVE_SIM_CACHE_TTL_MS) {
    return cachedLiveSim.enabled;
  }
  const [user] = await db
    .select({ liveSim: appUser.liveSim })
    .from(appUser)
    .where(eq(appUser.id, 1))
    .limit(1);
  const enabled = user ? Boolean(user.liveSim) : true;
  cachedLiveSim = { enabled, ts: now };
  return enabled;
}

function isDbMilestoneTransition(
  prev: MatchRow,
  next: MatchRow,
  hasPendingTicketsOnMatch: boolean
): boolean {
  if (prev.status !== next.status) return true; // Coup d'envoi ou fin du match
  if ((prev.homeScore ?? 0) !== (next.homeScore ?? 0)) return true; // But domicile
  if ((prev.awayScore ?? 0) !== (next.awayScore ?? 0)) return true; // But extérieur
  if ((prev.redHome ?? 0) !== (next.redHome ?? 0)) return true; // Carton rouge
  if ((prev.redAway ?? 0) !== (next.redAway ?? 0)) return true; // Carton rouge
  if ((prev.events?.length ?? 0) !== (next.events?.length ?? 0)) return true;
  if (hasPendingTicketsOnMatch) {
    // Règlement anticipé mi-temps : persiste le franchissement de la pause si des paris sont ouverts
    const prevHt = prev.minute === "MT" || minuteNumber(prev.minute) >= 46;
    const nextHt = next.minute === "MT" || minuteNumber(next.minute) >= 46;
    if (!prevHt && nextHt) return true;
  }
  return false;
}

async function executeTick(now: number): Promise<void> {
  if (!(await isLiveSimEnabled())) return;

  await ensureMlLoaded();
  await ensureMatchStoreHydrated();

  // `ensureActiveSchedule` lit directement le store mémoire (0 `SELECT` SQL à chaque tick)
  const openMatches = await ensureActiveSchedule(now);
  if (openMatches.length === 0) return;

  const openIds = openMatches.map((m) => m.id);
  const { sportTickets, comboTickets } = await getCachedPendingBookForMatches(openIds);
  const hasAnyExposure = sportTickets.length > 0 || comboTickets.length > 0;

  const betsByMatch = new Map<number, PendingMatchTicket[]>();
  for (const b of sportTickets) {
    const arr = betsByMatch.get(b.matchId) ?? [];
    arr.push({
      market: b.market,
      selection: b.selection,
      stake: b.stake,
      odds: b.odds,
      riskWeight: 1,
    });
    betsByMatch.set(b.matchId, arr);
  }
  for (const cb of comboTickets) {
    const arr = betsByMatch.get(cb.matchId) ?? [];
    arr.push({
      market: cb.market,
      selection: cb.selection,
      stake: cb.stake,
      odds: cb.odds,
      riskWeight: 1,
    });
    betsByMatch.set(cb.matchId, arr);
  }

  const pressureFor = (_m: MatchRow): MatchBookPressure => ({
    tickets: [],
    houseTightness: 1,
  });

  const liveMatches = openMatches.filter((m) => m.status === "live");
  const upcomingMatches = openMatches.filter((m) => m.status === "upcoming");
  let lastCompletedEndMs = 0;

  // Séparation stricte :
  // - `ramDirtyRows` : mis à jour immédiatement en RAM (horloge minute par minute, cotes contextuelles) -> 0 SQL
  // - `dbMilestoneRows` : persisté dans Neon UNIQUEMENT sur jalon réel (coup d'envoi, but, rouge, mi-temps avec pari, fin)
  const ramDirtyRows = new Map<number, MatchRow>();
  const dbMilestoneRows = new Map<number, MatchRow>();
  const finishedRows: MatchRow[] = [];

  const recordStepResult = (
    prevRow: MatchRow,
    res: { changed: boolean; finished: boolean; row: MatchRow }
  ) => {
    if (res.changed) {
      ramDirtyRows.set(res.row.id, res.row);
      const hasBetsOnMatch = (betsByMatch.get(res.row.id)?.length ?? 0) > 0;
      if (isDbMilestoneTransition(prevRow, res.row, hasBetsOnMatch)) {
        dbMilestoneRows.set(res.row.id, res.row);
      }
    }
    if (res.finished) {
      dbMilestoneRows.set(res.row.id, res.row);
      finishedRows.push(res.row);
      const dur = matchDurationMs(res.row.id, res.row.source);
      lastCompletedEndMs = Math.max(lastCompletedEndMs, res.row.startsAt.getTime() + dur);
    }
  };

  // 1. Clôture d'abord en mémoire tout match live dont le temps réglementaire est écoulé
  const stillLive: MatchRow[] = [];
  for (const m of liveMatches) {
    const clock = computeClockState(m.startsAt.getTime(), now, stepMsForMatch(m.id, m.source));
    if (clock.phase === "FT") {
      recordStepResult(m, stepLiveMatchInMemory(m, now, pressureFor(m), false));
    } else {
      stillLive.push(m);
    }
  }

  // 2. Plafonne proprement à `CONCURRENT_LIVE_VIRTUAL` matchs virtuels en direct simultanément
  stillLive.sort((a, b) => {
    const betsDiff = (betsByMatch.get(b.id)?.length ?? 0) - (betsByMatch.get(a.id)?.length ?? 0);
    if (betsDiff !== 0) return betsDiff;
    return a.startsAt.getTime() - b.startsAt.getTime() || a.id - b.id;
  });

  const keptLive = stillLive.slice(0, CONCURRENT_LIVE_VIRTUAL);
  if (stillLive.length > CONCURRENT_LIVE_VIRTUAL) {
    let deferCursor =
      Math.max(...keptLive.map((lm) => expectedMatchEndMs(lm, now))) + INTER_MATCH_GAP_MS;
    for (const extra of stillLive.slice(CONCURRENT_LIVE_VIRTUAL)) {
      const demoted = await demoteLiveMatchToUpcoming(extra, new Date(deferCursor));
      ramDirtyRows.set(demoted.id, demoted);
      upcomingMatches.push(demoted);
      deferCursor += matchDurationMs(extra.id, extra.source) + INTER_MATCH_GAP_MS;
    }
  }

  // 3. Fait progresser en mémoire tous les matchs virtuels actuellement en direct
  let activeLives: MatchRow[] = [];
  for (const lm of keptLive) {
    const res = stepLiveMatchInMemory(lm, now, pressureFor(lm), false);
    recordStepResult(lm, res);
    if (!res.finished) {
      activeLives.push(res.row);
    }
  }

  // Remplit immédiatement chaque canal libre avec la prochaine affiche proche.
  // Le match peut être avancé de quelques minutes pour maintenir les 4 directs,
  // mais son départ est toujours horodaté à `now` (jamais antidaté).
  if (activeLives.length < CONCURRENT_LIVE_VIRTUAL) {
    const ordered = upcomingMatches.filter(m => m.source === "virtual")
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id - b.id);
    for (const vm of ordered) {
      if (vm.startsAt.getTime() > now + VIRTUAL_LIVE_PRIME_HORIZON_MS) break;
      const claimed = await claimVirtualKickoff(vm, now, {
        allowEarly: true,
        ignoreRecentGap: true,
      });
      if (!claimed) continue;
      const index = upcomingMatches.findIndex(u => u.id === vm.id);
      if (index >= 0) upcomingMatches.splice(index, 1);
      const stepped = kickOffInMemory(claimed, now, now, pressureFor(claimed));
      recordStepResult(claimed, stepped);
      if (!stepped.finished) activeLives.push(stepped.row);
      break;
    }
  }

  // Met à jour immédiatement la RAM pour tous les matchs ayant avancé d'une minute
  if (ramDirtyRows.size > 0) {
    upsertCachedMatches([...ramDirtyRows.values()]);
  }

  // Écriture SQL unique groupée UNIQUEMENT pour les jalons réels (coup d'envoi, but/carton, fin)
  if (dbMilestoneRows.size > 0 || finishedRows.length > 0) {
    lastMilestoneDetected = true;
    await flushMatchUpdatesBatch([...dbMilestoneRows.values()], finishedRows, now);
  }

  // 5. Regarnit la file et planifie les coups d'envoi à 3 minutes d'intervalle
  const minQueuedNeeded = Math.max(4, MIN_ACTIVE_VIRTUAL - activeLives.length - 2);
  if (upcomingMatches.filter((m) => m.source === "virtual").length < minQueuedNeeded) {
    const refreshedActive = await ensureActiveSchedule(now);
    const refreshedUpcoming = refreshedActive.filter((m) => m.status === "upcoming");
    await syncUpcomingQueue(refreshedUpcoming, activeLives, now, betsByMatch);
  } else {
    await syncUpcomingQueue(upcomingMatches, activeLives, now, betsByMatch);
  }

  if ((finishedRows.length > 0 || lastCompletedEndMs > 0) && hasAnyExposure) {
    await settlePendingCombos();
  }
}

async function syncUpcomingQueue(
  upcomingMatches: MatchRow[],
  activeLives: MatchRow[],
  now: number,
  betsByMatch: Map<number, PendingMatchTicket[]>
): Promise<void> {
  const virtualQueue = upcomingMatches
    .filter((m) => m.source === "virtual")
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id - b.id);

  // Rééquilibrage automatique sans couture : parité 50/50 Domicile / Extérieur sur les matchs sans pari
  let homeStrongCount = 0;
  let awayStrongCount = 0;
  for (const m of virtualQueue) {
    const diff = teamStrength(m.homeTeam) - teamStrength(m.awayTeam);
    if (diff >= 1) homeStrongCount++;
    else if (diff <= -1) awayStrongCount++;
  }

  const [latestKickoff] = await db.select({ startsAt: matches.startsAt }).from(matches)
    .where(sql`${matches.source} = 'virtual' AND ${matches.status} IN ('live', 'finished')`)
    .orderBy(sql`${matches.startsAt} DESC`).limit(1);
  const cursor = Math.max(now, latestKickoff ? latestKickoff.startsAt.getTime() + VIRTUAL_KICKOFF_GAP_MS : now);

  interface QueuedMatchPatch {
    id: number;
    homeTeam: string;
    awayTeam: string;
    homeForm: number;
    awayForm: number;
    startsAtIso: string;
    oddsHome: number;
    oddsDraw: number;
    oddsAway: number;
    homeLogo: string | null;
    awayLogo: string | null;
  }

  const queueTeams = [...new Set(virtualQueue.flatMap(m => [...virtualTeamAliases(m.homeTeam), ...virtualTeamAliases(m.awayTeam)]).map(t => t.toLowerCase().trim()))];
  const recentFinished = queueTeams.length ? await db.select({ homeTeam: matches.homeTeam, awayTeam: matches.awayTeam, startsAt: matches.startsAt, finishedAt: matches.finishedAt }).from(matches).where(sql`${matches.source} = 'virtual' AND ${matches.status} = 'finished' AND COALESCE(${matches.finishedAt}, ${matches.startsAt} + interval '608 seconds') >= ${new Date(now - VIRTUAL_REMATCH_GAP_MS - 60 * 60_000)} AND lower(trim(${matches.homeTeam})) IN (${sql.join(queueTeams.map(t => sql`${t}`), sql`, `)}) AND lower(trim(${matches.awayTeam})) IN (${sql.join(queueTeams.map(t => sql`${t}`), sql`, `)})`) : [];
  const windows: VirtualFixtureWindow[] = [
    ...activeLives.map(m => ({ home: m.homeTeam, away: m.awayTeam, start: m.startsAt.getTime(), end: expectedMatchEndMs(m, now) })),
    ...recentFinished.map(m => ({ home: m.homeTeam, away: m.awayTeam, start: m.startsAt.getTime(), end: m.finishedAt?.getTime() ?? m.startsAt.getTime() + 608_000 })),
  ];
  const patches: QueuedMatchPatch[] = [];
  const ramUpdatedQueue: MatchRow[] = [];

  const planned = planVirtualQueue(virtualQueue, cursor,
    m => ({ home: m.homeTeam, away: m.awayTeam }),
    m => matchDurationMs(m.id, "virtual"), windows);
  for (const { item: m, start: desiredStartsAt } of planned) {
    let homeTeam = m.homeTeam;
    let awayTeam = m.awayTeam;
    let homeForm = m.homeForm ?? 1;
    let awayForm = m.awayForm ?? 1;

    const hasPendingBets = (betsByMatch.get(m.id)?.length ?? 0) > 0;
    const isScenarioPinned =
      Boolean(m.scenarioLocked) ||
      (m.scenarioNonce ?? 0) > 0 ||
      Array.isArray(m.scriptedEvents);
    const strengthDiff = teamStrength(homeTeam) - teamStrength(awayTeam);

    if (
      !hasPendingBets &&
      !isScenarioPinned &&
      homeStrongCount - awayStrongCount >= 2 &&
      strengthDiff >= 1
    ) {
      homeTeam = m.awayTeam;
      awayTeam = m.homeTeam;
      homeForm = m.awayForm ?? 1;
      awayForm = m.homeForm ?? 1;
      homeStrongCount--;
      awayStrongCount++;
    } else if (
      !hasPendingBets &&
      !isScenarioPinned &&
      awayStrongCount - homeStrongCount >= 3 &&
      strengthDiff <= -1
    ) {
      homeTeam = m.awayTeam;
      awayTeam = m.homeTeam;
      homeForm = m.awayForm ?? 1;
      awayForm = m.homeForm ?? 1;
      awayStrongCount--;
      homeStrongCount++;
    }

    const freshOdds = oddsFor(homeTeam, awayTeam, {
      homeForm,
      awayForm,
      redHome: m.redHome ?? 0,
      redAway: m.redAway ?? 0,
      league: m.league,
    });
    const homeLogo = teamLogo(homeTeam) || m.homeLogo;
    const awayLogo = teamLogo(awayTeam) || m.awayLogo;

    const swapped = homeTeam !== m.homeTeam;
    const driftMs = Math.abs(m.startsAt.getTime() - desiredStartsAt);
    const oddsChanged =
      Math.abs(m.oddsHome - freshOdds.oddsHome) > 0.02 ||
      Math.abs((m.oddsDraw ?? 0) - freshOdds.oddsDraw) > 0.02 ||
      Math.abs(m.oddsAway - freshOdds.oddsAway) > 0.02;

    if (swapped || driftMs > 6_000 || oddsChanged || homeLogo !== m.homeLogo || awayLogo !== m.awayLogo) {
      const nextStartsAt = new Date(desiredStartsAt);
      ramUpdatedQueue.push({
        ...m,
        homeTeam,
        awayTeam,
        homeForm,
        awayForm,
        startsAt: nextStartsAt,
        oddsHome: freshOdds.oddsHome,
        oddsDraw: freshOdds.oddsDraw,
        oddsAway: freshOdds.oddsAway,
        homeLogo: homeLogo ?? null,
        awayLogo: awayLogo ?? null,
      });

      // Persiste en base uniquement en cas d'inversion d'affiche ou de dérive horaire > 1 s
      if (swapped || driftMs > 1_000) {
        patches.push({
          id: m.id,
          homeTeam,
          awayTeam,
          homeForm,
          awayForm,
          startsAtIso: nextStartsAt.toISOString(),
          oddsHome: freshOdds.oddsHome,
          oddsDraw: freshOdds.oddsDraw,
          oddsAway: freshOdds.oddsAway,
          homeLogo: homeLogo ?? null,
          awayLogo: awayLogo ?? null,
        });
      }
    }
  }

  if (ramUpdatedQueue.length > 0) {
    upsertCachedMatches(ramUpdatedQueue);
  }

  // Mise à jour SQL groupée uniquement pour les changements structurels réels
  if (patches.length > 0) {
    const tuples = sql.join(
      patches.map(
        (p) =>
          sql`(${p.id}::int, ${p.homeTeam}::text, ${p.awayTeam}::text, ${p.homeForm}::float8, ${p.awayForm}::float8, ${p.startsAtIso}::timestamptz::timestamp, ${p.oddsHome}::float8, ${p.oddsDraw}::float8, ${p.oddsAway}::float8, ${p.homeLogo}::text, ${p.awayLogo}::text)`
      ),
      sql`, `
    );
    await db.execute(sql`
      UPDATE "matches" AS m
      SET
        "home_team" = v.home_team,
        "away_team" = v.away_team,
        "home_form" = v.home_form,
        "away_form" = v.away_form,
        "starts_at" = v.starts_at,
        "odds_home" = v.odds_home,
        "odds_draw" = v.odds_draw,
        "odds_away" = v.odds_away,
        "home_logo" = v.home_logo,
        "away_logo" = v.away_logo
      FROM (VALUES ${tuples}) AS v(
        id, home_team, away_team, home_form, away_form, starts_at, odds_home, odds_draw, odds_away, home_logo, away_logo
      )
      WHERE m."id" = v.id AND m."status" = 'upcoming'
    `);
  }
}

async function ensureActiveSchedule(now: number): Promise<MatchRow[]> {
  await ensureMatchStoreHydrated();
  const activeVirtual = getCachedActiveVirtualMatches();

  // Les affiches lointaines (par exemple des doublons déjà réservés) ne doivent pas
  // empêcher la création d'une file utilisable à court terme.
  const nearHorizon = now + TARGET_ACTIVE_VIRTUAL * VIRTUAL_KICKOFF_GAP_MS;
  const nearCount = activeVirtual.filter(m => m.status === "live" || m.startsAt.getTime() <= nearHorizon).length;
  if (nearCount >= MIN_ACTIVE_VIRTUAL - 2) return activeVirtual;

  const busyTeams = new Set<string>();
  let tailStartMs: number | null = null;
  let netHomeStronger = 0;

  for (const m of activeVirtual) {
    busyTeams.add(virtualTeamIdentity(m.homeTeam));
    busyTeams.add(virtualTeamIdentity(m.awayTeam));
    const diff = teamStrength(m.homeTeam) - teamStrength(m.awayTeam);
    if (diff >= 1) netHomeStronger++;
    else if (diff <= -1) netHomeStronger--;
    if (m.status === "live" || m.startsAt.getTime() <= nearHorizon) {
      tailStartMs = Math.max(tailStartMs ?? m.startsAt.getTime(), m.startsAt.getTime());
    }
  }

  const recentFixtures = await db.select({ homeTeam: matches.homeTeam, awayTeam: matches.awayTeam }).from(matches).where(sql`${matches.source} = 'virtual' AND ${matches.status} = 'finished' AND COALESCE(${matches.finishedAt}, ${matches.startsAt} + interval '608 seconds') >= ${new Date(now - VIRTUAL_REMATCH_GAP_MS - 60 * 60_000)}`);
  const excludedPairs = new Set(recentFixtures.map(m => virtualPairKey(m.homeTeam, m.awayTeam)));
  const waveSlot = Math.floor(now / 600_000);
  const waveOffset = hmacUint32(`wave-offset|${waveSlot}`) % FIXTURE_POOL.length;
  const stepStride = coprimeStride(FIXTURE_POOL.length, hmacUint32(`wave-step|${waveSlot}`));
  const needed = Math.max(0, TARGET_ACTIVE_VIRTUAL - nearCount);
  const chosen: FixtureTemplate[] = [];

  for (let i = 0; i < FIXTURE_POOL.length && chosen.length < needed; i++) {
    const raw = FIXTURE_POOL[(waveOffset + i * stepStride) % FIXTURE_POOL.length];
    if (busyTeams.has(virtualTeamIdentity(raw.home)) || busyTeams.has(virtualTeamIdentity(raw.away)) || excludedPairs.has(virtualPairKey(raw.home, raw.away))) continue;
    busyTeams.add(virtualTeamIdentity(raw.home));
    busyTeams.add(virtualTeamIdentity(raw.away));
    const oriented = orientFixtureBalanced(raw, `${waveSlot}|${i}`, netHomeStronger);
    const diff = teamStrength(oriented.home) - teamStrength(oriented.away);
    if (diff >= 1) netHomeStronger++;
    else if (diff <= -1) netHomeStronger--;
    chosen.push(oriented);
  }

  let nextStart = Math.max(now, tailStartMs === null ? now : tailStartMs + VIRTUAL_KICKOFF_GAP_MS);
  const rows: Array<typeof matches.$inferInsert> = [];

  chosen.forEach((fx, idx) => {
    const rng = createServerRng(`sched-v4|${waveSlot}|${fx.home}|${fx.away}|${idx}`);
    const regime = MATCH_REGIMES[Math.floor(rng() * MATCH_REGIMES.length)];
    // Forme du jour symétrique centrée sur 1.00 (aucun biais directionnel)
    const homeForm = Math.round((0.91 + rng() * 0.18) * 100) / 100;
    const awayForm = Math.round((0.91 + rng() * 0.18) * 100) / 100;

    const startsAt = new Date(nextStart);
    nextStart += VIRTUAL_KICKOFF_GAP_MS;

    const preOdds = oddsFor(fx.home, fx.away, { homeForm, awayForm, league: fx.league });
    rows.push({
      sport: "football",
      league: fx.league,
      homeTeam: fx.home,
      awayTeam: fx.away,
      homeLogo: teamLogo(fx.home),
      awayLogo: teamLogo(fx.away),
      homeScore: null,
      awayScore: null,
      status: "upcoming",
      minute: null,
      startsAt,
      oddsHome: preOdds.oddsHome,
      oddsDraw: preOdds.oddsDraw,
      oddsAway: preOdds.oddsAway,
      suspended: false,
      redHome: 0,
      redAway: 0,
      events: [],
      tickHistory: [],
      regime,
      homeForm,
      awayForm,
      markets: null,
      source: "virtual",
    });
  });

  if (rows.length > 0) {
    const insertedRows = await db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${VIRTUAL_SCHEDULE_LOCK})`);
      const existing = await tx.select({ status: matches.status, homeTeam: matches.homeTeam, awayTeam: matches.awayTeam }).from(matches).where(sql`${matches.source} = 'virtual' AND (${matches.status} IN ('live','upcoming') OR (${matches.status} = 'finished' AND COALESCE(${matches.finishedAt}, ${matches.startsAt} + interval '608 seconds') >= ${new Date(now - VIRTUAL_REMATCH_GAP_MS - 60 * 60_000)}))`);
      const accepted: typeof rows = [];
      const occupied = existing.filter(m => m.status !== "finished").map(m => ({ home: m.homeTeam, away: m.awayTeam }));
      const recentPairs = new Set(existing.filter(m => m.status === "finished").map(m => virtualPairKey(m.homeTeam, m.awayTeam)));
      for (const row of rows) {
        const fixture = { home: row.homeTeam, away: row.awayTeam };
        if (occupied.some(other => sharesVirtualTeam(fixture, other)) || recentPairs.has(virtualPairKey(fixture.home, fixture.away))) continue;
        accepted.push(row); occupied.push(fixture);
      }
      return accepted.length ? tx.insert(matches).values(accepted).returning() : [];
    });
    const mode = await getScenarioMode();
    if (mode === "locked" && insertedRows.length > 0) {
      const neutral: MatchBookPressure = { tickets: [], houseTightness: 1 };
      const lockTuples = insertedRows.map((ins) => {
        const sim = simulateMatchRange(ins, 0, 90, 0, 0, 0, 0, [], neutral, false);
        ins.scenarioLocked = true;
        ins.scriptedEvents = sim.events;
        return sql`(${ins.id}::int, ${JSON.stringify(sim.events)}::jsonb)`;
      });
      await db.execute(sql`
        UPDATE "matches" AS m
        SET "scenario_locked" = true, "scripted_events" = v.scripted_events
        FROM (VALUES ${sql.join(lockTuples, sql`, `)}) AS v(id, scripted_events)
        WHERE m."id" = v.id
      `);
    }
    upsertCachedMatches(insertedRows);
    return [...activeVirtual, ...insertedRows];
  }
  return activeVirtual;
}

function kickOffInMemory(
  m: MatchRow,
  scheduledStartsAtMs: number,
  now: number,
  pressure: MatchBookPressure
): { changed: boolean; finished: boolean; row: MatchRow } {
  const kickoffDate = new Date(scheduledStartsAtMs);
  const liveDraft: MatchRow = {
    ...m,
    status: "live",
    homeScore: m.homeScore ?? 0,
    awayScore: m.awayScore ?? 0,
    minute: "1'",
    startsAt: kickoffDate,
    homeLogo: teamLogo(m.homeTeam) || m.homeLogo,
    awayLogo: teamLogo(m.awayTeam) || m.awayLogo,
  };

  return stepLiveMatchInMemory(liveDraft, now, pressure, true);
}

/**
 * Calcule en pure mémoire (0 requête SQL) le prochain état d'un match en direct,
 * avec hystérésis anti-clignotement des cotes et compactage de `tickHistory`.
 */
function stepLiveMatchInMemory(
  m: MatchRow,
  now: number,
  pressure: MatchBookPressure,
  forceWrite = false
): { changed: boolean; finished: boolean; row: MatchRow } {
  const stepMs = stepMsForMatch(m.id, m.source);
  let effectiveStartsAt = m.startsAt;
  let clock = computeClockState(effectiveStartsAt.getTime(), now, stepMs);

  let home = m.homeScore ?? 0;
  let away = m.awayScore ?? 0;
  let redHome = m.redHome ?? 0;
  let redAway = m.redAway ?? 0;
  const prevHome = home;
  const prevAway = away;
  const prevRedHome = redHome;
  const prevRedAway = redAway;

  const events = Array.isArray(m.events) ? m.events.map((e) => ({ ...e })) : [];
  const rawHistory = Array.isArray(m.tickHistory) ? m.tickHistory : [];

  let prevSimMin = 0;
  const tickHistory: typeof rawHistory = [];
  for (const t of rawHistory) {
    if (t.market === "sim" && t.selection === "clock") {
      prevSimMin = Math.max(prevSimMin, Math.round(t.to));
    } else {
      tickHistory.push(t);
    }
  }
  if (prevSimMin === 0 && (home > 0 || away > 0 || events.length > 0)) {
    prevSimMin = minuteNumber(m.minute);
  }

  // Transition fluide sans retour d'horloge lorsqu'un match virtuel déjà en cours
  // passe à la cadence de 10 minutes : on réancre `startsAt` sur `prevSimMin`.
  if (m.source === "virtual" && prevSimMin > clock.gameMinute + 1) {
    effectiveStartsAt = backdateStartsAtForMinute(prevSimMin, now, "virtual", m.id);
    clock = computeClockState(effectiveStartsAt.getTime(), now, stepMs);
  }

  const isOver = clock.phase === "FT";
  const targetSimMin = clock.gameMinute;
  let justScoredNow = false;

  const hasScripted = Boolean(m.scenarioLocked && Array.isArray(m.scriptedEvents));
  const simulateEvents = m.source === "virtual" || hasScripted;

  if (simulateEvents && targetSimMin > prevSimMin) {
    const simOut = simulateMatchRange(
      m,
      prevSimMin,
      targetSimMin,
      home,
      away,
      redHome,
      redAway,
      events,
      pressure,
      hasScripted
    );
    home = simOut.home;
    away = simOut.away;
    redHome = simOut.redHome;
    redAway = simOut.redAway;
    events.length = 0;
    events.push(...simOut.events);
    justScoredNow = simOut.justScoredNow;
  }

  const computedOdds = liveOddsFor(m.homeTeam, m.awayTeam, home, away, targetSimMin, {
    homeForm: m.homeForm ?? 1,
    awayForm: m.awayForm ?? 1,
    redHome,
    redAway,
    events,
    regime: m.regime,
    league: m.league,
  });

  // Hystérésis anti-oscillation : sans but, carton rouge ni fin de match, on ignore les micro-écarts < 3 % / 0,06
  const incidentHappened =
    forceWrite ||
    isOver ||
    justScoredNow ||
    home !== prevHome ||
    away !== prevAway ||
    redHome !== prevRedHome ||
    redAway !== prevRedAway ||
    clock.minuteLabel === "MT";

  const prevDraw = m.oddsDraw ?? computedOdds.oddsDraw;
  const maxAbsShift = Math.max(
    Math.abs(computedOdds.oddsHome - m.oddsHome),
    Math.abs(computedOdds.oddsDraw - prevDraw),
    Math.abs(computedOdds.oddsAway - m.oddsAway)
  );
  const maxRelShift = Math.max(
    Math.abs(computedOdds.oddsHome - m.oddsHome) / Math.max(1.01, m.oddsHome),
    Math.abs(computedOdds.oddsDraw - prevDraw) / Math.max(1.01, prevDraw),
    Math.abs(computedOdds.oddsAway - m.oddsAway) / Math.max(1.01, m.oddsAway)
  );

  const shouldUpdateOdds =
    incidentHappened ||
    targetSimMin >= 77 ||
    (maxAbsShift >= 0.06 && maxRelShift >= 0.028);

  const dynamicOdds = shouldUpdateOdds
    ? computedOdds
    : {
        oddsHome: m.oddsHome,
        oddsDraw: prevDraw,
        oddsAway: m.oddsAway,
      };

  if (Math.abs(dynamicOdds.oddsHome - m.oddsHome) >= 0.06) {
    tickHistory.push({
      minute: targetSimMin,
      market: "result",
      selection: "home",
      from: m.oddsHome,
      to: dynamicOdds.oddsHome,
    });
  }
  if (m.oddsDraw != null && Math.abs(dynamicOdds.oddsDraw - m.oddsDraw) >= 0.06) {
    tickHistory.push({
      minute: targetSimMin,
      market: "result",
      selection: "draw",
      from: m.oddsDraw,
      to: dynamicOdds.oddsDraw,
    });
  }
  if (Math.abs(dynamicOdds.oddsAway - m.oddsAway) >= 0.06) {
    tickHistory.push({
      minute: targetSimMin,
      market: "result",
      selection: "away",
      from: m.oddsAway,
      to: dynamicOdds.oddsAway,
    });
  }

  const cappedOddsHistory = isOver ? tickHistory.slice(-6) : tickHistory.slice(-14);
  const finalHistory = [
    ...cappedOddsHistory,
    {
      minute: Math.max(prevSimMin, targetSimMin),
      market: "sim",
      selection: "clock",
      from: prevSimMin,
      to: Math.max(prevSimMin, targetSimMin),
    },
  ];

  const lastGoalDate = justScoredNow ? new Date(now) : m.lastGoalAt;
  const recentGoal = lastGoalDate != null && now - lastGoalDate.getTime() < GOAL_SUSPEND_MS;
  const isLateLock = clock.gameMinute >= 85 || clock.phase === "2H_STOPPAGE";
  const suspended = isOver
    ? false
    : m.source === "manual"
      ? Boolean(m.suspended) || recentGoal
      : recentGoal || isLateLock;

  let customMarkets = m.markets;
  if (customMarkets && customMarkets.length > 0) {
    customMarkets = customMarkets.map((g) => {
      if (g.key !== "result" || g.rows) return g;
      return {
        ...g,
        outcomes: g.outcomes.map((o) => {
          if (o.key === "home") return { ...o, odds: dynamicOdds.oddsHome };
          if (o.key === "draw") return { ...o, odds: dynamicOdds.oddsDraw };
          if (o.key === "away") return { ...o, odds: dynamicOdds.oddsAway };
          return o;
        }),
      };
    });
  }

  const homeLogo = teamLogo(m.homeTeam) || m.homeLogo;
  const awayLogo = teamLogo(m.awayTeam) || m.awayLogo;
  const nextMinute = isOver ? "Terminé" : clock.minuteLabel;
  const nextStatus = isOver ? "finished" : "live";

  const startsAtChanged = effectiveStartsAt.getTime() !== m.startsAt.getTime();
  const changed =
    forceWrite ||
    isOver ||
    startsAtChanged ||
    m.status !== nextStatus ||
    m.minute !== nextMinute ||
    m.homeScore !== home ||
    m.awayScore !== away ||
    m.redHome !== redHome ||
    m.redAway !== redAway ||
    m.suspended !== suspended ||
    m.homeLogo !== homeLogo ||
    m.awayLogo !== awayLogo ||
    Math.abs(m.oddsHome - dynamicOdds.oddsHome) > 0.01 ||
    Math.abs((m.oddsDraw ?? 0) - dynamicOdds.oddsDraw) > 0.01 ||
    Math.abs(m.oddsAway - dynamicOdds.oddsAway) > 0.01 ||
    events.length !== (m.events ?? []).length ||
    targetSimMin !== prevSimMin;

  if (!changed) return { changed: false, finished: isOver, row: m };

  const naturalEndMs = effectiveStartsAt.getTime() + matchDurationMs(m.id, m.source);
  const nextRow: MatchRow = {
    ...m,
    startsAt: effectiveStartsAt,
    homeScore: home,
    awayScore: away,
    redHome,
    redAway,
    events,
    minute: nextMinute,
    status: nextStatus,
    oddsHome: dynamicOdds.oddsHome,
    oddsDraw: dynamicOdds.oddsDraw,
    oddsAway: dynamicOdds.oddsAway,
    lastGoalAt: lastGoalDate ?? null,
    suspended,
    tickHistory: finalHistory,
    markets: customMarkets ?? null,
    homeLogo: homeLogo ?? null,
    awayLogo: awayLogo ?? null,
    scriptedEvents: isOver && m.source === "virtual" ? null : m.scriptedEvents,
    finishedAt: isOver ? new Date(Math.min(now, naturalEndMs)) : m.finishedAt,
  };

  return { changed: true, finished: isOver, row: nextRow };
}

/**
 * Persiste tous les matchs modifiés d'un tick en UNE SEULE requête SQL `UPDATE ... FROM (VALUES ...)`,
 * puis exécute en lot unique l'apprentissage Glicko-2 et le règlement des paris des matchs terminés.
 */
async function flushMatchUpdatesBatch(
  rowsToFlush: MatchRow[],
  finishedRows: MatchRow[],
  now: number
): Promise<void> {
  if (rowsToFlush.length > 0) {
    const tuples = sql.join(
      rowsToFlush.map((r) => {
        const startsAtIso = r.startsAt.toISOString();
        const lastGoalIso = r.lastGoalAt ? r.lastGoalAt.toISOString() : null;
        const finishedIso =
          r.status === "finished"
            ? (r.finishedAt ?? new Date(now)).toISOString()
            : r.finishedAt
              ? r.finishedAt.toISOString()
              : null;
        const eventsJson = JSON.stringify(r.events ?? []);
        // Compactage en base : un match terminé n'a plus besoin de `tick_history`, et un match live
        // ne persiste en base que son curseur d'horloge `sim/clock` (~55 octets au lieu de 1,5 Ko).
        const compactDbHistory =
          r.status === "finished"
            ? []
            : (r.tickHistory ?? []).filter(
                (t) => t.market === "sim" && t.selection === "clock"
              );
        const historyJson = JSON.stringify(compactDbHistory);
        const marketsJson = r.markets ? JSON.stringify(r.markets) : null;
        const clearScripted = r.status === "finished" && r.source === "virtual";

        return sql`(
          ${r.id}::int,
          ${r.homeScore ?? 0}::int,
          ${r.awayScore ?? 0}::int,
          ${r.redHome ?? 0}::int,
          ${r.redAway ?? 0}::int,
          ${eventsJson}::jsonb,
          ${r.minute}::text,
          ${r.status}::text,
          ${r.oddsHome}::float8,
          ${r.oddsDraw}::float8,
          ${r.oddsAway}::float8,
          ${lastGoalIso}::timestamptz::timestamp,
          ${Boolean(r.suspended)}::boolean,
          ${historyJson}::jsonb,
          ${marketsJson}::jsonb,
          ${r.homeLogo}::text,
          ${r.awayLogo}::text,
          ${startsAtIso}::timestamptz::timestamp,
          ${finishedIso}::timestamptz::timestamp,
          ${clearScripted}::boolean
        )`;
      }),
      sql`, `
    );

    await db.execute(sql`
      UPDATE "matches" AS m
      SET
        "home_score" = v.home_score,
        "away_score" = v.away_score,
        "red_home" = v.red_home,
        "red_away" = v.red_away,
        "events" = v.events,
        "minute" = v.minute,
        "status" = v.status,
        "odds_home" = v.odds_home,
        "odds_draw" = v.odds_draw,
        "odds_away" = v.odds_away,
        "last_goal_at" = v.last_goal_at,
        "suspended" = v.suspended,
        "tick_history" = v.tick_history,
        "markets" = v.markets,
        "home_logo" = v.home_logo,
        "away_logo" = v.away_logo,
        "starts_at" = v.starts_at,
        "finished_at" = v.finished_at,
        "scripted_events" = CASE WHEN v.clear_scripted THEN NULL ELSE m."scripted_events" END
      FROM (VALUES ${tuples}) AS v(
        id, home_score, away_score, red_home, red_away, events, minute, status,
        odds_home, odds_draw, odds_away, last_goal_at, suspended, tick_history,
        markets, home_logo, away_logo, starts_at, finished_at, clear_scripted
      )
      WHERE m."id" = v.id
    `);
  }

  if (finishedRows.length > 0) {
    try {
      await recordMatchesFinishedBatchMl(
        finishedRows.map((fr) => ({
          homeTeam: fr.homeTeam,
          awayTeam: fr.awayTeam,
          homeScore: fr.homeScore ?? 0,
          awayScore: fr.awayScore ?? 0,
        }))
      );
    } catch (mlErr) {
      console.error("[ml online match batch update]", mlErr);
    }

    await settleMatchesBetsBatch(
      finishedRows.map((fr) => fr.id),
      { skipCombos: true }
    );
  }
}

/**
 * Purge douce des anciens matchs virtuels terminés au-delà des 150 plus récents
 * lorsqu'aucun pari simple ni combiné n'y fait référence : maintient la table `matches`
 * légère (< 2 Mo) et protège le quota de transfert réseau PostgreSQL (Neon egress).
 */
export async function pruneOldFinishedVirtualMatches(): Promise<void> {
  await db.execute(sql`
    DELETE FROM "matches" m
    WHERE m."source" = 'virtual'
      AND m."status" = 'finished'
      AND COALESCE(m."finished_at", m."starts_at" + interval '608 seconds') < now() - interval '7 days 1 hour'
      AND m."id" NOT IN (
        SELECT "id"
        FROM "matches"
        WHERE "source" = 'virtual' AND "status" = 'finished'
        ORDER BY "finished_at" DESC NULLS LAST, "id" DESC
        LIMIT 150
      )
      AND NOT EXISTS (
        SELECT 1 FROM "bets" b WHERE b."match_id" = m."id"
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "combo_bets" cb,
             jsonb_array_elements(cb."legs") AS leg
        WHERE (leg->>'matchId') = m."id"::text
      );
  `);
}

/* ============================================================================
 *  MOTEUR D'APERÇU & CONTRÔLE DES SCORES ANTICIPÉS (ADMIN UNIQUEMENT)
 *  - Mode 1 ("dynamic") : aperçu temps réel + bouclier actif, verrouillable/éditable par match
 *  - Mode 2 ("locked")  : scénario 100 % figé d'office dès la mise en file
 * ============================================================================ */

export type ScenarioMode = "dynamic" | "locked";

export interface ScriptedMatchEvent {
  type: string;
  team: string;
  minute: number;
  player?: string;
}

export interface AdminMatchForecast {
  matchId: number;
  finalHomeScore: number;
  finalAwayScore: number;
  htHomeScore: number;
  htAwayScore: number;
  isLocked: boolean;
  events: ScriptedMatchEvent[];
}

let cachedScenarioMode: { mode: ScenarioMode; ts: number } | null = null;

export async function getScenarioMode(): Promise<ScenarioMode> {
  const now = Date.now();
  if (cachedScenarioMode && now - cachedScenarioMode.ts < 45_000) {
    return cachedScenarioMode.mode;
  }
  try {
    const [row] = await db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.settingKey, "scenario_mode"));
    const raw = (row?.value as { mode?: string } | undefined)?.mode;
    const mode: ScenarioMode = raw === "locked" ? "locked" : "dynamic";
    cachedScenarioMode = { mode, ts: now };
    return mode;
  } catch {
    return "dynamic";
  }
}

function elapsedSimulatedMinute(m: MatchRow): number {
  if (m.status !== "live") return 0;
  const tickHistory = Array.isArray(m.tickHistory) ? m.tickHistory : [];
  const simEntries = tickHistory.filter((t) => t.market === "sim" && t.selection === "clock");
  if (simEntries.length > 0) {
    return Math.max(0, Math.min(90, Math.max(...simEntries.map((t) => Math.round(t.to)))));
  }
  if ((m.homeScore ?? 0) > 0 || (m.awayScore ?? 0) > 0 || (m.events ?? []).length > 0) {
    return Math.max(0, Math.min(90, minuteNumber(m.minute)));
  }
  return 0;
}

function simulateMatchRange(
  m: Pick<
    MatchRow,
    | "id"
    | "homeTeam"
    | "awayTeam"
    | "regime"
    | "homeForm"
    | "awayForm"
    | "scenarioNonce"
    | "scriptedEvents"
  >,
  fromMinExclusive: number,
  toMinInclusive: number,
  initHome: number,
  initAway: number,
  initRedHome: number,
  initRedAway: number,
  initEvents: ScriptedMatchEvent[],
  pressure: MatchBookPressure,
  useScripted: boolean
): {
  home: number;
  away: number;
  redHome: number;
  redAway: number;
  events: ScriptedMatchEvent[];
  justScoredNow: boolean;
} {
  let home = initHome;
  let away = initAway;
  let redHome = initRedHome;
  let redAway = initRedAway;
  const events = initEvents.map((e) => ({ ...e }));
  let justScoredNow = false;

  if (toMinInclusive <= fromMinExclusive) {
    return { home, away, redHome, redAway, events, justScoredNow };
  }

  if (useScripted && Array.isArray(m.scriptedEvents)) {
    const ordered = [...m.scriptedEvents].sort((a, b) => a.minute - b.minute);
    for (const ev of ordered) {
      if (ev.minute <= fromMinExclusive || ev.minute > toMinInclusive) continue;
      if (ev.type === "goal") {
        if (ev.team === "home") home += 1;
        else away += 1;
        events.push({ ...ev });
        if (ev.minute >= toMinInclusive - 1 && toMinInclusive - fromMinExclusive <= 4) {
          justScoredNow = true;
        }
      } else if (ev.type === "red_card") {
        if (ev.team === "home") redHome += 1;
        else redAway += 1;
        events.push({ ...ev });
        if (ev.minute >= toMinInclusive - 1 && toMinInclusive - fromMinExclusive <= 4) {
          justScoredNow = true;
        }
      }
    }
    return { home, away, redHome, redAway, events, justScoredNow };
  }

  const { lambdaHome, lambdaAway } = expectedGoals(m.homeTeam, m.awayTeam);
  const baseEffH = lambdaHome * (m.homeForm ?? 1);
  const baseEffA = lambdaAway * (m.awayForm ?? 1);
  const nonce = m.scenarioNonce ?? 0;

  for (let min = fromMinExclusive + 1; min <= toMinInclusive; min++) {
    const share = minuteGoalShare(min);
    const reg = regimeFactors(m.regime, min, baseEffH, baseEffA);

    const scoreDiff = home - away;
    let tacH = 1.0;
    let tacA = 1.0;

    if (home === 0 && away === 0) {
      tacH = 0.97;
      tacA = 0.97;
    } else if (home === 1 && away === 0) {
      tacH = 0.98;
      tacA = 1.07;
    } else if (home === 0 && away === 1) {
      tacH = 1.07;
      tacA = 0.98;
    } else if (scoreDiff === 0 && home >= 1 && min >= 66) {
      tacH = 0.91;
      tacA = 0.91;
    } else if (Math.abs(scoreDiff) >= 2 && min >= 70) {
      tacH = 0.94;
      tacA = 0.94;
    }

    const shield = computeDynamicStepTilts(
      pressure,
      home,
      away,
      min,
      baseEffH,
      baseEffA,
      events
    );

    const rateH =
      baseEffH *
      reg.hMult *
      tacH *
      shield.hTilt *
      share *
      Math.pow(0.68, redHome) *
      (1 + 0.18 * redAway);
    const rateA =
      baseEffA *
      reg.aMult *
      tacA *
      shield.aTilt *
      share *
      Math.pow(0.68, redAway) *
      (1 + 0.18 * redHome);

    const rng = createServerRng(
      `live-sim-v5|${m.id}|${m.homeTeam}|${m.awayTeam}|${nonce}|${min}`
    );
    const uHome = rng();
    const uAway = rng();
    const scorerSeed = Math.floor(rng() * 100_000);
    const uRed = rng();
    const uRedSide = rng();

    if (uHome < 1 - Math.exp(-rateH) && home < 7) {
      home += 1;
      const player = pickScorerName(m.homeTeam, scorerSeed);
      events.push({
        type: "goal",
        team: "home",
        minute: min,
        ...(player ? { player } : {}),
      });
      if (min >= toMinInclusive - 1 && toMinInclusive - fromMinExclusive <= 4) {
        justScoredNow = true;
      }
    }

    if (uAway < 1 - Math.exp(-rateA) && away < 7) {
      away += 1;
      const player = pickScorerName(m.awayTeam, scorerSeed + 31);
      events.push({
        type: "goal",
        team: "away",
        minute: min,
        ...(player ? { player } : {}),
      });
      if (min >= toMinInclusive - 1 && toMinInclusive - fromMinExclusive <= 4) {
        justScoredNow = true;
      }
    }

    if (min >= 18 && redHome + redAway < 2 && uRed < 0.0019) {
      const side = uRedSide < 0.5 ? "home" : "away";
      if (side === "home") redHome += 1;
      else redAway += 1;
      events.push({ type: "red_card", team: side, minute: min });
      if (min >= toMinInclusive - 1 && toMinInclusive - fromMinExclusive <= 4) {
        justScoredNow = true;
      }
    }
  }

  return { home, away, redHome, redAway, events, justScoredNow };
}

function buildForecastForRow(
  m: MatchRow,
  pressure: MatchBookPressure
): AdminMatchForecast {
  const curMin = elapsedSimulatedMinute(m);
  const initHome = m.status === "live" ? (m.homeScore ?? 0) : 0;
  const initAway = m.status === "live" ? (m.awayScore ?? 0) : 0;
  const initRedH = m.status === "live" ? (m.redHome ?? 0) : 0;
  const initRedA = m.status === "live" ? (m.redAway ?? 0) : 0;
  const initEvents =
    m.status === "live" && Array.isArray(m.events)
      ? m.events.filter((e) => e.minute <= curMin)
      : [];

  const isLocked = Boolean(m.scenarioLocked && Array.isArray(m.scriptedEvents));
  const sim = simulateMatchRange(
    m,
    curMin,
    90,
    initHome,
    initAway,
    initRedH,
    initRedA,
    initEvents,
    pressure,
    isLocked
  );

  let htHome = 0;
  let htAway = 0;
  for (const ev of sim.events) {
    if (ev.type === "goal" && ev.minute <= 45) {
      if (ev.team === "home") htHome += 1;
      else htAway += 1;
    }
  }

  return {
    matchId: m.id,
    finalHomeScore: sim.home,
    finalAwayScore: sim.away,
    htHomeScore: htHome,
    htAwayScore: htAway,
    isLocked,
    events: sim.events,
  };
}

export async function getAdminMatchForecasts(
  matchRows: MatchRow[]
): Promise<{ mode: ScenarioMode; forecasts: Record<number, AdminMatchForecast> }> {
  await ensureMlLoaded();
  const mode = await getScenarioMode();

  const openMatches = matchRows.filter(
    (m) => m.status === "upcoming" || m.status === "live"
  );
  if (openMatches.length === 0) {
    return { mode, forecasts: {} };
  }

  const openIds = openMatches.map((m) => m.id);
  const openIdSet = new Set(openIds);
  const [pendingBets, pendingCombos, houseHealth] = await Promise.all([
    db
      .select({
        userId: bets.userId,
        matchId: bets.matchId,
        market: bets.market,
        selection: bets.selection,
        stake: bets.stake,
        odds: bets.odds,
      })
      .from(bets)
      .where(and(inArray(bets.matchId, openIds), eq(bets.status, "pending"))),
    db
      .select({
        userId: comboBets.userId,
        stake: comboBets.stake,
        baseOdds: comboBets.baseOdds,
        legs: comboBets.legs,
      })
      .from(comboBets)
      .where(eq(comboBets.status, "pending")),
    getGlobalHouseHealth(),
  ]);

  const userIds: number[] = [];
  for (const b of pendingBets) userIds.push(b.userId);
  for (const cb of pendingCombos) userIds.push(cb.userId);
  const riskMap = await computeUserPatternRiskWeights(userIds);

  const betsByMatch = new Map<number, PendingMatchTicket[]>();
  for (const b of pendingBets) {
    if (b.matchId == null) continue;
    const arr = betsByMatch.get(b.matchId) ?? [];
    arr.push({
      market: b.market,
      selection: b.selection,
      stake: b.stake,
      odds: b.odds,
      riskWeight: riskMap.get(b.userId) ?? 1.0,
    });
    betsByMatch.set(b.matchId, arr);
  }
  for (const cb of pendingCombos) {
    const uWeight = riskMap.get(cb.userId) ?? 1.0;
    for (const leg of cb.legs ?? []) {
      if (leg.kind !== "sport" || !leg.matchId || leg.status !== "pending") continue;
      if (!openIdSet.has(leg.matchId)) continue;
      const arr = betsByMatch.get(leg.matchId) ?? [];
      const effectiveOdds = Math.min(
        25,
        leg.odds * Math.pow(Math.max(1, cb.baseOdds / Math.max(1.01, leg.odds)), 0.35)
      );
      arr.push({
        market: leg.market,
        selection: leg.selection,
        stake: cb.stake,
        odds: effectiveOdds,
        riskWeight: uWeight,
      });
      betsByMatch.set(leg.matchId, arr);
    }
  }

  const forecasts: Record<number, AdminMatchForecast> = {};
  for (const m of openMatches) {
    if (m.source !== "virtual") continue;
    const pressure: MatchBookPressure = {
      tickets: betsByMatch.get(m.id) ?? [],
      houseTightness: houseHealth.tightness,
    };
    forecasts[m.id] = buildForecastForRow(m, pressure);
  }

  return { mode, forecasts };
}

export async function setScenarioMode(nextMode: ScenarioMode): Promise<ScenarioMode> {
  await ensureSeeded();
  await ensureMlLoaded();

  await db
    .insert(adminSettings)
    .values({
      settingKey: "scenario_mode",
      value: { mode: nextMode },
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: adminSettings.settingKey,
      set: {
        value: { mode: nextMode },
        updatedAt: new Date(),
      },
    });

  cachedScenarioMode = { mode: nextMode, ts: Date.now() };

  const openVirtual = await db
    .select()
    .from(matches)
    .where(and(eq(matches.source, "virtual"), inArray(matches.status, ["upcoming", "live"])));

  const neutral: MatchBookPressure = { tickets: [], houseTightness: 1 };

  if (nextMode === "locked") {
    for (const m of openVirtual) {
      if (m.source !== "virtual") continue;
      if (m.scenarioLocked && Array.isArray(m.scriptedEvents)) continue;
      const fc = buildForecastForRow(m, neutral);
      await db
        .update(matches)
        .set({ scenarioLocked: true, scriptedEvents: fc.events })
        .where(eq(matches.id, m.id));
    }
  } else {
    for (const m of openVirtual) {
      if (m.source !== "virtual") continue;
      if (m.status === "upcoming" && m.scenarioLocked) {
        await db
          .update(matches)
          .set({ scenarioLocked: false, scriptedEvents: null })
          .where(eq(matches.id, m.id));
      }
    }
  }

  invalidateAllActiveCaches();
  return nextMode;
}

export async function lockMatchScenario(matchId: number): Promise<AdminMatchForecast | null> {
  await ensureMlLoaded();
  const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!m || m.status === "finished" || m.source !== "virtual") return null;

  const { forecasts } = await getAdminMatchForecasts([m]);
  const fc =
    forecasts[m.id] ?? buildForecastForRow(m, { tickets: [], houseTightness: 1 });

  await db
    .update(matches)
    .set({ scenarioLocked: true, scriptedEvents: fc.events })
    .where(eq(matches.id, matchId));

  invalidateAllActiveCaches();
  return { ...fc, isLocked: true };
}

export async function unlockMatchScenario(matchId: number): Promise<void> {
  await db
    .update(matches)
    .set({ scenarioLocked: false, scriptedEvents: null })
    .where(and(eq(matches.id, matchId), eq(matches.source, "virtual")));
  invalidateAllActiveCaches();
}

export async function rerollMatchScenario(matchId: number): Promise<AdminMatchForecast | null> {
  await ensureMlLoaded();
  const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!m || m.status === "finished" || m.source !== "virtual") return null;

  const mode = await getScenarioMode();
  const nextNonce = (m.scenarioNonce ?? 0) + 1;
  const shouldRemainLocked = Boolean(m.scenarioLocked) || mode === "locked";

  const draft: MatchRow = {
    ...m,
    scenarioNonce: nextNonce,
    scenarioLocked: false,
    scriptedEvents: null,
  };
  const fc = buildForecastForRow(draft, { tickets: [], houseTightness: 1 });

  await db
    .update(matches)
    .set({
      scenarioNonce: nextNonce,
      scenarioLocked: shouldRemainLocked,
      scriptedEvents: shouldRemainLocked ? fc.events : null,
    })
    .where(eq(matches.id, matchId));

  invalidateAllActiveCaches();
  return { ...fc, isLocked: shouldRemainLocked };
}

function drawWeightedMinute(rng: () => number, minMinute: number, maxMinute: number): number {
  let totalW = 0;
  for (let m = minMinute; m <= maxMinute; m++) {
    totalW += minuteGoalShare(m);
  }
  let target = rng() * (totalW || 1);
  for (let m = minMinute; m <= maxMinute; m++) {
    target -= minuteGoalShare(m);
    if (target <= 0) return m;
  }
  return maxMinute;
}

export async function forceMatchFinalScore(
  matchId: number,
  rawHome: number,
  rawAway: number
): Promise<AdminMatchForecast | null> {
  await ensureMlLoaded();
  const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!m || m.status === "finished" || m.source !== "virtual") return null;

  const curMin = elapsedSimulatedMinute(m);
  const curHome = m.status === "live" ? (m.homeScore ?? 0) : 0;
  const curAway = m.status === "live" ? (m.awayScore ?? 0) : 0;

  const targetHome = Math.min(9, Math.max(curHome, Math.floor(rawHome)));
  const targetAway = Math.min(9, Math.max(curAway, Math.floor(rawAway)));

  const keptEvents: ScriptedMatchEvent[] =
    m.status === "live" && Array.isArray(m.events)
      ? m.events.filter((e) => e.minute <= curMin).map((e) => ({ ...e }))
      : [];

  const nextNonce = (m.scenarioNonce ?? 0) + 1;
  const rng = createServerRng(
    `admin-force-score|${m.id}|${targetHome}|${targetAway}|${nextNonce}`
  );

  const minGoalMin = Math.min(90, curMin + 1);
  const newEvents: ScriptedMatchEvent[] = [];
  const usedMinutes = new Set<number>(keptEvents.map((e) => e.minute));

  const pickDistinctMin = () => {
    for (let attempt = 0; attempt < 25; attempt++) {
      const cand = drawWeightedMinute(rng, minGoalMin, 90);
      if (!usedMinutes.has(cand)) {
        usedMinutes.add(cand);
        return cand;
      }
    }
    return drawWeightedMinute(rng, minGoalMin, 90);
  };

  const addHome = targetHome - curHome;
  const addAway = targetAway - curAway;

  for (let i = 0; i < addHome; i++) {
    const minute = pickDistinctMin();
    const player = pickScorerName(m.homeTeam, Math.floor(rng() * 100_000));
    newEvents.push({
      type: "goal",
      team: "home",
      minute,
      ...(player ? { player } : {}),
    });
  }

  for (let i = 0; i < addAway; i++) {
    const minute = pickDistinctMin();
    const player = pickScorerName(m.awayTeam, Math.floor(rng() * 100_000) + 17);
    newEvents.push({
      type: "goal",
      team: "away",
      minute,
      ...(player ? { player } : {}),
    });
  }

  const allEvents = [...keptEvents, ...newEvents].sort((a, b) => a.minute - b.minute);

  await db
    .update(matches)
    .set({
      scenarioNonce: nextNonce,
      scenarioLocked: true,
      scriptedEvents: allEvents,
      ...(m.status === "live" && curMin >= 90
        ? {
            homeScore: targetHome,
            awayScore: targetAway,
            events: allEvents,
          }
        : {}),
    })
    .where(eq(matches.id, matchId));

  let htHome = 0;
  let htAway = 0;
  for (const ev of allEvents) {
    if (ev.type === "goal" && ev.minute <= 45) {
      if (ev.team === "home") htHome += 1;
      else htAway += 1;
    }
  }

  invalidateAllActiveCaches();

  return {
    matchId: m.id,
    finalHomeScore: targetHome,
    finalAwayScore: targetAway,
    htHomeScore: htHome,
    htAwayScore: htAway,
    isLocked: true,
    events: allEvents,
  };
}

/**
 * Projette instantanément en mémoire (0 requête SQL) une ligne de match virtuel
 * à l'instant exact `nowMs` : garantit que `GET /api/bets`, `POST /api/bets/cashout`
 * et `GET /api/coupons` voient toujours la minute exacte (`>= 85'` verrouillé),
 * le score exact et les cotes live exactes même entre deux jalons PostgreSQL.
 */
const MAX_REAL_LIVE_PROJECTION_SEC = 75;

function toEpochMs(v: Date | string | null | undefined): number {
  if (!v) return 0;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
}

function pickFresherManualRow(a: MatchRow, b: MatchRow | null): MatchRow {
  if (!b) return a;
  if (a.status === "finished" && b.status !== "finished") return a;
  if (b.status === "finished" && a.status !== "finished") return b;
  const aSync = Math.max(
    toEpochMs(a.feedSyncedAt),
    toEpochMs(a.realStats?.updatedAt)
  );
  const bSync = Math.max(
    toEpochMs(b.feedSyncedAt),
    toEpochMs(b.realStats?.updatedAt)
  );
  if (aSync !== bSync) return aSync >= bSync ? a : b;
  const aGoals = (a.homeScore ?? 0) + (a.awayScore ?? 0);
  const bGoals = (b.homeScore ?? 0) + (b.awayScore ?? 0);
  if (aGoals !== bGoals) return aGoals >= bGoals ? a : b;
  const aEvs = a.events?.length ?? 0;
  const bEvs = b.events?.length ?? 0;
  return aEvs >= bEvs ? a : b;
}

function projectLiveRealMatchRow(base: MatchRow, nowMs: number): MatchRow {
  if (base.source !== "manual" || base.status !== "live" || base.suspended) {
    return base;
  }
  const anchor = buildServerClockAnchor(base, nowMs);
  if (
    !anchor ||
    anchor.mode !== "real" ||
    anchor.phase === "HT" ||
    anchor.phase === "PAUSED" ||
    anchor.anchorSeconds == null ||
    anchor.syncedAtMs == null
  ) {
    return base;
  }

  const driftSec = Math.max(
    0,
    Math.min(
      MAX_REAL_LIVE_PROJECTION_SEC,
      Math.floor((nowMs - anchor.syncedAtMs) / 1_000)
    )
  );
  if (driftSec <= 0 && base.realStats?.clockSeconds != null) {
    return base;
  }

  const is2H =
    anchor.phase === "2H" ||
    anchor.phase === "2H_STOPPAGE";
  const rawProjSec = anchor.anchorSeconds + driftSec;
  const projSec = !is2H
    ? Math.max(0, rawProjSec)
    : Math.min(Math.max(5880, anchor.anchorSeconds), Math.max(2700, rawProjSec));

  let projMinute = base.minute;
  if (!is2H) {
    projMinute =
      projSec < 2700
        ? `${Math.min(45, Math.max(1, Math.floor(projSec / 60) + 1))}’`
        : `45+${Math.max(1, Math.floor((projSec - 2700) / 60) + 1)}’`;
  } else {
    projMinute =
      projSec < 5400
        ? `${Math.min(90, Math.max(46, Math.floor(projSec / 60) + 1))}’`
        : `90+${Math.max(1, Math.floor((projSec - 5400) / 60) + 1)}’`;
  }

  const prevStats = base.realStats;
  return {
    ...base,
    minute: projMinute,
    realStats: {
      possessionHome: prevStats?.possessionHome ?? null,
      possessionAway: prevStats?.possessionAway ?? null,
      shotsTotalHome: prevStats?.shotsTotalHome ?? null,
      shotsTotalAway: prevStats?.shotsTotalAway ?? null,
      shotsOnTargetHome: prevStats?.shotsOnTargetHome ?? null,
      shotsOnTargetAway: prevStats?.shotsOnTargetAway ?? null,
      cornersHome: prevStats?.cornersHome ?? null,
      cornersAway: prevStats?.cornersAway ?? null,
      foulsHome: prevStats?.foulsHome ?? null,
      foulsAway: prevStats?.foulsAway ?? null,
      offsidesHome: prevStats?.offsidesHome ?? null,
      offsidesAway: prevStats?.offsidesAway ?? null,
      savesHome: prevStats?.savesHome ?? null,
      savesAway: prevStats?.savesAway ?? null,
      yellowCardsHome: prevStats?.yellowCardsHome ?? null,
      yellowCardsAway: prevStats?.yellowCardsAway ?? null,
      htHomeScore: prevStats?.htHomeScore ?? base.htHomeScore ?? null,
      htAwayScore: prevStats?.htAwayScore ?? base.htAwayScore ?? null,
      statSnapshots: prevStats?.statSnapshots,
      liveFeedProbs: prevStats?.liveFeedProbs ?? null,
      feedTotalGoalsExpected: prevStats?.feedTotalGoalsExpected ?? null,
      clockSeconds: projSec,
      clockPeriod: is2H ? 2 : 1,
      updatedAt: new Date(nowMs).toISOString(),
    },
  };
}

export function hydrateLiveMatchRow(match: MatchRow, nowMs = Date.now()): MatchRow {
  const cached = getCachedMatchById(match.id);
  if (match.source === "manual" || cached?.source === "manual") {
    const fresher = pickFresherManualRow(match, cached);
    return projectLiveRealMatchRow(fresher, nowMs);
  }

  if (match.status === "finished") return match;
  if (cached?.status === "finished") return cached;

  const base =
    cached &&
    cached.status === "live" &&
    (match.status !== "live" ||
      ((cached.homeScore ?? 0) + (cached.awayScore ?? 0) >
        (match.homeScore ?? 0) + (match.awayScore ?? 0)) ||
      (cached.events?.length ?? 0) > (match.events?.length ?? 0) ||
      minuteNumber(cached.minute) >= minuteNumber(match.minute))
      ? cached
      : match;

  if (base.status !== "live") {
    return base;
  }
  const stepped = stepLiveMatchInMemory(
    base,
    nowMs,
    { tickets: [], houseTightness: 1 },
    false
  );
  return stepped.row;
}

/**
 * Point de contrôle sécurisé exécuté juste avant l'enregistrement d'un pari réel
 * (`POST /api/bets` et `POST /api/bets/combo`) :
 * - Relit les lignes cibles depuis PostgreSQL, applique la projection horaire exacte `nowMs`,
 * - Persiste le point de contrôle si le match virtuel est en direct,
 * - Retourne l'état 100 % cohérent et infalsifiable pour la tarification et le contrôle `>= 85'`.
 */
export async function checkpointVirtualMatchesForBet(
  rowsFromDb: MatchRow[],
  nowMs = Date.now()
): Promise<Map<number, MatchRow>> {
  const out = new Map<number, MatchRow>();
  const toFlush: MatchRow[] = [];
  const finished: MatchRow[] = [];

  for (const raw of rowsFromDb) {
    if (raw.source === "manual") {
      out.set(raw.id, projectLiveRealMatchRow(raw, nowMs));
      continue;
    }
    if (raw.status !== "live") {
      out.set(raw.id, raw);
      continue;
    }
    const cached = getCachedMatchById(raw.id);
    // Privilégie la ligne la plus avancée entre PostgreSQL et le store mémoire
    const base =
      cached &&
      cached.status === "live" &&
      minuteNumber(cached.minute) >= minuteNumber(raw.minute) &&
      (cached.events?.length ?? 0) >= (raw.events?.length ?? 0)
        ? cached
        : raw;

    const stepped = stepLiveMatchInMemory(
      base,
      nowMs,
      { tickets: [], houseTightness: 1 },
      false
    );
    out.set(raw.id, stepped.row);
    if (
      stepped.finished ||
      stepped.row.minute !== raw.minute ||
      stepped.row.homeScore !== raw.homeScore ||
      stepped.row.awayScore !== raw.awayScore ||
      stepped.row.suspended !== raw.suspended
    ) {
      toFlush.push(stepped.row);
      if (stepped.finished) finished.push(stepped.row);
    }
  }

  if (toFlush.length > 0) {
    upsertCachedMatches(toFlush);
    await flushMatchUpdatesBatch(toFlush, finished, nowMs);
  }

  return out;
}

