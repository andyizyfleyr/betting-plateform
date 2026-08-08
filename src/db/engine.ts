import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser, bets, matches, simState, type MatchRow } from "@/db/schema";
import {
  ALL_PAIRS,
  ROUND_MS,
  VIRTUAL_LEAGUE,
  liveOddsFor,
  livePairIndex,
  oddsFor,
  roundIndexOf,
  scoreAt,
  asianHandicapLine,
} from "@/db/fixtures";

/** Index dans ALL_PAIRS (0-44) pour une affiche donnée. */
function pairIndex(home: string, away: string): number {
  return ALL_PAIRS.findIndex((p) => p.home === home && p.away === away);
}

/** Blocage du marché en temps réel : 3 s après un but (anti-triche, réouverture avec cotes ajustées). */
const GOAL_SUSPEND_MS = 3000;

/**
 * Tournoi virtuel : un match à la fois, 5 minutes par affiche (ROUND_MS).
 * Les 45 affiches défilent en séquence linéaire et repartent en boucle.
 * Scores déterministes tirés du modèle Poisson de fixtures.ts.
 */
export async function runLiveEngine() {
  await ensureSeeded();

  const [user] = await db
    .select({ liveSim: appUser.liveSim })
    .from(appUser)
    .where(eq(appUser.id, 1));
  if (user && !user.liveSim) return;

  const now = Date.now();

  const [state] = await db.select().from(simState).where(eq(simState.id, 1));
  if (!state) {
    await db.insert(simState).values({ id: 1, lastTick: new Date() });
    return;
  }

  const epoch = state.lastTick.getTime();
  const totalMatches = Math.max(0, Math.floor((now - epoch) / ROUND_MS));
  const liveIdx = livePairIndex(totalMatches);
  const matchStart = epoch + totalMatches * ROUND_MS;
  const elapsed = Math.min(now - matchStart, ROUND_MS);
  const isOver = elapsed >= ROUND_MS;
  const gameMinute = isOver ? 90 : Math.max(1, Math.floor((elapsed / ROUND_MS) * 90));

  const nextIdx = livePairIndex(totalMatches + 1);
  const livePair = ALL_PAIRS[liveIdx];
  const upcomingPair = ALL_PAIRS[nextIdx];

  const all = await db.select().from(matches).where(eq(matches.source, "virtual"));

  // 1) Clôture des anciens matchs « live » qui ne sont plus le match courant.
  for (const m of all) {
    if (m.status === "live" && !(m.homeTeam === livePair.home && m.awayTeam === livePair.away)) {
      await finishMatch(m);
    }
  }

  // 2) Coup d'envoi du match courant (promotion upcoming → live ou insertion).
  if (!isOver) {
    const existingLive = all.find(
      (m) => m.homeTeam === livePair.home && m.awayTeam === livePair.away && m.status !== "finished"
    );
    if (!existingLive) {
      const round = roundIndexOf(livePair.home, livePair.away);
      await insertMatch(livePair.home, livePair.away, "live", matchStart, round);
    } else if (existingLive.status === "upcoming") {
      const round = roundIndexOf(livePair.home, livePair.away);
      const s = scoreAt(round, 1, livePair.home, livePair.away);
      await db
        .update(matches)
        .set({
          status: "live",
          minute: "1'",
          homeScore: s.home,
          awayScore: s.away,
          startsAt: new Date(matchStart),
          lastGoalAt: s.home + s.away > 0 ? new Date() : null,
        })
        .where(eq(matches.id, existingLive.id));
    }
  }

  // 3) Mise à jour score / minute / cotes dynamiques / suspension du match live.
  const liveMatch = await db
    .select()
    .from(matches)
    .where(and(eq(matches.status, "live"), eq(matches.source, "virtual")))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (liveMatch) {
    const round = roundIndexOf(liveMatch.homeTeam, liveMatch.awayTeam);
    const score = scoreAt(round, gameMinute, liveMatch.homeTeam, liveMatch.awayTeam);
    const goalScored = score.home !== (liveMatch.homeScore ?? 0) || score.away !== (liveMatch.awayScore ?? 0);
    const homeGoalScored = score.home > (liveMatch.homeScore ?? 0);
    const awayGoalScored = score.away > (liveMatch.awayScore ?? 0);
    // Marché suspendu 3 s en temps réel après un but, puis réouverture avec des
    // cotes ajustées en faveur du meneur (comme sur les plateformes pro).
    const lastGoalAt = goalScored ? new Date() : (liveMatch.lastGoalAt ?? null);
    const recentGoal = lastGoalAt != null && now - lastGoalAt.getTime() < GOAL_SUSPEND_MS;
    const suspended = isOver || gameMinute >= 88 || recentGoal;
    const dynamicOdds = liveOddsFor(
      liveMatch.homeTeam,
      liveMatch.awayTeam,
      score.home,
      score.away,
      gameMinute,
      {
        homeForm: liveMatch.homeForm ?? 1,
        awayForm: liveMatch.awayForm ?? 1,
        redHome: liveMatch.redHome ?? 0,
        redAway: liveMatch.redAway ?? 0,
      }
    );

    // Build events array with new goals
    const events = [...(liveMatch.events ?? [])];
    if (homeGoalScored) {
      events.push({ type: "goal", team: "home", minute: gameMinute });
    }
    if (awayGoalScored) {
      events.push({ type: "goal", team: "away", minute: gameMinute });
    }

    // Build tickHistory with odds movements
    const tickHistory = [...(liveMatch.tickHistory ?? [])];
    if (dynamicOdds.oddsHome !== liveMatch.oddsHome) {
      tickHistory.push({
        minute: gameMinute,
        market: "result",
        selection: "home",
        from: liveMatch.oddsHome,
        to: dynamicOdds.oddsHome,
      });
    }
    if (dynamicOdds.oddsDraw !== liveMatch.oddsDraw && liveMatch.oddsDraw != null) {
      tickHistory.push({
        minute: gameMinute,
        market: "result",
        selection: "draw",
        from: liveMatch.oddsDraw,
        to: dynamicOdds.oddsDraw,
      });
    }
    if (dynamicOdds.oddsAway !== liveMatch.oddsAway) {
      tickHistory.push({
        minute: gameMinute,
        market: "result",
        selection: "away",
        from: liveMatch.oddsAway,
        to: dynamicOdds.oddsAway,
      });
    }

    // Simple regime calculation based on total goals rate
    const totalGoals = score.home + score.away;
    const expectedRate = gameMinute > 0 ? (totalGoals / gameMinute) * 90 : 0;
    let regime = liveMatch.regime ?? "balanced";
    if (expectedRate > 3.2) regime = "open";
    else if (expectedRate < 1.8) regime = "closed";

    // Recalculate Asian handicap line live
    const handicapLine = asianHandicapLine(liveMatch.homeTeam, liveMatch.awayTeam, {
      homeForm: liveMatch.homeForm ?? 1,
      awayForm: liveMatch.awayForm ?? 1,
      redHome: liveMatch.redHome ?? 0,
      redAway: liveMatch.redAway ?? 0,
    });

    await db
      .update(matches)
      .set({
        homeScore: score.home,
        awayScore: score.away,
        minute: isOver ? "Terminé" : `${gameMinute}'`,
        status: isOver ? "finished" : "live",
        oddsHome: dynamicOdds.oddsHome,
        oddsDraw: dynamicOdds.oddsDraw,
        oddsAway: dynamicOdds.oddsAway,
        lastGoalAt,
        suspended,
        events,
        tickHistory,
        regime,
        asianHandicapLine: handicapLine,
        ...(isOver ? { finishedAt: new Date() } : {}),
      })
      .where(eq(matches.id, liveMatch.id));
  }

  // 4) Maintenir une fenêtre de 6 matchs « upcoming ».
  const activeKeys = new Set<string>();
  activeKeys.add(`${livePair.home}|${livePair.away}`);

  for (let i = 1; i <= 6; i++) {
    const nextIdx = livePairIndex(totalMatches + i);
    const p = ALL_PAIRS[nextIdx];
    const key = `${p.home}|${p.away}`;
    activeKeys.add(key);
    const upcomingStart = matchStart + i * ROUND_MS;

    const existing = all.find(
      (m) => m.homeTeam === p.home && m.awayTeam === p.away && m.status === "upcoming"
    );
    if (!existing) {
      const finishedOrOther = all.find((m) => m.homeTeam === p.home && m.awayTeam === p.away);
      if (!finishedOrOther) {
        const round = roundIndexOf(p.home, p.away);
        await insertMatch(p.home, p.away, "upcoming", upcomingStart, round);
      }
    } else {
      if (existing.startsAt.getTime() !== upcomingStart) {
        await db
          .update(matches)
          .set({ startsAt: new Date(upcomingStart) })
          .where(eq(matches.id, existing.id));
      }
    }
  }

  // 5) Nettoyer les upcoming hors de la fenêtre active.
  for (const m of all) {
    const key = `${m.homeTeam}|${m.awayTeam}`;
    if (m.status === "upcoming" && !activeKeys.has(key)) {
      await finishMatch(m);
    }
  }

  await pruneFinished(now);
}

