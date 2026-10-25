import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { settleMatchBets } from "@/lib/settle";
import { appUser, bets, comboBets, matches, type MatchRow } from "@/db/schema";
import {
  expectedGoals,
  hashString,
  liveOddsFor,
  minuteGoalShare,
  mulberry32,
  oddsFor,
  pickScorerName,
} from "@/db/fixtures";
import { getGlobalHouseHealth } from "@/lib/house-brain";
import { minuteNumber } from "@/lib/markets";
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
  "late_drama",
] as const;

interface FixtureTemplate {
  league: string;
  home: string;
  away: string;
}

const FIXTURE_POOL: FixtureTemplate[] = [
  { league: "Ligue 1", home: "Paris SG", away: "Marseille" },
  { league: "Premier League", home: "Arsenal", away: "Chelsea" },
  { league: "Ligue des Champions", home: "Real Madrid", away: "Bayern Munich" },
  { league: "Premier League", home: "Liverpool", away: "Manchester City" },
  { league: "Liga", home: "FC Barcelone", away: "Atlético Madrid" },
  { league: "Serie A", home: "Inter Milan", away: "Juventus" },
  { league: "Bundesliga", home: "Leverkusen", away: "Dortmund" },
  { league: "Ligue 1", home: "Monaco", away: "Lyon" },
  { league: "Serie A", home: "AC Milan", away: "Naples" },
  { league: "Liga", home: "Real Betis", away: "Villarreal" },
  { league: "Premier League", home: "Newcastle", away: "Aston Villa" },
  { league: "Ligue 1", home: "Lille", away: "Nice" },
  { league: "Ligue des Champions", home: "Paris SG", away: "Inter Milan" },
  { league: "Premier League", home: "Tottenham", away: "Manchester United" },
  { league: "Bundesliga", home: "Bayern Munich", away: "RB Leipzig" },
  { league: "Serie A", home: "Atalanta", away: "AS Rome" },
  { league: "Liga", home: "Athletic Bilbao", away: "Real Sociedad" },
  { league: "Ligue 1", home: "Lens", away: "Rennes" },
  { league: "Ligue des Champions", home: "FC Barcelone", away: "Liverpool" },
  { league: "Premier League", home: "Brighton", away: "Bournemouth" },
  { league: "Bundesliga", home: "Stuttgart", away: "Eintracht Francfort" },
  { league: "Serie A", home: "Latium", away: "Fiorentina" },
  { league: "Ligue 1", home: "Strasbourg", away: "Toulouse" },
  { league: "Liga", home: "FC Séville", away: "Valence" },
];

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

interface MatchBookPressure {
  homeTilt: number; // < 1 freine légèrement domicile si forte exposition dessus
  awayTilt: number; // < 1 freine légèrement extérieur si forte exposition dessus
  tempoTilt: number; // < 1 resserre les buts si sur-exposition sur Over / BTTS Oui
}

function computeBookPressure(
  pendingOnMatch: Array<{ market: string; selection: string; stake: number; odds: number }>,
  houseTightness: number
): MatchBookPressure {
  if (pendingOnMatch.length === 0) {
    return { homeTilt: 1, awayTilt: 1, tempoTilt: 1 };
  }

  let liabHome = 0;
  let liabDraw = 0;
  let liabAway = 0;
  let liabHighGoals = 0;
  let liabLowGoals = 0;

  for (const b of pendingOnMatch) {
    const netProfit = b.stake * Math.max(0.1, b.odds - 1);
    if (b.market === "result") {
      if (b.selection === "home") liabHome += netProfit;
      else if (b.selection === "draw") liabDraw += netProfit;
      else if (b.selection === "away") liabAway += netProfit;
    } else if (b.market === "double_chance") {
      if (b.selection === "1X") {
        liabHome += netProfit * 0.6;
        liabDraw += netProfit * 0.4;
      } else if (b.selection === "X2") {
        liabAway += netProfit * 0.6;
        liabDraw += netProfit * 0.4;
      } else if (b.selection === "12") {
        liabHome += netProfit * 0.5;
        liabAway += netProfit * 0.5;
      }
    } else if (b.market === "total_ou" || b.market === "home_total" || b.market === "away_total") {
      if (b.selection.endsWith("_over")) liabHighGoals += netProfit;
      else if (b.selection.endsWith("_under")) liabLowGoals += netProfit;
    } else if (b.market === "btts") {
      if (b.selection === "oui") liabHighGoals += netProfit * 0.85;
      else liabLowGoals += netProfit * 0.85;
    }
  }

  const refBank = 120 * Math.max(0.75, houseTightness);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  // Asymétrie domicile vs extérieur : bornée entre 0.75 et 1.22 pour rester 100 % réaliste
  const netSide = (liabHome - liabAway) / refBank;
  let homeTilt = clamp(1 - 0.18 * Math.tanh(netSide), 0.75, 1.22);
  let awayTilt = clamp(1 + 0.18 * Math.tanh(netSide), 0.75, 1.22);

  // Si forte exposition sur 1 ET 2 mais peu sur Nul, léger resserrement vers un match disputé
  if (liabHome + liabAway > liabDraw * 2.5 + 40) {
    homeTilt *= 0.94;
    awayTilt *= 0.94;
  }

  const netGoals = (liabHighGoals - liabLowGoals) / refBank;
  const tempoTilt = clamp(1 - 0.2 * Math.tanh(netGoals), 0.74, 1.22);

  return { homeTilt, awayTilt, tempoTilt };
}

