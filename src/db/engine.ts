import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { settlePendingCombos } from "@/lib/combo";
import { settleMatchesBetsBatch } from "@/lib/settle";
import { adminSettings, appUser, bets, comboBets, matches, type MatchRow } from "@/db/schema";
import {
  expectedGoals,
  goalTimeCDF,
  hashString,
  liveOddsFor,
  minuteGoalShare,
  oddsFor,
  pickScorerName,
   poissonPmf,
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
import { isKnownMarket, marketSettle, minuteNumber } from "@/lib/markets";
import { ensureMlLoaded, recordMatchesFinishedBatchMl } from "@/lib/ml-engine";
import { createServerRng, hmacUint32 } from "@/lib/server-rng";
import { teamLogo } from "@/lib/team-logos";

/** Suspension brève du marché après un but (~2,2 s). */
const GOAL_SUSPEND_MS = 2_200;
const TICK_THROTTLE_MS = 2_400;
/** Transition courte entre la fin d'un match et le coup d'envoi planifié du suivant sur un même canal. */
const INTER_MATCH_GAP_MS = 3_000;

/**
 * Rythme des matchs :
 * - Matchs virtuels automatiques (`source = "virtual"`) : durée totale de 5 minutes
 *   (95 pas d'horloge × [3 120 ms .. 3 200 ms] ≈ 4m56s .. 5m04s, moyenne exacte 5 min 00 s),
 *   avec 4 matchs virtuels en direct simultanément sur 4 canaux décalés (multiplex fluide continu 24h/24).
 * - Matchs manuels créés par l'admin (`source = "manual"`) : rythme réel confortable (40 s / min)
 *   pour laisser le pilotage complet à l'administrateur.
 */
export const MANUAL_MINUTE_REAL_MS = 40_000;
export const VIRTUAL_STEP_MIN_MS = 3_120; // ~4 min 56 s au total
export const VIRTUAL_STEP_MAX_MS = 3_200; // ~5 min 04 s au total (moyenne 5 min 00 s)
const TOTAL_CLOCK_STEPS = 95;

/** Nombre de matchs virtuels diffusés en direct simultanément (décalés sur 4 canaux parallèles). */
export const CONCURRENT_LIVE_VIRTUAL = 4;
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

/**
 * Pool élargi de 36 affiches européennes variées (chocs équilibrés, derbies,
 * déplacements périlleux de cadors chez des outsiders accrocheurs).
 * L'orientation Domicile / Extérieur est en plus tirée cryptographiquement à 50/50
 * à chaque cycle avec équilibrage strict de la file pour éliminer tout biais domicile.
 */
const FIXTURE_POOL: FixtureTemplate[] = [
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

/**
 * Contrôle stochastique optimal sur la grille exacte des scores finaux :
 * Évalue en continu l'espérance de gain versé par la banque `V(h, a)` sur TOUS les
 * marchés ouverts (1N2, Double chance, Over/Under, BTTS, Résultat+Total, Buts par équipe,
 * Clean sheet, Victoire sans encaisser, Score exact, Pair/Impair, Combinés) et module
 * finement l'intensité instantanée `(hTilt, aTilt)` selon le coût marginal exact
 * d'un but domicile `V(h+1, a) - V(h, a)` vs un but extérieur `V(h, a+1) - V(h, a)`.
 */
export function computeDynamicStepTilts(
  pressure: MatchBookPressure,
  home: number,
  away: number,
  minute: number,
  baseLambdaH: number,
  baseLambdaA: number,
  eventsSoFar?: Array<{ type: string; team: string; minute: number }>
): { hTilt: number; aTilt: number } {
  const { tickets, houseTightness } = pressure;
  if (tickets.length === 0) {
    return { hTilt: 1, aTilt: 1 };
  }

  const remShare = Math.max(0.02, 1 - goalTimeCDF(minute));
  const remH = Math.max(0.02, baseLambdaH * remShare);
  const remA = Math.max(0.02, baseLambdaA * remShare);
  const htRemFrac =
    minute <= 45 ? Math.max(0, Math.min(1, (goalTimeCDF(45) - goalTimeCDF(minute)) / remShare)) : 0;

  const priorGoals = (eventsSoFar ?? []).filter(
    (e) => e.type === "goal" && (e.team === "home" || e.team === "away")
  );
  const priorHtH = priorGoals.filter((g) => g.team === "home" && g.minute <= 45).length;
  const priorHtA = priorGoals.filter((g) => g.team === "away" && g.minute <= 45).length;

  const MAX_ADD = 4;
  const pH: number[] = [];
  const pA: number[] = [];
  let sumPH = 0;
  let sumPA = 0;
  for (let k = 0; k <= MAX_ADD; k++) {
    const vh = poissonPmf(k, remH);
    const va = poissonPmf(k, remA);
    pH.push(vh);
    pA.push(va);
    sumPH += vh;
    sumPA += va;
  }
  for (let k = 0; k <= MAX_ADD; k++) {
    pH[k] /= sumPH || 1;
    pA[k] /= sumPA || 1;
  }

  const evalScenarioPayout = (offH: number, offA: number, dh: number, da: number): number => {
    const fh = home + offH + dh;
    const fa = away + offA + da;
    const estHtH =
      minute <= 45 ? home + offH + Math.round(dh * htRemFrac) : Math.min(fh, priorHtH);
    const estHtA =
      minute <= 45 ? away + offA + Math.round(da * htRemFrac) : Math.min(fa, priorHtA);

    const synthEvents: Array<{ type: string; team: string; minute: number }> = [];
    if (fh + fa > 0) {
      let firstTeam: "home" | "away" = "home";
      if (priorGoals.length > 0) {
        firstTeam = priorGoals[0].team === "home" ? "home" : "away";
      } else if (offH > 0) {
        firstTeam = "home";
      } else if (offA > 0) {
        firstTeam = "away";
      } else {
        firstTeam = dh >= da && dh > 0 ? "home" : da > 0 ? "away" : "home";
      }
      let rem1H = estHtH;
      let rem1A = estHtA;
      let rem2H = fh - estHtH;
      let rem2A = fa - estHtA;
      if (firstTeam === "home") {
        if (rem1H > 0) {
          synthEvents.push({ type: "goal", team: "home", minute: 10 });
          rem1H--;
        } else if (rem2H > 0) {
          synthEvents.push({ type: "goal", team: "home", minute: 50 });
          rem2H--;
        }
      } else {
        if (rem1A > 0) {
          synthEvents.push({ type: "goal", team: "away", minute: 10 });
          rem1A--;
        } else if (rem2A > 0) {
          synthEvents.push({ type: "goal", team: "away", minute: 50 });
          rem2A--;
        }
      }
      for (let i = 0; i < rem1H; i++) synthEvents.push({ type: "goal", team: "home", minute: 25 });
      for (let i = 0; i < rem1A; i++) synthEvents.push({ type: "goal", team: "away", minute: 28 });
      for (let i = 0; i < rem2H; i++) synthEvents.push({ type: "goal", team: "home", minute: 70 });
      for (let i = 0; i < rem2A; i++) synthEvents.push({ type: "goal", team: "away", minute: 72 });
    }

    let payout = 0;
    for (const t of tickets) {
      if (isKnownMarket(t.market)) {
        const res = marketSettle(t.market, t.selection, fh, fa, synthEvents, 0);
        if (res.voided) {
          payout += t.stake * t.riskWeight;
        } else if (res.won) {
          payout += t.stake * t.odds * t.riskWeight;
        }
      } else if (t.market === "result") {
        const won = t.selection === "home" ? fh > fa : t.selection === "away" ? fa > fh : fh === fa;
        if (won) payout += t.stake * t.odds * t.riskWeight;
      }
    }
    return payout;
  };

  const expectedValueAtOffset = (offH: number, offA: number): number => {
    let ev = 0;
    for (let dh = 0; dh <= MAX_ADD; dh++) {
      const wh = pH[dh];
      for (let da = 0; da <= MAX_ADD; da++) {
        ev += wh * pA[da] * evalScenarioPayout(offH, offA, dh, da);
      }
    }
    return ev;
  };

  const vStay = expectedValueAtOffset(0, 0);
  const vHomeGoal = expectedValueAtOffset(1, 0);
  const vAwayGoal = expectedValueAtOffset(0, 1);

  const deltaHome = vHomeGoal - vStay;
  const deltaAway = vAwayGoal - vStay;

  const refBank = Math.max(80, 160 * houseTightness);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  const hTilt = clamp(Math.exp(-0.34 * Math.tanh(deltaHome / refBank)), 0.76, 1.26);
  const aTilt = clamp(Math.exp(-0.34 * Math.tanh(deltaAway / refBank)), 0.76, 1.26);

  return { hTilt, aTilt };
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

  const houseHealth = hasAnyExposure
    ? await getGlobalHouseHealth()
    : { totalIn24h: 0, totalOut24h: 0, payoutRatio: 0.9, tightness: 1.0 };

  const activeUserIds: number[] = [];
  for (const b of sportTickets) activeUserIds.push(b.userId);
  for (const cb of comboTickets) activeUserIds.push(cb.userId);
  const userRiskMap =
    activeUserIds.length > 0
      ? await computeUserPatternRiskWeights(activeUserIds)
      : new Map<number, number>();

  const betsByMatch = new Map<number, PendingMatchTicket[]>();
  for (const b of sportTickets) {
    const arr = betsByMatch.get(b.matchId) ?? [];
    arr.push({
      market: b.market,
      selection: b.selection,
      stake: b.stake,
      odds: b.odds,
      riskWeight: userRiskMap.get(b.userId) ?? 1.0,
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
      riskWeight: userRiskMap.get(cb.userId) ?? 1.0,
    });
    betsByMatch.set(cb.matchId, arr);
  }

  const pressureFor = (m: MatchRow): MatchBookPressure =>
    m.source === "virtual"
      ? {
          tickets: betsByMatch.get(m.id) ?? [],
          houseTightness: houseHealth.tightness,
        }
      : { tickets: [], houseTightness: 1 };

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

  // 4. Rattrapage multi-canaux (« Time-Continuum » à 4 pistes parallèles)
  if (activeLives.length < CONCURRENT_LIVE_VIRTUAL && upcomingMatches.length > 0) {
    const virtualOrdered = upcomingMatches
      .filter((m) => m.source === "virtual")
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id - b.id);

    const laneReadyMs: number[] = Array.from({ length: CONCURRENT_LIVE_VIRTUAL }, (_, idx) =>
      idx < activeLives.length
        ? expectedMatchEndMs(activeLives[idx], now) + INTER_MATCH_GAP_MS
        : lastCompletedEndMs > 0
          ? lastCompletedEndMs + INTER_MATCH_GAP_MS
          : 0
    );

    const pickFreeLane = (): number => {
      let best = -1;
      for (let i = 0; i < laneReadyMs.length; i++) {
        if (laneReadyMs[i] <= now && (best === -1 || laneReadyMs[i] < laneReadyMs[best])) {
          best = i;
        }
      }
      return best;
    };

    for (const vm of virtualOrdered) {
      if (activeLives.length >= CONCURRENT_LIVE_VIRTUAL) break;
      const laneIdx = pickFreeLane();
      if (laneIdx === -1) break;

      const cursor = laneReadyMs[laneIdx];
      const effStartMs = cursor > 0 ? Math.max(vm.startsAt.getTime(), cursor) : vm.startsAt.getTime();
      if (effStartMs > now) continue;

      const uIdx = upcomingMatches.findIndex((u) => u.id === vm.id);
      if (uIdx >= 0) upcomingMatches.splice(uIdx, 1);

      const stepped = kickOffInMemory(vm, effStartMs, now, pressureFor(vm));
      recordStepResult(vm, stepped);
      if (stepped.finished) {
        const dur = matchDurationMs(vm.id, "virtual");
        laneReadyMs[laneIdx] = effStartMs + dur + INTER_MATCH_GAP_MS;
      } else {
        activeLives.push(stepped.row);
        laneReadyMs[laneIdx] = expectedMatchEndMs(stepped.row, now) + INTER_MATCH_GAP_MS;
      }
    }

    // Promotion douce avec décalage automatique des phases pour éviter que plusieurs matchs partent à 1' ensemble
    if (activeLives.length < CONCURRENT_LIVE_VIRTUAL) {
      const remainingQueued = upcomingMatches
        .filter((m) => m.source === "virtual")
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id - b.id);

      const candidateFracs = [0, 0.24, 0.48, 0.70];
      const occupiedFracs = activeLives.map((lm) => {
        const dur = Math.max(1, matchDurationMs(lm.id, "virtual"));
        return Math.max(0, Math.min(0.95, (now - lm.startsAt.getTime()) / dur));
      });

      const pickStaggerFrac = (hasBets: boolean): number => {
        if (hasBets || occupiedFracs.length >= CONCURRENT_LIVE_VIRTUAL - 1 && occupiedFracs.every((f) => f >= 0.14)) {
          occupiedFracs.push(0);
          return 0;
        }
        let bestFrac = 0;
        let bestMinDist = -1;
        for (const cf of candidateFracs) {
          const minDist =
            occupiedFracs.length === 0
              ? 1
              : Math.min(...occupiedFracs.map((of) => Math.abs(cf - of)));
          if (minDist > bestMinDist) {
            bestMinDist = minDist;
            bestFrac = cf;
          }
        }
        occupiedFracs.push(bestFrac);
        return bestFrac;
      };

      for (const nextVm of remainingQueued) {
        if (activeLives.length >= CONCURRENT_LIVE_VIRTUAL) break;
        const uIdx = upcomingMatches.findIndex((u) => u.id === nextVm.id);
        if (uIdx >= 0) upcomingMatches.splice(uIdx, 1);

        const hasBets = (betsByMatch.get(nextVm.id)?.length ?? 0) > 0;
        const frac = pickStaggerFrac(hasBets);
        const dur = matchDurationMs(nextVm.id, "virtual");
        const startMs = now - Math.round(dur * frac);

        const stepped = kickOffInMemory(nextVm, startMs, now, pressureFor(nextVm));
        recordStepResult(nextVm, stepped);
        if (!stepped.finished) {
          activeLives.push(stepped.row);
        }
      }
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

  // 5. Pont de continuité après une longue absence (ex. plusieurs heures sans visiteur)
  if (activeLives.length < CONCURRENT_LIVE_VIRTUAL && upcomingMatches.filter((m) => m.source === "virtual").length === 0) {
    const bridged = await bridgeIdleGapAndStartLives(
      now,
      lastCompletedEndMs,
      CONCURRENT_LIVE_VIRTUAL - activeLives.length
    );
    activeLives = [...activeLives, ...bridged];
  }

  // 6. Regarnit la file virtuelle si nécessaire et aligne les coups d'envoi sur les 4 canaux
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

  // Planification sur `CONCURRENT_LIVE_VIRTUAL` canaux parallèles : chaque match à venir
  // prend exactement le créneau du prochain match live qui va se terminer.
  const laneCursors: number[] = Array.from({ length: CONCURRENT_LIVE_VIRTUAL }, (_, idx) =>
    idx < activeLives.length
      ? expectedMatchEndMs(activeLives[idx], now) + INTER_MATCH_GAP_MS
      : now + INTER_MATCH_GAP_MS + idx * 75_000
  );

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

  const patches: QueuedMatchPatch[] = [];
  const ramUpdatedQueue: MatchRow[] = [];

  for (const m of virtualQueue) {
    let minLane = 0;
    for (let i = 1; i < laneCursors.length; i++) {
      if (laneCursors[i] < laneCursors[minLane]) minLane = i;
    }
    const desiredStartsAt = laneCursors[minLane];
    laneCursors[minLane] += matchDurationMs(m.id, "virtual") + INTER_MATCH_GAP_MS;

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

      // Persiste en base uniquement en cas d'inversion d'affiche ou de dérive horaire > 60 s
      if (swapped || driftMs > 60_000) {
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
      WHERE m."id" = v.id
    `);
  }
}

async function ensureActiveSchedule(now: number): Promise<MatchRow[]> {
  await ensureMatchStoreHydrated();
  const activeVirtual = getCachedActiveVirtualMatches();

  if (activeVirtual.length >= MIN_ACTIVE_VIRTUAL - 2) return activeVirtual;

  const busyTeams = new Set<string>();
  let tailEndMs = now;
  let netHomeStronger = 0;

  for (const m of activeVirtual) {
    busyTeams.add(m.homeTeam);
    busyTeams.add(m.awayTeam);
    const diff = teamStrength(m.homeTeam) - teamStrength(m.awayTeam);
    if (diff >= 1) netHomeStronger++;
    else if (diff <= -1) netHomeStronger--;
    const estEnd =
      m.status === "live"
        ? expectedMatchEndMs(m, now)
        : m.startsAt.getTime() + matchDurationMs(m.id, "virtual");
    if (estEnd > tailEndMs) {
      tailEndMs = estEnd;
    }
  }

  const waveSlot = Math.floor(now / 300_000);
  const waveOffset = hmacUint32(`wave-offset|${waveSlot}`) % FIXTURE_POOL.length;
  const stepStride = 7; // premier avec 36 (PGCD(7, 36) = 1) → parcourt tout le pool sans cycle court
  const needed = TARGET_ACTIVE_VIRTUAL - activeVirtual.length;
  const chosen: FixtureTemplate[] = [];

  for (let i = 0; i < FIXTURE_POOL.length && chosen.length < needed; i++) {
    const raw = FIXTURE_POOL[(waveOffset + i * stepStride) % FIXTURE_POOL.length];
    if (busyTeams.has(raw.home) || busyTeams.has(raw.away)) continue;
    busyTeams.add(raw.home);
    busyTeams.add(raw.away);
    const oriented = orientFixtureBalanced(raw, `${waveSlot}|${i}`, netHomeStronger);
    const diff = teamStrength(oriented.home) - teamStrength(oriented.away);
    if (diff >= 1) netHomeStronger++;
    else if (diff <= -1) netHomeStronger--;
    chosen.push(oriented);
  }

  const laneTails: number[] = Array.from(
    { length: CONCURRENT_LIVE_VIRTUAL },
    (_, laneIdx) => (activeVirtual.length > 0 ? tailEndMs + INTER_MATCH_GAP_MS : now + laneIdx * 75_000)
  );
  const rows: Array<typeof matches.$inferInsert> = [];

  chosen.forEach((fx, idx) => {
    const rng = createServerRng(`sched-v4|${waveSlot}|${fx.home}|${fx.away}|${idx}`);
    const regime = MATCH_REGIMES[Math.floor(rng() * MATCH_REGIMES.length)];
    // Forme du jour symétrique centrée sur 1.00 (aucun biais directionnel)
    const homeForm = Math.round((0.91 + rng() * 0.18) * 100) / 100;
    const awayForm = Math.round((0.91 + rng() * 0.18) * 100) / 100;

    let minLane = 0;
    for (let l = 1; l < laneTails.length; l++) {
      if (laneTails[l] < laneTails[minLane]) minLane = l;
    }
    const startsAt = new Date(laneTails[minLane]);
    laneTails[minLane] += matchDurationMs(idx + 1, "virtual") + INTER_MATCH_GAP_MS;

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
    const insertedRows = await db.insert(matches).values(rows).returning();
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
 * Après une absence prolongée où tous les anciens matchs programmés ont déjà fini,
 * reconstruit en un seul lot SQL la fenêtre récente (2 matchs récemment terminés + jusqu'à 4 matchs
 * en direct déjà étalés à différentes minutes de jeu) pour un multiplex vivant 24h/24.
 */
async function bridgeIdleGapAndStartLives(
  now: number,
  lastCompletedEndMs: number,
  neededLives = CONCURRENT_LIVE_VIRTUAL
): Promise<MatchRow[]> {
  const targetCount = Math.max(1, Math.min(CONCURRENT_LIVE_VIRTUAL, neededLives));
  const [recentFin] = await db
    .select({ finishedAt: matches.finishedAt })
    .from(matches)
    .where(and(eq(matches.status, "finished"), eq(matches.source, "virtual")))
    .orderBy(desc(matches.finishedAt))
    .limit(1);

  const latestEnd = Math.max(
    lastCompletedEndMs,
    recentFin?.finishedAt ? recentFin.finishedAt.getTime() : 0
  );

  const openNow = await db
    .select({ homeTeam: matches.homeTeam, awayTeam: matches.awayTeam })
    .from(matches)
    .where(and(inArray(matches.status, ["upcoming", "live"]), eq(matches.source, "virtual")));
  const busy = new Set<string>();
  for (const r of openNow) {
    busy.add(r.homeTeam);
    busy.add(r.awayTeam);
  }

  const slot = Math.floor(now / 300_000);
  const offset = hmacUint32(`bridge-offset|${slot}`) % FIXTURE_POOL.length;
  const needPast = now - latestEnd > 10 * 60_000 ? 2 : 0;
  const totalPick = needPast + targetCount;
  const picked: FixtureTemplate[] = [];
  let bridgeNetHome = 0;

  for (let i = 0; i < FIXTURE_POOL.length && picked.length < totalPick; i++) {
    const raw = FIXTURE_POOL[(offset + i * 7) % FIXTURE_POOL.length];
    if (busy.has(raw.home) || busy.has(raw.away)) continue;
    busy.add(raw.home);
    busy.add(raw.away);
    const oriented = orientFixtureBalanced(raw, `bridge|${slot}|${i}`, bridgeNetHome);
    const d = teamStrength(oriented.home) - teamStrength(oriented.away);
    if (d >= 1) bridgeNetHome++;
    else if (d <= -1) bridgeNetHome--;
    picked.push(oriented);
  }
  if (picked.length === 0) return [];

  const avgDur = 300_000;
  const neutralPressure: MatchBookPressure = { tickets: [], houseTightness: 1 };
  const pastCount = picked.length > targetCount ? needPast : 0;
  const pastFx = picked.slice(0, pastCount);
  const liveFxList = picked.slice(pastCount);

  // Phases décalées naturelles (~14', ~34', ~54', ~73') pour que les 4 directs vivent à des rythmes distincts
  const baseShift = ((hmacUint32(`idle-live-frac|${slot}`) % 12) - 6) / 100;
  const staggerFracs = [0.15, 0.37, 0.58, 0.76].map((f) =>
    Math.max(0.08, Math.min(0.82, f + baseShift))
  );

  const insertBatch: Array<typeof matches.$inferInsert> = [];

  pastFx.forEach((fx, i) => {
    const rng = createServerRng(`bridge-past-v5|${slot}|${i}`);
    const regime = MATCH_REGIMES[Math.floor(rng() * MATCH_REGIMES.length)];
    const homeForm = Math.round((0.91 + rng() * 0.18) * 100) / 100;
    const awayForm = Math.round((0.91 + rng() * 0.18) * 100) / 100;
    const preOdds = oddsFor(fx.home, fx.away, { homeForm, awayForm, league: fx.league });
    const approxStart = now - (pastFx.length - i + 1) * avgDur;
    insertBatch.push({
      sport: "football",
      league: fx.league,
      homeTeam: fx.home,
      awayTeam: fx.away,
      homeLogo: teamLogo(fx.home),
      awayLogo: teamLogo(fx.away),
      homeScore: 0,
      awayScore: 0,
      status: "live",
      minute: "1'",
      startsAt: new Date(approxStart),
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

  liveFxList.forEach((fx, idx) => {
    const rng = createServerRng(`bridge-live-v5|${slot}|${fx.home}|${fx.away}|${idx}`);
    const regime = MATCH_REGIMES[Math.floor(rng() * MATCH_REGIMES.length)];
    const homeForm = Math.round((0.91 + rng() * 0.18) * 100) / 100;
    const awayForm = Math.round((0.91 + rng() * 0.18) * 100) / 100;
    const preOdds = oddsFor(fx.home, fx.away, { homeForm, awayForm, league: fx.league });
    const frac = staggerFracs[idx % staggerFracs.length];
    const approxLiveStart = now - Math.round(avgDur * frac);
    insertBatch.push({
      sport: "football",
      league: fx.league,
      homeTeam: fx.home,
      awayTeam: fx.away,
      homeLogo: teamLogo(fx.home),
      awayLogo: teamLogo(fx.away),
      homeScore: 0,
      awayScore: 0,
      status: "live",
      minute: "1’",
      startsAt: new Date(approxLiveStart),
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

  if (insertBatch.length === 0) return [];
  const insertedAll = await db.insert(matches).values(insertBatch).returning();
  const isLockedMode = (await getScenarioMode()) === "locked";

  if (isLockedMode && insertedAll.length > 0) {
    const lockTuples = insertedAll.map((ins) => {
      const sim = simulateMatchRange(ins, 0, 90, 0, 0, 0, 0, [], neutralPressure, false);
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

  const dirtyRows: MatchRow[] = [];
  const finishedRows: MatchRow[] = [];
  const liveOut: MatchRow[] = [];

  const insertedPast = insertedAll.slice(0, pastFx.length);
  const insertedLives = insertedAll.slice(pastFx.length);

  let backCursor = now - Math.round(avgDur * 0.80) - INTER_MATCH_GAP_MS;
  for (let i = insertedPast.length - 1; i >= 0; i--) {
    const ins = insertedPast[i];
    const exactDur = matchDurationMs(ins.id, "virtual");
    const exactStart = backCursor - exactDur;
    const stepped = kickOffInMemory(ins, exactStart, now, neutralPressure);
    dirtyRows.push(stepped.row);
    if (stepped.finished) finishedRows.push(stepped.row);
    backCursor = exactStart - INTER_MATCH_GAP_MS;
  }

  insertedLives.forEach((ins, idx) => {
    const exactDur = matchDurationMs(ins.id, "virtual");
    const frac = staggerFracs[idx % staggerFracs.length];
    const safeStart = Math.max(now - Math.round(exactDur * 0.82), now - Math.round(exactDur * frac));
    const stepped = kickOffInMemory(ins, safeStart, now, neutralPressure);
    dirtyRows.push(stepped.row);
    if (stepped.finished) {
      finishedRows.push(stepped.row);
    } else {
      liveOut.push(stepped.row);
    }
  });

  await flushMatchUpdatesBatch(dirtyRows, finishedRows, now);
  upsertCachedMatches(dirtyRows);
  return liveOut;
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
  // passe à la cadence de 5 minutes : on réancre `startsAt` sur `prevSimMin`.
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
export function hydrateLiveMatchRow(match: MatchRow, nowMs = Date.now()): MatchRow {
  const cached = getCachedMatchById(match.id);
  const base = cached ?? match;
  if (base.source === "manual" || base.status !== "live") {
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
    if (raw.source === "manual" || raw.status !== "live") {
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

