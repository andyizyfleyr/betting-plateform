import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { settleMatchBets } from "@/lib/settle";
import { appUser, matches, type MatchRow } from "@/db/schema";
import {
  expectedGoals,
  hashString,
  liveOddsFor,
  minuteGoalShare,
  mulberry32,
  oddsFor,
  pickScorerName,
} from "@/db/fixtures";
import { minuteNumber } from "@/lib/markets";
import { teamLogo } from "@/lib/team-logos";

/** Suspension temporaire du marché après un but (3,5 s comme en conditions réelles). */
const GOAL_SUSPEND_MS = 3_500;
const TICK_THROTTLE_MS = 1_500;

/** 1 minute de match = 35 s réelles (~55 min réelles par match complet avec mi-temps). */
export const MANUAL_MINUTE_REAL_MS = 35_000;

const MIN_ACTIVE_MATCHES = 6;
const TARGET_ACTIVE_MATCHES = 10;

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

/**
 * Calcule une heure de coup d'envoi cohérente avec une minute de jeu cible
 * (en tenant compte du temps additionnel 1re MT + pause mi-temps).
 */
export function backdateStartsAtForMinute(targetMinute: number, now = Date.now()): Date {
  const m = Math.max(1, Math.min(90, Math.floor(targetMinute)));
  const step = m <= 45 ? m : m + 3;
  return new Date(now - (step - 1) * MANUAL_MINUTE_REAL_MS);
}

interface ClockState {
  minuteLabel: string;
  gameMinute: number;
  phase: "1H" | "1H_STOPPAGE" | "HT" | "2H" | "2H_STOPPAGE" | "FT";
}

function computeClockState(startsAtMs: number, now: number): ClockState {
  const elapsedMs = Math.max(0, now - startsAtMs);
  const step = Math.floor(elapsedMs / MANUAL_MINUTE_REAL_MS) + 1;

  if (step <= 45) return { minuteLabel: `${step}'`, gameMinute: step, phase: "1H" };
  if (step === 46) return { minuteLabel: "45+2'", gameMinute: 45, phase: "1H_STOPPAGE" };
  if (step === 47 || step === 48) return { minuteLabel: "MT", gameMinute: 45, phase: "HT" };
  if (step <= 93) {
    const gm = step - 3;
    return { minuteLabel: `${gm}'`, gameMinute: gm, phase: "2H" };
  }
  if (step === 94) return { minuteLabel: "90+2'", gameMinute: 90, phase: "2H_STOPPAGE" };
  if (step === 95) return { minuteLabel: "90+3'", gameMinute: 90, phase: "2H_STOPPAGE" };
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
    .where(and(eq(matches.source, "manual"), inArray(matches.status, ["upcoming", "live"])));

  for (const m of openMatches) {
    if (m.status === "upcoming") {
      if (now >= m.startsAt.getTime()) {
        await kickOffAndSimulateMatch(m, now);
      } else if (!m.markets || m.markets.length === 0) {
        // Met à jour les cotes avant-match et logos officiels si nécessaires
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
      await tickLiveManualMatch(m, now);
    }
  }
}

async function ensureActiveSchedule(now: number): Promise<void> {
  const active = await db
    .select()
    .from(matches)
    .where(and(eq(matches.source, "manual"), inArray(matches.status, ["upcoming", "live"])));

  if (active.length >= MIN_ACTIVE_MATCHES) return;

  const busyTeams = new Set<string>();
  let latestStartsAt = now;
  let liveCount = 0;

  for (const m of active) {
    busyTeams.add(m.homeTeam);
    busyTeams.add(m.awayTeam);
    if (m.status === "live") liveCount++;
    if (m.startsAt.getTime() > latestStartsAt) {
      latestStartsAt = m.startsAt.getTime();
    }
  }

  const waveOffset = Math.floor(now / (2 * 3_600_000)) % FIXTURE_POOL.length;
  const needed = TARGET_ACTIVE_MATCHES - active.length;
  const chosen: FixtureTemplate[] = [];

  for (let i = 0; i < FIXTURE_POOL.length && chosen.length < needed; i++) {
    const candidate = FIXTURE_POOL[(waveOffset + i) % FIXTURE_POOL.length];
    if (busyTeams.has(candidate.home) || busyTeams.has(candidate.away)) continue;
    busyTeams.add(candidate.home);
    busyTeams.add(candidate.away);
    chosen.push(candidate);
  }

  let upcomingCursor = Math.max(now + 10 * 60_000, latestStartsAt + 16 * 60_000);
  const rows: Array<typeof matches.$inferInsert> = [];

  for (const fx of chosen) {
    const startLive = liveCount < 2;
    let startsAt: Date;

    if (startLive) {
      const liveMinute = liveCount === 0 ? 23 : 59;
      startsAt = backdateStartsAtForMinute(liveMinute, now);
      liveCount++;
    } else {
      startsAt = new Date(upcomingCursor);
      upcomingCursor += 20 * 60_000;
    }

    const preOdds = oddsFor(fx.home, fx.away);
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
      regime: "balanced",
      homeForm: 1,
      awayForm: 1,
      markets: null,
      source: "manual",
    });
  }

  if (rows.length > 0) {
    await db.insert(matches).values(rows);
  }
}

