import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser, bets, matches, simState, type MatchRow } from "@/db/schema";
import {
  ROUNDS,
  ROUND_MS,
  VIRTUAL_LEAGUE,
  oddsFor,
  pairingsForRound,
  roundIndexOf,
  scoreAt,
} from "@/db/fixtures";

/**
 * Tournoi virtuel : une journée toutes les 60 s (ROUND_MS), 5 affiches en direct,
 * 5 affiches à venir, boucle infinie sur les 9 journées du round-robin.
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
  const totalRounds = Math.max(0, Math.floor((now - epoch) / ROUND_MS));
  const roundIndex = totalRounds % ROUNDS.length;
  const roundStart = epoch + totalRounds * ROUND_MS;
  const elapsed = Math.min(now - roundStart, ROUND_MS);
  const isOver = elapsed >= ROUND_MS;
  const gameMinute = isOver ? 90 : Math.max(1, Math.floor((elapsed / ROUND_MS) * 90));
  const nextRoundIndex = (roundIndex + 1) % ROUNDS.length;

  const livePairs = pairingsForRound(roundIndex);
  const upcomingPairs = pairingsForRound(nextRoundIndex);
  const isLivePair = (m: { homeTeam: string; awayTeam: string }) =>
    livePairs.some((p) => p.home === m.homeTeam && p.away === m.awayTeam);
  const isUpcomingPair = (m: { homeTeam: string; awayTeam: string }) =>
    upcomingPairs.some((p) => p.home === m.homeTeam && p.away === m.awayTeam);

  const all = await db.select().from(matches);

  // 1) Clôture des matchs en direct d'une journée antérieure (cycle sauté ou avance).
  for (const m of all) {
    if (m.status === "live" && !isLivePair(m)) {
      await finishMatch(m);
    }
  }

  // 2) Coup d'envoi de la journée courante : promotion des "à venir", insertion sinon.
  if (!isOver) {
    const byKey = new Map(
      all
        .filter((m) => m.status !== "finished")
        .map((m) => [`${m.homeTeam}|${m.awayTeam}`, m])
    );
    for (const p of livePairs) {
      const key = `${p.home}|${p.away}`;
      const existing = byKey.get(key);
      if (existing?.status === "upcoming") {
        const score = scoreAt(roundIndex, 1, p.home, p.away);
        await db
          .update(matches)
          .set({
            status: "live",
            minute: "1'",
            homeScore: score.home,
            awayScore: score.away,
            startsAt: new Date(roundStart),
          })
          .where(eq(matches.id, existing.id));
      } else if (!existing) {
        await insertMatch(p.home, p.away, "live", roundStart, roundIndex);
      }
    }
  }

  // 3) Score / minute des matchs en direct de la journée courante.
  const liveMatches = await db.select().from(matches).where(eq(matches.status, "live"));
  for (const m of liveMatches) {
    const score = scoreAt(roundIndex, gameMinute, m.homeTeam, m.awayTeam);
    await db
      .update(matches)
      .set({
        homeScore: score.home,
        awayScore: score.away,
        minute: isOver ? "Terminé" : `${gameMinute}'`,
        status: isOver ? "finished" : "live",
        startsAt: new Date(roundStart),
      })
      .where(eq(matches.id, m.id));
  }

  // 4) Journée suivante : préparation des affiches "à venir".
  const upcomingMatches = await db.select().from(matches).where(eq(matches.status, "upcoming"));
  const hasNext = upcomingMatches.some((m) => isUpcomingPair(m));
  for (const m of upcomingMatches) {
    if (isUpcomingPair(m)) {
      if (m.startsAt.getTime() !== roundStart + ROUND_MS) {
        await db
          .update(matches)
          .set({ startsAt: new Date(roundStart + ROUND_MS) })
          .where(eq(matches.id, m.id));
      }
    } else {
      await finishMatch(m);
    }
  }
  if (!hasNext) {
    for (const p of upcomingPairs) {
      await insertMatch(p.home, p.away, "upcoming", roundStart + ROUND_MS, nextRoundIndex);
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
  });
}

async function finishMatch(m: MatchRow) {
  const round = roundIndexOf(m.homeTeam, m.awayTeam);
  const score = scoreAt(round, 90, m.homeTeam, m.awayTeam);
  await db
    .update(matches)
    .set({ status: "finished", minute: "Terminé", homeScore: score.home, awayScore: score.away })
    .where(eq(matches.id, m.id));
}

/** Nettoie les vieux matchs terminés, sans toucher à ceux référencés par un pari. */
async function pruneFinished(now: number) {
  const cutoff = now - 3 * ROUND_MS;
  const finished = await db.select().from(matches).where(eq(matches.status, "finished"));
  const betRows = await db.select({ matchId: bets.matchId }).from(bets);
  const protectedIds = new Set(
    betRows.map((b) => b.matchId).filter((id): id is number => id != null)
  );

  for (const m of finished) {
    if (protectedIds.has(m.id)) continue;
    if (m.startsAt.getTime() < cutoff) {
      await db.delete(matches).where(eq(matches.id, m.id));
    }
  }
}
