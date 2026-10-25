import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { settleMatchBets } from "@/lib/settle";
import { appUser, bets, matches, type MatchRow } from "@/db/schema";
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

/** Suspension brève du marché après un but (~2,2 s adaptée au rythme 2–3 min). */
const GOAL_SUSPEND_MS = 2_200;
const TICK_THROTTLE_MS = 900;

/**
 * Rythme des matchs :
 * - Matchs virtuels automatiques (`source = "virtual"`) : durée totale entre 2m08s et 2m52s
 *   (95 pas d'horloge × [1 350 ms .. 1 810 ms], moyenne ~2 min 30 s).
 * - Matchs manuels créés par l'admin (`source = "manual"`) : rythme réel confortable (40 s / min)
 *   pour laisser le pilotage complet à l'administrateur.
 */
export const MANUAL_MINUTE_REAL_MS = 40_000;
export const VIRTUAL_STEP_MIN_MS = 1_350; // ~2 min 08 s au total
export const VIRTUAL_STEP_MAX_MS = 1_810; // ~2 min 52 s au total
const TOTAL_CLOCK_STEPS = 95;

const MIN_ACTIVE_VIRTUAL = 7;
const TARGET_ACTIVE_VIRTUAL = 10;

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

function computeClockState(startsAtMs: number, now: number, stepMs: number): ClockState {
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

  // Asymétrie domicile vs extérieur : bornée entre 0.74 et 1.24 pour rester 100 % réaliste
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

  // Charge en une seule requête les paris actifs sur les matchs ouverts (zéro N+1)
  const openIds = openMatches.map((m) => m.id);
  const [pendingBets, houseHealth] = await Promise.all([
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

  for (const m of openMatches) {
    const matchBets = betsByMatch.get(m.id) ?? [];
    const pressure =
      m.source === "virtual"
        ? computeBookPressure(matchBets, houseHealth.tightness)
        : { homeTilt: 1, awayTilt: 1, tempoTilt: 1 };

    if (m.status === "upcoming") {
      if (now >= m.startsAt.getTime()) {
        await kickOffAndSimulateMatch(m, now, pressure);
      } else if (!m.markets || m.markets.length === 0) {
        const freshOdds = oddsFor(m.homeTeam, m.awayTeam, {
          homeForm: m.homeForm ?? 1,
          awayForm: m.awayForm ?? 1,
          redHome: m.redHome ?? 0,
          redAway: m.redAway ?? 0,
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
      continue;
    }

    if (m.status === "live") {
      await tickLiveMatch(m, now, pressure);
    }
  }
}

async function ensureActiveSchedule(now: number): Promise<void> {
  const activeVirtual = await db
    .select()
    .from(matches)
    .where(and(eq(matches.source, "virtual"), inArray(matches.status, ["upcoming", "live"])));

  if (activeVirtual.length >= MIN_ACTIVE_VIRTUAL) return;

  const busyTeams = new Set<string>();
  let latestStartsAt = now;
  let liveCount = 0;

  for (const m of activeVirtual) {
    busyTeams.add(m.homeTeam);
    busyTeams.add(m.awayTeam);
    if (m.status === "live") liveCount++;
    if (m.startsAt.getTime() > latestStartsAt) {
      latestStartsAt = m.startsAt.getTime();
    }
  }

  // Rotation rapide basée sur des cycles de 3 minutes pour varier les affiches en continu
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

  // Cadence dynamique : nouveaux coups d'envoi toutes les ~40 secondes
  let upcomingCursor = Math.max(now + 30_000, latestStartsAt + 40_000);
  const rows: Array<typeof matches.$inferInsert> = [];

  chosen.forEach((fx, idx) => {
    const startLive = liveCount < 3;
    const rng = mulberry32(hashString(`sched|${Math.floor(now / 60_000)}|${fx.home}|${fx.away}|${idx}`));
    const regime = MATCH_REGIMES[Math.floor(rng() * MATCH_REGIMES.length)];
    const homeForm = Math.round((0.9 + rng() * 0.22) * 100) / 100;
    const awayForm = Math.round((0.9 + rng() * 0.22) * 100) / 100;

    let startsAt: Date;
    if (startLive) {
      const presetMinutes = [16, 41, 63];
      const liveMinute = presetMinutes[liveCount % presetMinutes.length];
      startsAt = backdateStartsAtForMinute(liveMinute, now, "virtual", idx + 1);
      liveCount++;
    } else {
      startsAt = new Date(upcomingCursor);
      upcomingCursor += 40_000;
    }

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

async function kickOffAndSimulateMatch(
  m: MatchRow,
  now: number,
  pressure: MatchBookPressure
): Promise<void> {
  const stepMs = stepMsForMatch(m.id, m.source);
  const maxMatchMs = (TOTAL_CLOCK_STEPS + 3) * stepMs;
  const effectiveStartsAt =
    now - m.startsAt.getTime() > maxMatchMs ? new Date(now) : m.startsAt;

  const liveDraft: MatchRow = {
    ...m,
    status: "live",
    homeScore: m.homeScore ?? 0,
    awayScore: m.awayScore ?? 0,
    minute: "1'",
    startsAt: effectiveStartsAt,
    homeLogo: teamLogo(m.homeTeam) || m.homeLogo,
    awayLogo: teamLogo(m.awayTeam) || m.awayLogo,
  };

  await tickLiveMatch(liveDraft, now, pressure, true);
}

async function tickLiveMatch(
  m: MatchRow,
  now: number,
  pressure: MatchBookPressure,
  forceWrite = false
): Promise<void> {
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
  // Seule l'horloge avance doucement et les cotes live s'ajustent au temps restant.
  const simulateEvents = m.source === "virtual";

  if (simulateEvents && targetSimMin > prevSimMin) {
    for (let min = prevSimMin + 1; min <= targetSimMin; min++) {
      const share = minuteGoalShare(min);
      const reg = regimeFactors(m.regime, min, lambdaHome, lambdaAway);

      // Dynamique psychologique en cours de match : l'équipe menée pousse en fin de match
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

  if (dynamicOdds.oddsHome !== m.oddsHome) {
    tickHistory.push({
      minute: targetSimMin,
      market: "result",
      selection: "home",
      from: m.oddsHome,
      to: dynamicOdds.oddsHome,
    });
  }
  if (dynamicOdds.oddsDraw !== m.oddsDraw && m.oddsDraw != null) {
    tickHistory.push({
      minute: targetSimMin,
      market: "result",
      selection: "draw",
      from: m.oddsDraw,
      to: dynamicOdds.oddsDraw,
    });
  }
  if (dynamicOdds.oddsAway !== m.oddsAway) {
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
  // Pour un match manuel, on respecte la suspension manuelle éventuelle de l'admin
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

  if (!changed) return;

  await db
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
      ...(isOver ? { finishedAt: new Date(now) } : {}),
    })
    .where(eq(matches.id, m.id));

  if (isOver) {
    await settleMatchBets(m.id);
  }
}