async function insertMatch(
  home: string,
  away: string,
  status: "live" | "upcoming",
  startsAt: number,
  round: number
) {
  const odds = oddsFor(home, away);
  const handicapLine = asianHandicapLine(home, away);
  const score = status === "live" ? scoreAt(round, 1, home, away) : { home: null, away: null };
  await db.insert(matches).values({
    sport: "football",
    league: VIRTUAL_LEAGUE,
    homeTeam: home,
    awayTeam: away,
    homeScore: score.home,
    awayScore: score.away,
    status,
    minute: status === "live" ? "1'" : null,
    startsAt: new Date(startsAt),
    oddsHome: odds.oddsHome,
    oddsDraw: odds.oddsDraw,
    oddsAway: odds.oddsAway,
    redHome: 0,
    redAway: 0,
    events: [],
    tickHistory: [],
    regime: "balanced",
    homeForm: 1,
    awayForm: 1,
    asianHandicapLine: handicapLine,
  });
}

async function finishMatch(m: MatchRow) {
  const round = roundIndexOf(m.homeTeam, m.awayTeam);
  const score = round >= 0 ? scoreAt(round, 90, m.homeTeam, m.awayTeam) : { home: 0, away: 0 };
  const finishedAt = new Date();
  await db
    .update(matches)
    .set({ status: "finished", minute: "Terminé", homeScore: score.home, awayScore: score.away, finishedAt })
    .where(eq(matches.id, m.id));
}

/** Nettoie les vieux matchs terminés. */
async function pruneFinished(now: number) {
  const cutoff = now - 3 * ROUND_MS;
  const finished = await db.select().from(matches).where(and(eq(matches.status, "finished"), eq(matches.source, "virtual")));
  const betRows = await db.select({ matchId: bets.matchId }).from(bets);
  const protectedIds = new Set(
    betRows.map((b) => b.matchId).filter((id): id is number => id != null)
  );

  for (const m of finished) {
    if (protectedIds.has(m.id)) continue;
    const finishedAtTime = m.finishedAt?.getTime() ?? m.startsAt.getTime();
    if (finishedAtTime < cutoff) {
      await db.delete(matches).where(eq(matches.id, m.id));
    }
  }
}