async function kickOffAndSimulateMatch(m: MatchRow, now: number): Promise<void> {
  const maxMatchMs = 98 * MANUAL_MINUTE_REAL_MS;
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

  await tickLiveManualMatch(liveDraft, now, true);
}

async function tickLiveManualMatch(m: MatchRow, now: number, forceWrite = false): Promise<void> {
  const clock = computeClockState(m.startsAt.getTime(), now);
  const isOver = clock.phase === "FT";

  let home = m.homeScore ?? 0;
  let away = m.awayScore ?? 0;
  let redHome = m.redHome ?? 0;
  let redAway = m.redAway ?? 0;
  const events = Array.isArray(m.events) ? m.events.map((e) => ({ ...e })) : [];
  const tickHistory = Array.isArray(m.tickHistory) ? [...m.tickHistory] : [];

  // Dernière minute déjà simulée (via le marqueur d'horloge dans tickHistory)
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

  if (targetSimMin > prevSimMin) {
    for (let min = prevSimMin + 1; min <= targetSimMin; min++) {
      const share = minuteGoalShare(min);
      const rateH =
        lambdaHome *
        (m.homeForm ?? 1) *
        share *
        Math.pow(0.68, redHome) *
        (1 + 0.18 * redAway);
      const rateA =
        lambdaAway *
        (m.awayForm ?? 1) *
        share *
        Math.pow(0.68, redAway) *
        (1 + 0.18 * redHome);

      const rng = mulberry32(hashString(`live-sim-v2|${m.id}|${min}`));
      const uHome = rng();
      const uAway = rng();
      const scorerSeed = Math.floor(rng() * 100_000);
      const uRed = rng();
      const uRedSide = rng();

      if (uHome < 1 - Math.exp(-rateH) && home < 8) {
        home += 1;
        const player = pickScorerName(m.homeTeam, scorerSeed);
        events.push({
          type: "goal",
          team: "home",
          minute: min,
          ...(player ? { player } : {}),
        });
        if (min === targetSimMin && targetSimMin - prevSimMin <= 2) {
          justScoredNow = true;
        }
      }

      if (uAway < 1 - Math.exp(-rateA) && away < 8) {
        away += 1;
        const player = pickScorerName(m.awayTeam, scorerSeed + 31);
        events.push({
          type: "goal",
          team: "away",
          minute: min,
          ...(player ? { player } : {}),
        });
        if (min === targetSimMin && targetSimMin - prevSimMin <= 2) {
          justScoredNow = true;
        }
      }

      if (min >= 18 && redHome + redAway < 2 && uRed < 0.0017) {
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
  // Garde l'historique borné pour éviter toute surcharge JSONB
  const trimmedHistory = tickHistory.slice(-24);

  const lastGoalDate = justScoredNow ? new Date(now) : m.lastGoalAt;
  const recentGoal = lastGoalDate != null && now - lastGoalDate.getTime() < GOAL_SUSPEND_MS;
  // Marché suspendu brièvement après un but ou dans le temps additionnel final (90+'), jamais bloqué dès la 88'
  const isFinalStoppage = clock.phase === "2H_STOPPAGE";
  const suspended = isOver ? false : recentGoal || isFinalStoppage;

  // Si l'admin a défini des marchés personnalisés, synchronise quand même le 1/N/2
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
      minute: isOver ? null : clock.minuteLabel,
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