function regimeFactors(
  regime: string | null | undefined,
  minute: number,
  lambdaHome: number,
  lambdaAway: number
): { hMult: number; aMult: number } {
  const homeIsFav = lambdaHome >= lambdaAway;
  switch (regime) {
    case "tactical_lock":
      return { hMult: 0.82, aMult: 0.82 };
    case "high_tempo":
      return { hMult: 1.16, aMult: 1.18 };
    case "underdog_ambush":
      return homeIsFav ? { hMult: 0.86, aMult: 1.26 } : { hMult: 1.26, aMult: 0.86 };
    case "late_drama":
      return minute >= 68 ? { hMult: 1.34, aMult: 1.38 } : { hMult: 0.86, aMult: 0.86 };
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
        stake: comboBets.stake,
        baseOdds: comboBets.baseOdds,
        legs: comboBets.legs,
      })
      .from(comboBets)
      .where(eq(comboBets.status, "pending")),
    getGlobalHouseHealth(),
  ]);

  const betsByMatch = new Map<
    number,
    Array<{ market: string; selection: string; stake: number; odds: number }>
  >();
  for (const b of pendingBets) {
    if (b.matchId == null) continue;
    const arr = betsByMatch.get(b.matchId) ?? [];
    arr.push(b);
    betsByMatch.set(b.matchId, arr);
  }
  // Intègre aussi l'exposition des combinés en cours sur chaque match ouvert
  for (const cb of pendingCombos) {
    for (const leg of cb.legs ?? []) {
      if (leg.kind !== "sport" || !leg.matchId || leg.status !== "pending") continue;
      if (!openIdSet.has(leg.matchId)) continue;
      const arr = betsByMatch.get(leg.matchId) ?? [];
      const effectiveOdds = Math.min(
        25,
        leg.odds * Math.pow(Math.max(1, cb.baseOdds / Math.max(1.01, leg.odds)), 0.3)
      );
      arr.push({
        market: leg.market,
        selection: leg.selection,
        stake: cb.stake,
        odds: effectiveOdds,
      });
      betsByMatch.set(leg.matchId, arr);
    }
  }

  const pressureFor = (m: MatchRow): MatchBookPressure =>
    m.source === "virtual"
      ? computeBookPressure(betsByMatch.get(m.id) ?? [], houseHealth.tightness)
      : { homeTilt: 1, awayTilt: 1, tempoTilt: 1 };

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
    await syncUpcomingQueue(refreshedUpcoming, activeLive, now);
  } else {
    await syncUpcomingQueue(upcomingMatches, activeLive, now);
  }
}

