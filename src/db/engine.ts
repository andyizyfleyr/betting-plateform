import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { settleMatchBets } from "@/lib/settle";
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
import { isKnownMarket, marketWin, minuteNumber } from "@/lib/markets";
import { ensureMlLoaded, recordMatchFinishedMl } from "@/lib/ml-engine";
import { createServerRng, hmacUint32 } from "@/lib/server-rng";
import { teamLogo } from "@/lib/team-logos";

/** Suspension brève du marché après un but (~2,2 s). */
const GOAL_SUSPEND_MS = 2_200;
const TICK_THROTTLE_MS = 1_000;
/** Transition courte entre la fin d'un match et le coup d'envoi planifié du suivant. */
const INTER_MATCH_GAP_MS = 3_000;

/**
 * Rythme des matchs :
 * - Matchs virtuels automatiques (`source = "virtual"`) : durée totale entre 2m24s et 2m55s
 *   (95 pas d'horloge × [1 520 ms .. 1 840 ms], moyenne ~2 min 40 s), UN SEUL match en live
 *   à la fois, à tour de rôle.
 * - Matchs manuels créés par l'admin (`source = "manual"`) : rythme réel confortable (40 s / min)
 *   pour laisser le pilotage complet à l'administrateur.
 */
export const MANUAL_MINUTE_REAL_MS = 40_000;
export const VIRTUAL_STEP_MIN_MS = 1_520; // ~2 min 24 s au total
export const VIRTUAL_STEP_MAX_MS = 1_840; // ~2 min 55 s au total
const TOTAL_CLOCK_STEPS = 95;

const MIN_ACTIVE_VIRTUAL = 7;
const TARGET_ACTIVE_VIRTUAL = 8;

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

  if (step <= 45) return { minuteLabel: `${step}'`, gameMinute: step, phase: "1H" };
  if (step === 46) return { minuteLabel: "45+2'", gameMinute: 45, phase: "1H_STOPPAGE" };
  if (step === 47 || step === 48) return { minuteLabel: "MT", gameMinute: 45, phase: "HT" };
  if (step <= 93) {
    const gm = step - 3;
    return { minuteLabel: `${gm}'`, gameMinute: gm, phase: "2H" };
  }
  if (step === 94) return { minuteLabel: "90+2'", gameMinute: 90, phase: "2H_STOPPAGE" };
  if (step === TOTAL_CLOCK_STEPS) return { minuteLabel: "90+3'", gameMinute: 90, phase: "2H_STOPPAGE" };
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
 * Utilisé par l'API Admin lorsqu'un match est lancé ou rouvert manuellement en direct :
 * garantit que tous les autres matchs en direct cèdent la place et repassent en file d'attente.
 */
export async function demoteOtherLiveMatches(keepMatchId: number, now = Date.now()): Promise<void> {
  const [keepMatch] = await db.select().from(matches).where(eq(matches.id, keepMatchId));
  const others = await db
    .select()
    .from(matches)
    .where(and(eq(matches.status, "live"), ne(matches.id, keepMatchId)));

  if (others.length === 0) return;

  let cursorMs = keepMatch
    ? expectedMatchEndMs(keepMatch, now) + INTER_MATCH_GAP_MS
    : now + 160_000;

  for (const extra of others) {
    await demoteLiveMatchToUpcoming(extra, new Date(cursorMs));
    cursorMs += matchDurationMs(extra.id, extra.source) + INTER_MATCH_GAP_MS;
  }
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
  baseLambdaA: number
): { hTilt: number; aTilt: number } {
  const { tickets, houseTightness } = pressure;
  if (tickets.length === 0) {
    return { hTilt: 1, aTilt: 1 };
  }

  const remShare = Math.max(0.02, 1 - goalTimeCDF(minute));
  const remH = Math.max(0.02, baseLambdaH * remShare);
  const remA = Math.max(0.02, baseLambdaA * remShare);

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

  // Table des paiements pondérés pour les scores finaux atteignables [home..home+5][away..away+5]
  const span = MAX_ADD + 2;
  const payGrid: number[][] = Array.from({ length: span }, () => new Array<number>(span).fill(0));
  for (let dh = 0; dh < span; dh++) {
    for (let da = 0; da < span; da++) {
      const fh = home + dh;
      const fa = away + da;
      let payout = 0;
      for (const t of tickets) {
        let won = false;
        if (isKnownMarket(t.market)) {
          won = marketWin(t.market, t.selection, fh, fa);
        } else if (t.market === "result") {
          won = t.selection === "home" ? fh > fa : t.selection === "away" ? fa > fh : fh === fa;
        }
        if (won) {
          payout += t.stake * t.odds * t.riskWeight;
        }
      }
      payGrid[dh][da] = payout;
    }
  }

  const expectedValueAtOffset = (offH: number, offA: number): number => {
    let ev = 0;
    for (let dh = 0; dh <= MAX_ADD; dh++) {
      const wh = pH[dh];
      for (let da = 0; da <= MAX_ADD; da++) {
        ev += wh * pA[da] * payGrid[offH + dh][offA + da];
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

async function executeTick(now: number): Promise<void> {
  const [user] = await db
    .select({ liveSim: appUser.liveSim })
    .from(appUser)
    .where(eq(appUser.id, 1));
  if (user && !user.liveSim) return;

  await ensureMlLoaded();
  await ensureActiveSchedule(now);

  const openMatches = await db
    .select()
    .from(matches)
    .where(inArray(matches.status, ["upcoming", "live"]));

  if (openMatches.length === 0) return;

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

  const activeUserIds: number[] = [];
  for (const b of pendingBets) activeUserIds.push(b.userId);
  for (const cb of pendingCombos) activeUserIds.push(cb.userId);
  const userRiskMap = await computeUserPatternRiskWeights(activeUserIds);

  const betsByMatch = new Map<number, PendingMatchTicket[]>();
  for (const b of pendingBets) {
    if (b.matchId == null) continue;
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
  // Intègre aussi l'exposition des combinés en cours sur chaque match ouvert
  for (const cb of pendingCombos) {
    const uWeight = userRiskMap.get(cb.userId) ?? 1.0;
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

  // 1. Clôture d'abord tout match live dont le temps réglementaire est déjà écoulé
  const stillLive: MatchRow[] = [];
  for (const m of liveMatches) {
    const dur = matchDurationMs(m.id, m.source);
    const clock = computeClockState(m.startsAt.getTime(), now, stepMsForMatch(m.id, m.source));
    if (clock.phase === "FT") {
      await tickLiveMatch(m, now, pressureFor(m));
      lastCompletedEndMs = Math.max(lastCompletedEndMs, m.startsAt.getTime() + dur);
    } else {
      stillLive.push(m);
    }
  }

  // 2. Garantit STRICTEMENT UN SEUL match en live : les éventuels doublons repassent en file d'attente
  let activeLive: MatchRow | null = null;
  if (stillLive.length > 0) {
    stillLive.sort((a, b) => {
      if (a.source !== b.source) return a.source === "manual" ? -1 : 1;
      const betsDiff = (betsByMatch.get(b.id)?.length ?? 0) - (betsByMatch.get(a.id)?.length ?? 0);
      if (betsDiff !== 0) return betsDiff;
      return a.startsAt.getTime() - b.startsAt.getTime() || a.id - b.id;
    });

    activeLive = stillLive[0];
    if (stillLive.length > 1) {
      let deferCursor = expectedMatchEndMs(activeLive, now) + INTER_MATCH_GAP_MS;
      for (const extra of stillLive.slice(1)) {
        const demoted = await demoteLiveMatchToUpcoming(extra, new Date(deferCursor));
        upcomingMatches.push(demoted);
        deferCursor += matchDurationMs(extra.id, extra.source) + INTER_MATCH_GAP_MS;
      }
    }
  }

  // 3. Fait avancer l'unique match en live (s'il existe)
  if (activeLive) {
    const dur = matchDurationMs(activeLive.id, activeLive.source);
    const res = await tickLiveMatch(activeLive, now, pressureFor(activeLive));
    if (res.finished) {
      lastCompletedEndMs = Math.max(lastCompletedEndMs, activeLive.startsAt.getTime() + dur);
      activeLive = null;
    } else {
      activeLive = res.row;
    }
  }

  // 4. Rattrapage séquentiel (« Time-Continuum ») de la file d'attente même avec 0 visiteur :
  //    tous les matchs dont le créneau est passé se déroulent à tour de rôle et règlent leurs paris,
  //    et celui dont le créneau couvre `now` est repris exactement à sa minute de jeu réelle.
  if (!activeLive && upcomingMatches.length > 0) {
    // 4a. Matchs manuels arrivés à échéance
    const dueManuals = upcomingMatches
      .filter((m) => m.source === "manual" && m.startsAt.getTime() <= now)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id - b.id);

    for (const mm of dueManuals) {
      const idx = upcomingMatches.findIndex((u) => u.id === mm.id);
      if (idx >= 0) upcomingMatches.splice(idx, 1);
      const liveOrDone = await kickOffAtSchedule(mm, mm.startsAt.getTime(), now, pressureFor(mm));
      if (liveOrDone) {
        activeLive = liveOrDone;
        break;
      }
      lastCompletedEndMs = Math.max(
        lastCompletedEndMs,
        mm.startsAt.getTime() + matchDurationMs(mm.id, "manual")
      );
    }

    // 4b. File séquentielle des matchs virtuels
    if (!activeLive) {
      const virtualOrdered = upcomingMatches
        .filter((m) => m.source === "virtual")
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id - b.id);

      let seqCursor = lastCompletedEndMs > 0 ? lastCompletedEndMs + INTER_MATCH_GAP_MS : 0;

      for (const vm of virtualOrdered) {
        const effStartMs =
          seqCursor > 0 ? Math.max(vm.startsAt.getTime(), seqCursor) : vm.startsAt.getTime();

        if (effStartMs > now) {
          break;
        }

        const idx = upcomingMatches.findIndex((u) => u.id === vm.id);
        if (idx >= 0) upcomingMatches.splice(idx, 1);

        const liveOrDone = await kickOffAtSchedule(vm, effStartMs, now, pressureFor(vm));
        if (liveOrDone) {
          activeLive = liveOrDone;
          break;
        }

        const dur = matchDurationMs(vm.id, "virtual");
        lastCompletedEndMs = Math.max(lastCompletedEndMs, effStartMs + dur);
        seqCursor = lastCompletedEndMs + INTER_MATCH_GAP_MS;
      }

      // Si le match live vient tout juste de se terminer et que la file virtuelle contient déjà
      // le prochain match programmé dans quelques secondes, passe-lui immédiatement le témoin
      // au lieu d'insérer un match intercalaire.
      if (!activeLive) {
        const nextQueuedVirtual = upcomingMatches
          .filter((m) => m.source === "virtual")
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id - b.id)[0];

        if (nextQueuedVirtual) {
          const idx = upcomingMatches.findIndex((u) => u.id === nextQueuedVirtual.id);
          if (idx >= 0) upcomingMatches.splice(idx, 1);
          activeLive = await kickOffAtSchedule(
            nextQueuedVirtual,
            now,
            now,
            pressureFor(nextQueuedVirtual)
          );
        }
      }
    }
  }

  // 5. Pont de continuité après une longue absence (ex. plusieurs heures sans visiteur) :
  //    toute l'ancienne file a été jouée et réglée ; on génère les derniers résultats récents
  //    + 1 match déjà en cours à sa minute naturelle pour qu'il n'y ait jamais d'effet « réveil à 1' ».
  if (!activeLive) {
    activeLive = await bridgeIdleGapAndStartLive(now, lastCompletedEndMs);
  }

  // 6. Regarnit la file d'attente si le rattrapage a consommé des matchs, puis aligne les coups d'envoi
  if (upcomingMatches.filter((m) => m.source === "virtual").length < MIN_ACTIVE_VIRTUAL) {
    await ensureActiveSchedule(now);
    const refreshedUpcoming = await db
      .select()
      .from(matches)
      .where(eq(matches.status, "upcoming"));
    await syncUpcomingQueue(refreshedUpcoming, activeLive, now, betsByMatch);
  } else {
    await syncUpcomingQueue(upcomingMatches, activeLive, now, betsByMatch);
  }
}

async function syncUpcomingQueue(
  upcomingMatches: MatchRow[],
  activeLive: MatchRow | null,
  now: number,
  betsByMatch: Map<number, PendingMatchTicket[]>
): Promise<void> {
  const virtualQueue = upcomingMatches
    .filter((m) => m.source === "virtual")
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id - b.id);

  // Rééquilibrage automatique sans couture : si plus de la moitié des matchs à venir
  // ont le club le plus fort à domicile (ex. ancienne file pré-mise à jour), inverse
  // Domicile / Extérieur sur les matchs sans pari en cours pour garantir une parité 50/50.
  let homeStrongCount = 0;
  let awayStrongCount = 0;
  for (const m of virtualQueue) {
    const diff = teamStrength(m.homeTeam) - teamStrength(m.awayTeam);
    if (diff >= 1) homeStrongCount++;
    else if (diff <= -1) awayStrongCount++;
  }

  let cursorMs = activeLive
    ? expectedMatchEndMs(activeLive, now) + INTER_MATCH_GAP_MS
    : now + INTER_MATCH_GAP_MS;

  for (const m of virtualQueue) {
    const desiredStartsAt = cursorMs;
    cursorMs += matchDurationMs(m.id, "virtual") + INTER_MATCH_GAP_MS;

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
      await db
        .update(matches)
        .set({
          homeTeam,
          awayTeam,
          homeForm,
          awayForm,
          startsAt: new Date(desiredStartsAt),
          oddsHome: freshOdds.oddsHome,
          oddsDraw: freshOdds.oddsDraw,
          oddsAway: freshOdds.oddsAway,
          homeLogo,
          awayLogo,
        })
        .where(eq(matches.id, m.id));
    }
  }

  // Matchs manuels à venir : conserve l'horaire choisi par l'admin
  const manualUpcoming = upcomingMatches.filter((m) => m.source === "manual");
  for (const m of manualUpcoming) {
    if (m.markets && m.markets.length > 0) continue;
    const freshOdds = oddsFor(m.homeTeam, m.awayTeam, {
      homeForm: m.homeForm ?? 1,
      awayForm: m.awayForm ?? 1,
    });
    const homeLogo = teamLogo(m.homeTeam) || m.homeLogo;
    const awayLogo = teamLogo(m.awayTeam) || m.awayLogo;
    if (
      Math.abs(m.oddsHome - freshOdds.oddsHome) > 0.02 ||
      Math.abs((m.oddsDraw ?? 0) - freshOdds.oddsDraw) > 0.02 ||
      Math.abs(m.oddsAway - freshOdds.oddsAway) > 0.02 ||
      homeLogo !== m.homeLogo ||
      awayLogo !== m.awayLogo
    ) {
      await db
        .update(matches)
        .set({
          oddsHome: freshOdds.oddsHome,
          oddsDraw: freshOdds.oddsDraw,
          oddsAway: freshOdds.oddsAway,
          homeLogo,
          awayLogo,
        })
        .where(eq(matches.id, m.id));
    }
  }
}

async function ensureActiveSchedule(now: number): Promise<void> {
  const openAll = await db
    .select()
    .from(matches)
    .where(inArray(matches.status, ["upcoming", "live"]));

  const activeVirtual = openAll.filter((m) => m.source === "virtual");
  if (activeVirtual.length >= MIN_ACTIVE_VIRTUAL) return;

  const busyTeams = new Set<string>();
  let tailEndMs = now;
  let netHomeStronger = 0;

  for (const m of openAll) {
    busyTeams.add(m.homeTeam);
    busyTeams.add(m.awayTeam);
    if (m.source === "virtual") {
      const diff = teamStrength(m.homeTeam) - teamStrength(m.awayTeam);
      if (diff >= 1) netHomeStronger++;
      else if (diff <= -1) netHomeStronger--;
    }
    const estEnd =
      m.status === "live"
        ? expectedMatchEndMs(m, now)
        : m.startsAt.getTime() + matchDurationMs(m.id, m.source);
    if (estEnd > tailEndMs) {
      tailEndMs = estEnd;
    }
  }

  const waveSlot = Math.floor(now / 150_000);
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

  const hasAnyOpen = openAll.length > 0;
  let upcomingCursor = hasAnyOpen ? tailEndMs + INTER_MATCH_GAP_MS : now;
  const rows: Array<typeof matches.$inferInsert> = [];

  chosen.forEach((fx, idx) => {
    const rng = createServerRng(`sched-v4|${waveSlot}|${fx.home}|${fx.away}|${idx}`);
    const regime = MATCH_REGIMES[Math.floor(rng() * MATCH_REGIMES.length)];
    // Forme du jour symétrique centrée sur 1.00 (aucun biais directionnel)
    const homeForm = Math.round((0.91 + rng() * 0.18) * 100) / 100;
    const awayForm = Math.round((0.91 + rng() * 0.18) * 100) / 100;

    const startsAt = new Date(upcomingCursor);
    upcomingCursor += matchDurationMs(idx + 1, "virtual") + INTER_MATCH_GAP_MS;

    const preOdds = oddsFor(fx.home, fx.away, { homeForm, awayForm });
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
    if (mode === "locked") {
      const neutral: MatchBookPressure = { tickets: [], houseTightness: 1 };
      for (const ins of insertedRows) {
        const sim = simulateMatchRange(ins, 0, 90, 0, 0, 0, 0, [], neutral, false);
        await db
          .update(matches)
          .set({ scenarioLocked: true, scriptedEvents: sim.events })
          .where(eq(matches.id, ins.id));
      }
    }
  }
}

async function kickOffAtSchedule(
  m: MatchRow,
  scheduledStartsAtMs: number,
  now: number,
  pressure: MatchBookPressure
): Promise<MatchRow | null> {
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

  const res = await tickLiveMatch(liveDraft, now, pressure, true);
  return res.finished ? null : res.row;
}

/**
 * Après une absence prolongée où tous les anciens matchs programmés ont déjà fini,
 * reconstruit sans couture la fenêtre récente (2 matchs récemment terminés + 1 match
 * en direct déjà au cœur de l'action) pour que le site paraisse habité 24h/24.
 */
async function bridgeIdleGapAndStartLive(
  now: number,
  lastCompletedEndMs: number
): Promise<MatchRow | null> {
  const [recentFin] = await db
    .select({ finishedAt: matches.finishedAt })
    .from(matches)
    .where(eq(matches.status, "finished"))
    .orderBy(desc(matches.finishedAt))
    .limit(1);

  const latestEnd = Math.max(
    lastCompletedEndMs,
    recentFin?.finishedAt ? recentFin.finishedAt.getTime() : 0
  );

  const openNow = await db
    .select({ homeTeam: matches.homeTeam, awayTeam: matches.awayTeam })
    .from(matches)
    .where(inArray(matches.status, ["upcoming", "live"]));
  const busy = new Set<string>();
  for (const r of openNow) {
    busy.add(r.homeTeam);
    busy.add(r.awayTeam);
  }

  const slot = Math.floor(now / 150_000);
  const offset = hmacUint32(`bridge-offset|${slot}`) % FIXTURE_POOL.length;
  const picked: FixtureTemplate[] = [];
  let bridgeNetHome = 0;
  for (let i = 0; i < FIXTURE_POOL.length && picked.length < 3; i++) {
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
  if (picked.length === 0) return null;

  const avgDur = 160_000;
  // Détermine une minute de jeu naturelle (entre ~16' et ~72') pour le match actuellement en direct
  const liveFrac = 0.18 + ((hmacUint32(`idle-live-frac|${slot}`) % 55) / 100);
  const targetLiveStart =
    now - latestEnd > 6 * 60_000
      ? now - Math.round(avgDur * liveFrac)
      : Math.min(now, Math.max(now - 20_000, latestEnd + INTER_MATCH_GAP_MS));

  const neutralPressure: MatchBookPressure = { tickets: [], houseTightness: 1 };

  // Si un long silence (> 6 min) s'est écoulé, génère 2 matchs récemment terminés juste avant le live
  if (now - latestEnd > 6 * 60_000 && picked.length >= 3) {
    let backCursor = targetLiveStart - INTER_MATCH_GAP_MS;
    const pastFixtures = [picked[0], picked[1]];
    for (let i = pastFixtures.length - 1; i >= 0; i--) {
      const fx = pastFixtures[i];
      const rng = createServerRng(`bridge-past-v4|${slot}|${i}`);
      const regime = MATCH_REGIMES[Math.floor(rng() * MATCH_REGIMES.length)];
      const homeForm = Math.round((0.91 + rng() * 0.18) * 100) / 100;
      const awayForm = Math.round((0.91 + rng() * 0.18) * 100) / 100;
      const preOdds = oddsFor(fx.home, fx.away, { homeForm, awayForm });
      const approxStart = backCursor - avgDur;

      const [inserted] = await db
        .insert(matches)
        .values({
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
        })
        .returning();

      if (inserted) {
        const exactDur = matchDurationMs(inserted.id, "virtual");
        const exactStart = backCursor - exactDur;
        await kickOffAtSchedule(inserted, exactStart, now, neutralPressure);
        backCursor = exactStart - INTER_MATCH_GAP_MS;
      }
    }
  }

  const liveFx = picked[picked.length - 1];
  const rng = createServerRng(`bridge-live-v4|${slot}|${liveFx.home}|${liveFx.away}`);
  const regime = MATCH_REGIMES[Math.floor(rng() * MATCH_REGIMES.length)];
  const homeForm = Math.round((0.91 + rng() * 0.18) * 100) / 100;
  const awayForm = Math.round((0.91 + rng() * 0.18) * 100) / 100;
  const preOdds = oddsFor(liveFx.home, liveFx.away, { homeForm, awayForm });

  const [liveInserted] = await db
    .insert(matches)
    .values({
      sport: "football",
      league: liveFx.league,
      homeTeam: liveFx.home,
      awayTeam: liveFx.away,
      homeLogo: teamLogo(liveFx.home),
      awayLogo: teamLogo(liveFx.away),
      homeScore: 0,
      awayScore: 0,
      status: "live",
      minute: "1'",
      startsAt: new Date(targetLiveStart),
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
    })
    .returning();

  if (!liveInserted) return null;

  let readyLive = liveInserted;
  if ((await getScenarioMode()) === "locked") {
    const sim = simulateMatchRange(liveInserted, 0, 90, 0, 0, 0, 0, [], neutralPressure, false);
    const [lockedRow] = await db
      .update(matches)
      .set({ scenarioLocked: true, scriptedEvents: sim.events })
      .where(eq(matches.id, liveInserted.id))
      .returning();
    if (lockedRow) readyLive = lockedRow;
  }

  // Garantit que targetLiveStart reste bien dans la fenêtre active du match inséré
  const exactDur = matchDurationMs(readyLive.id, "virtual");
  const safeLiveStart = Math.max(now - Math.round(exactDur * 0.82), targetLiveStart);
  return kickOffAtSchedule(readyLive, safeLiveStart, now, neutralPressure);
}

/**
 * Fait progresser un match live et retourne `{ finished, row }`.
 */
async function tickLiveMatch(
  m: MatchRow,
  now: number,
  pressure: MatchBookPressure,
  forceWrite = false
): Promise<{ finished: boolean; row: MatchRow }> {
  const stepMs = stepMsForMatch(m.id, m.source);
  const clock = computeClockState(m.startsAt.getTime(), now, stepMs);
  const isOver = clock.phase === "FT";

  let home = m.homeScore ?? 0;
  let away = m.awayScore ?? 0;
  let redHome = m.redHome ?? 0;
  let redAway = m.redAway ?? 0;
  const events = Array.isArray(m.events) ? m.events.map((e) => ({ ...e })) : [];
  const tickHistory = Array.isArray(m.tickHistory) ? [...m.tickHistory] : [];

  const simEntries = tickHistory.filter((t) => t.market === "sim" && t.selection === "clock");
  let prevSimMin = 0;
  if (simEntries.length > 0) {
    prevSimMin = Math.max(...simEntries.map((t) => Math.round(t.to)));
  } else if (home > 0 || away > 0 || events.length > 0) {
    prevSimMin = minuteNumber(m.minute);
  }

  const targetSimMin = clock.gameMinute;
  let justScoredNow = false;

  const hasScripted = Boolean(m.scenarioLocked && Array.isArray(m.scriptedEvents));
  // Sur un match manuel créé par l'admin, le score n'évolue que sur action de l'admin (sauf scénario verrouillé) !
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

  const dynamicOdds = liveOddsFor(m.homeTeam, m.awayTeam, home, away, targetSimMin, {
    homeForm: m.homeForm ?? 1,
    awayForm: m.awayForm ?? 1,
    redHome,
    redAway,
  });

  if (Math.abs(dynamicOdds.oddsHome - m.oddsHome) >= 0.02) {
    tickHistory.push({
      minute: targetSimMin,
      market: "result",
      selection: "home",
      from: m.oddsHome,
      to: dynamicOdds.oddsHome,
    });
  }
  if (m.oddsDraw != null && Math.abs(dynamicOdds.oddsDraw - m.oddsDraw) >= 0.02) {
    tickHistory.push({
      minute: targetSimMin,
      market: "result",
      selection: "draw",
      from: m.oddsDraw,
      to: dynamicOdds.oddsDraw,
    });
  }
  if (Math.abs(dynamicOdds.oddsAway - m.oddsAway) >= 0.02) {
    tickHistory.push({
      minute: targetSimMin,
      market: "result",
      selection: "away",
      from: m.oddsAway,
      to: dynamicOdds.oddsAway,
    });
  }
  if (targetSimMin > prevSimMin) {
    tickHistory.push({
      minute: targetSimMin,
      market: "sim",
      selection: "clock",
      from: prevSimMin,
      to: targetSimMin,
    });
  }
  const trimmedHistory = tickHistory.slice(-24);

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

  const changed =
    forceWrite ||
    isOver ||
    m.minute !== clock.minuteLabel ||
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

  if (!changed) return { finished: isOver, row: m };

  const naturalEndMs = m.startsAt.getTime() + matchDurationMs(m.id, m.source);

  const [updated] = await db
    .update(matches)
    .set({
      homeScore: home,
      awayScore: away,
      redHome,
      redAway,
      events,
      minute: isOver ? "Terminé" : clock.minuteLabel,
      status: isOver ? "finished" : "live",
      oddsHome: dynamicOdds.oddsHome,
      oddsDraw: dynamicOdds.oddsDraw,
      oddsAway: dynamicOdds.oddsAway,
      lastGoalAt: lastGoalDate,
      suspended,
      tickHistory: trimmedHistory,
      markets: customMarkets,
      homeLogo,
      awayLogo,
      startsAt: m.startsAt,
      ...(isOver ? { finishedAt: new Date(Math.min(now, naturalEndMs)) } : {}),
    })
    .where(eq(matches.id, m.id))
    .returning();

  if (isOver) {
    try {
      await recordMatchFinishedMl({
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        homeScore: home,
        awayScore: away,
      });
    } catch (mlErr) {
      console.error("[ml online match update]", mlErr);
    }
    await settleMatchBets(m.id);
  }

  return { finished: isOver, row: updated ?? m };
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
  if (cachedScenarioMode && now - cachedScenarioMode.ts < 5_000) {
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

    const shield = computeDynamicStepTilts(pressure, home, away, min, baseEffH, baseEffA);

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
    if (m.source === "manual" && !m.scenarioLocked) continue;
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
    .where(inArray(matches.status, ["upcoming", "live"]));

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

  return nextMode;
}

export async function lockMatchScenario(matchId: number): Promise<AdminMatchForecast | null> {
  await ensureMlLoaded();
  const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!m || m.status === "finished") return null;

  const { forecasts } = await getAdminMatchForecasts([m]);
  const fc =
    forecasts[m.id] ?? buildForecastForRow(m, { tickets: [], houseTightness: 1 });

  await db
    .update(matches)
    .set({ scenarioLocked: true, scriptedEvents: fc.events })
    .where(eq(matches.id, matchId));

  return { ...fc, isLocked: true };
}

export async function unlockMatchScenario(matchId: number): Promise<void> {
  await db
    .update(matches)
    .set({ scenarioLocked: false, scriptedEvents: null })
    .where(eq(matches.id, matchId));
}

export async function rerollMatchScenario(matchId: number): Promise<AdminMatchForecast | null> {
  await ensureMlLoaded();
  const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!m || m.status === "finished") return null;

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
  if (!m || m.status === "finished") return null;

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