async function syncUpcomingQueue(
  upcomingMatches: MatchRow[],
  activeLive: MatchRow | null,
  now: number
): Promise<void> {
  const virtualQueue = upcomingMatches
    .filter((m) => m.source === "virtual")
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id - b.id);

  let cursorMs = activeLive
    ? expectedMatchEndMs(activeLive, now) + INTER_MATCH_GAP_MS
    : now + INTER_MATCH_GAP_MS;

  for (const m of virtualQueue) {
    const desiredStartsAt = cursorMs;
    cursorMs += matchDurationMs(m.id, "virtual") + INTER_MATCH_GAP_MS;

    const freshOdds = oddsFor(m.homeTeam, m.awayTeam, {
      homeForm: m.homeForm ?? 1,
      awayForm: m.awayForm ?? 1,
      redHome: m.redHome ?? 0,
      redAway: m.redAway ?? 0,
    });
    const homeLogo = teamLogo(m.homeTeam) || m.homeLogo;
    const awayLogo = teamLogo(m.awayTeam) || m.awayLogo;

    const driftMs = Math.abs(m.startsAt.getTime() - desiredStartsAt);
    const oddsChanged =
      Math.abs(m.oddsHome - freshOdds.oddsHome) > 0.02 ||
      Math.abs((m.oddsDraw ?? 0) - freshOdds.oddsDraw) > 0.02 ||
      Math.abs(m.oddsAway - freshOdds.oddsAway) > 0.02;

    if (driftMs > 6_000 || oddsChanged || homeLogo !== m.homeLogo || awayLogo !== m.awayLogo) {
      await db
        .update(matches)
        .set({
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

  for (const m of openAll) {
    busyTeams.add(m.homeTeam);
    busyTeams.add(m.awayTeam);
    const estEnd =
      m.status === "live"
        ? expectedMatchEndMs(m, now)
        : m.startsAt.getTime() + matchDurationMs(m.id, m.source);
    if (estEnd > tailEndMs) {
      tailEndMs = estEnd;
    }
  }

  const waveOffset = Math.floor(now / 180_000) % FIXTURE_POOL.length;
  const needed = TARGET_ACTIVE_VIRTUAL - activeVirtual.length;
  const chosen: FixtureTemplate[] = [];

  for (let i = 0; i < FIXTURE_POOL.length && chosen.length < needed; i++) {
    const candidate = FIXTURE_POOL[(waveOffset + i * 5) % FIXTURE_POOL.length];
    if (busyTeams.has(candidate.home) || busyTeams.has(candidate.away)) continue;
    busyTeams.add(candidate.home);
    busyTeams.add(candidate.away);
    chosen.push(candidate);
  }

  const hasAnyOpen = openAll.length > 0;
  let upcomingCursor = hasAnyOpen ? tailEndMs + INTER_MATCH_GAP_MS : now;
  const rows: Array<typeof matches.$inferInsert> = [];

  chosen.forEach((fx, idx) => {
    const rng = mulberry32(hashString(`sched|${Math.floor(now / 60_000)}|${fx.home}|${fx.away}|${idx}`));
    const regime = MATCH_REGIMES[Math.floor(rng() * MATCH_REGIMES.length)];
    const homeForm = Math.round((0.92 + rng() * 0.18) * 100) / 100;
    const awayForm = Math.round((0.92 + rng() * 0.18) * 100) / 100;

    // Tous les nouveaux matchs sont insérés en "upcoming" l'un derrière l'autre ;
    // `executeTick` démarre immédiatement et uniquement le premier si aucun match n'est en live.
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
    await db.insert(matches).values(rows);
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
  const picked: FixtureTemplate[] = [];
  for (let i = 0; i < FIXTURE_POOL.length && picked.length < 3; i++) {
    const fx = FIXTURE_POOL[(slot + i * 7) % FIXTURE_POOL.length];
    if (busy.has(fx.home) || busy.has(fx.away)) continue;
    busy.add(fx.home);
    busy.add(fx.away);
    picked.push(fx);
  }
  if (picked.length === 0) return null;

  const avgDur = 160_000;
  // Détermine une minute de jeu naturelle (entre ~16' et ~72') pour le match actuellement en direct
  const liveFrac = 0.18 + ((hashString(`idle-live-frac|${slot}`) % 55) / 100);
  const targetLiveStart =
    now - latestEnd > 6 * 60_000
      ? now - Math.round(avgDur * liveFrac)
      : Math.min(now, Math.max(now - 20_000, latestEnd + INTER_MATCH_GAP_MS));

  // Si un long silence (> 6 min) s'est écoulé, génère 2 matchs récemment terminés juste avant le live
  if (now - latestEnd > 6 * 60_000 && picked.length >= 3) {
    let backCursor = targetLiveStart - INTER_MATCH_GAP_MS;
    const pastFixtures = [picked[0], picked[1]];
    for (let i = pastFixtures.length - 1; i >= 0; i--) {
      const fx = pastFixtures[i];
      const rng = mulberry32(hashString(`bridge-past|${slot}|${i}`));
      const regime = MATCH_REGIMES[Math.floor(rng() * MATCH_REGIMES.length)];
      const homeForm = Math.round((0.92 + rng() * 0.18) * 100) / 100;
      const awayForm = Math.round((0.92 + rng() * 0.18) * 100) / 100;
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
        await kickOffAtSchedule(
          inserted,
          exactStart,
          now,
          { homeTilt: 1, awayTilt: 1, tempoTilt: 1 }
        );
        backCursor = exactStart - INTER_MATCH_GAP_MS;
      }
    }
  }

  const liveFx = picked[picked.length - 1];
  const rng = mulberry32(hashString(`bridge-live|${slot}|${liveFx.home}`));
  const regime = MATCH_REGIMES[Math.floor(rng() * MATCH_REGIMES.length)];
  const homeForm = Math.round((0.92 + rng() * 0.18) * 100) / 100;
  const awayForm = Math.round((0.92 + rng() * 0.18) * 100) / 100;
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

  // Garantit que targetLiveStart reste bien dans la fenêtre active du match inséré
  const exactDur = matchDurationMs(liveInserted.id, "virtual");
  const safeLiveStart = Math.max(now - Math.round(exactDur * 0.82), targetLiveStart);
  return kickOffAtSchedule(
    liveInserted,
    safeLiveStart,
    now,
    { homeTilt: 1, awayTilt: 1, tempoTilt: 1 }
  );
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
  const { lambdaHome, lambdaAway } = expectedGoals(m.homeTeam, m.awayTeam);
  let justScoredNow = false;

  // Sur un match manuel créé par l'admin, le score n'évolue que sur action de l'admin !
  const simulateEvents = m.source === "virtual";

  if (simulateEvents && targetSimMin > prevSimMin) {
    for (let min = prevSimMin + 1; min <= targetSimMin; min++) {
      const share = minuteGoalShare(min);
      const reg = regimeFactors(m.regime, min, lambdaHome, lambdaAway);

      const scoreDiff = home - away;
      const chaseH = min >= 62 && scoreDiff === -1 ? 1.15 : scoreDiff >= 2 ? 0.86 : 1;
      const chaseA = min >= 62 && scoreDiff === 1 ? 1.15 : scoreDiff <= -2 ? 0.86 : 1;

      const rateH =
        lambdaHome *
        (m.homeForm ?? 1) *
        reg.hMult *
        chaseH *
        pressure.homeTilt *
        pressure.tempoTilt *
        share *
        Math.pow(0.68, redHome) *
        (1 + 0.18 * redAway);
      const rateA =
        lambdaAway *
        (m.awayForm ?? 1) *
        reg.aMult *
        chaseA *
        pressure.awayTilt *
        pressure.tempoTilt *
        share *
        Math.pow(0.68, redAway) *
        (1 + 0.18 * redHome);

      const rng = mulberry32(hashString(`live-sim-v3|${m.id}|${m.startsAt.getTime()}|${min}`));
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
        if (min >= targetSimMin - 1 && targetSimMin - prevSimMin <= 4) {
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
        if (min >= targetSimMin - 1 && targetSimMin - prevSimMin <= 4) {
          justScoredNow = true;
        }
      }

      if (min >= 18 && redHome + redAway < 2 && uRed < 0.0019) {
        const side = uRedSide < 0.48 ? "home" : "away";
        if (side === "home") redHome += 1;
        else redAway += 1;
        events.push({ type: "red_card", team: side, minute: min });
      }
    }
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
  const isFinalStoppage = clock.phase === "2H_STOPPAGE";
  const suspended = isOver
    ? false
    : m.source === "manual"
      ? Boolean(m.suspended) || recentGoal
      : recentGoal || isFinalStoppage;

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
    await settleMatchBets(m.id);
  }

  return { finished: isOver, row: updated ?? m };
}
