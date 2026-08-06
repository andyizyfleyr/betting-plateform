import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appUser, bets, matches } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import {
  ALL_PAIRS,
  ROUND_MS,
  ROUNDS,
  VIRTUAL_LEAGUE,
  oddsFor,
  pairingsForRound,
  scoreAt,
} from "@/db/fixtures";

let seededOnce = false;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Seed idempotent : ne fait rien si des matchs existent déjà.
 * Tournoi virtuel : journée 0 en direct, journée 1 à venir, deux affiches terminées
 * cohérentes avec les paris démo (1 gagné / 1 perdu). Appelé paresseusement depuis les routes API.
 */
export async function ensureSeeded() {
  if (seededOnce) return;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(matches);

  if (count === 0) {
    const now = Date.now();

    const livePair = ALL_PAIRS[0];
    const upcomingPair = ALL_PAIRS[1];

    // Deux affiches terminées aux résultats opposés (victoire domicile / non-victoire)
    // pour rendre crédibles les paris démo gagné / perdu.
    const finishedSeed: { home: string; away: string; round: number; homeWin: boolean }[] = [];
    const usedTeams = new Set<string>();
    for (let r = ROUNDS.length - 1; r >= 0 && finishedSeed.length < 2; r--) {
      for (const p of pairingsForRound(r)) {
        if (usedTeams.has(p.home) || usedTeams.has(p.away)) continue;
        const s = scoreAt(r, 90, p.home, p.away);
        const homeWin = s.home > s.away;
        if (homeWin && !finishedSeed.some((f) => f.homeWin)) {
          usedTeams.add(p.home);
          usedTeams.add(p.away);
          finishedSeed.push({ ...p, round: r, homeWin });
        } else if (!homeWin && !finishedSeed.some((f) => !f.homeWin)) {
          usedTeams.add(p.home);
          usedTeams.add(p.away);
          finishedSeed.push({ ...p, round: r, homeWin });
        }
        if (finishedSeed.length >= 2) break;
      }
    }

    const seedMatches = [
      {
        sport: "football",
        league: VIRTUAL_LEAGUE,
        homeTeam: livePair.home,
        awayTeam: livePair.away,
        homeScore: scoreAt(0, 1, livePair.home, livePair.away).home,
        awayScore: scoreAt(0, 1, livePair.home, livePair.away).away,
        status: "live" as const,
        minute: "1'",
        startsAt: new Date(now),
        oddsHome: oddsFor(livePair.home, livePair.away).oddsHome,
        oddsDraw: oddsFor(livePair.home, livePair.away).oddsDraw,
        oddsAway: oddsFor(livePair.home, livePair.away).oddsAway,
        redHome: 0,
        redAway: 0,
        events: [],
        tickHistory: [],
        regime: "balanced",
        homeForm: 1,
        awayForm: 1,
        asianHandicapLine: null,
      },
      {
        sport: "football",
        league: VIRTUAL_LEAGUE,
        homeTeam: upcomingPair.home,
        awayTeam: upcomingPair.away,
        homeScore: null,
        awayScore: null,
        status: "upcoming" as const,
        minute: null,
        startsAt: new Date(now + ROUND_MS),
        oddsHome: oddsFor(upcomingPair.home, upcomingPair.away).oddsHome,
        oddsDraw: oddsFor(upcomingPair.home, upcomingPair.away).oddsDraw,
        oddsAway: oddsFor(upcomingPair.home, upcomingPair.away).oddsAway,
        redHome: 0,
        redAway: 0,
        events: [],
        tickHistory: [],
        regime: "balanced",
        homeForm: 1,
        awayForm: 1,
        asianHandicapLine: null,
      },
      ...finishedSeed.map((f, i) => {
        const s = scoreAt(f.round, 90, f.home, f.away);
        const o = oddsFor(f.home, f.away);
        return {
          sport: "football",
          league: VIRTUAL_LEAGUE,
          homeTeam: f.home,
          awayTeam: f.away,
          homeScore: s.home,
          awayScore: s.away,
          status: "finished" as const,
          minute: "Terminé",
          startsAt: new Date(now - (i + 1) * ROUND_MS),
          oddsHome: o.oddsHome,
          oddsDraw: o.oddsDraw,
          oddsAway: o.oddsAway,
          redHome: 0,
          redAway: 0,
          events: [],
          tickHistory: [],
          regime: "balanced",
          homeForm: 1,
          awayForm: 1,
          asianHandicapLine: null,
          finishedAt: new Date(now - (i + 1) * ROUND_MS),
        };
      }),
    ];

    const inserted = await db
      .insert(matches)
      .values(seedMatches)
      .returning();

    const liveMatches = inserted.filter((m) => m.status === "live");
    const upcomingMatches = inserted.filter((m) => m.status === "upcoming");
    const finishedMatches = inserted.filter((m) => m.status === "finished");

    const wonMatch =
      finishedMatches.find((m) => (m.homeScore ?? 0) > (m.awayScore ?? 0)) ?? finishedMatches[0];
    const lostMatch =
      finishedMatches.find((m) => (m.homeScore ?? 0) <= (m.awayScore ?? 0)) ?? finishedMatches[1];

    const betsSeed = [
      {
        userId: 1,
        matchId: liveMatches[0].id,
        sport: "football",
        league: VIRTUAL_LEAGUE,
        homeTeam: liveMatches[0].homeTeam,
        awayTeam: liveMatches[0].awayTeam,
        selection: "home",
        selectionLabel: `Victoire ${liveMatches[0].homeTeam}`,
        odds: liveMatches[0].oddsHome,
        stake: 25,
        potentialWin: round2(25 * liveMatches[0].oddsHome),
        status: "pending",
        placedAt: new Date(now - 2 * 60 * 1000),
      },
      {
        userId: 1,
        matchId: upcomingMatches[0].id,
        sport: "football",
        league: VIRTUAL_LEAGUE,
        homeTeam: upcomingMatches[0].homeTeam,
        awayTeam: upcomingMatches[0].awayTeam,
        selection: "away",
        selectionLabel: `Victoire ${upcomingMatches[0].awayTeam}`,
        odds: upcomingMatches[0].oddsAway,
        stake: 10,
        potentialWin: round2(10 * upcomingMatches[0].oddsAway),
        status: "pending",
        placedAt: new Date(now - 60 * 1000),
      },
      {
        userId: 1,
        matchId: wonMatch.id,
        sport: "football",
        league: VIRTUAL_LEAGUE,
        homeTeam: wonMatch.homeTeam,
        awayTeam: wonMatch.awayTeam,
        selection: "home",
        selectionLabel: `Victoire ${wonMatch.homeTeam}`,
        odds: wonMatch.oddsHome,
        stake: 30,
        potentialWin: round2(30 * wonMatch.oddsHome),
        status: "won",
        placedAt: new Date(now - 3 * ROUND_MS),
      },
      {
        userId: 1,
        matchId: lostMatch.id,
        sport: "football",
        league: VIRTUAL_LEAGUE,
        homeTeam: lostMatch.homeTeam,
        awayTeam: lostMatch.awayTeam,
        selection: "home",
        selectionLabel: `Victoire ${lostMatch.homeTeam}`,
        odds: lostMatch.oddsHome,
        stake: 15,
        potentialWin: round2(15 * lostMatch.oddsHome),
        status: "lost",
        placedAt: new Date(now - 4 * ROUND_MS),
      },
    ];

    await db.insert(bets).values(betsSeed);

    const totalStake = betsSeed.reduce((s, b) => s + b.stake, 0);
    const totalWon = betsSeed
      .filter((b) => b.status === "won")
      .reduce((s, b) => s + b.potentialWin, 0);

    const [user] = await db.select().from(appUser).limit(1);
    if (!user) {
      await db.insert(appUser).values({ id: 1 });
      // Le solde reflète les paris déjà engagés / gagnés du seed.
      await db
        .update(appUser)
        .set({ balance: 250 - totalStake + totalWon })
        .where(sql`id = 1`);
    }
  }

  const [user] = await db.select().from(appUser).limit(1);
  if (!user) {
    await db.insert(appUser).values({ id: 1 });
  }

  // Avance la séquence de la clé primaire : user 1 a été inséré avec un id explicite,
  // sinon le prochain `serial` repartirait à 1 (collision à l'inscription).
  await db.execute(sql`
    SELECT setval(
      pg_get_serial_sequence('app_user', 'id'),
      GREATEST((SELECT COALESCE(MAX(id), 1) FROM app_user), 1)
    )
  `);

  // Compte démo (idempotent) : crédentiels par défaut si jamais définis.
  if (user && !user.email) {
    await db
      .update(appUser)
      .set({ email: "demo@pulse.app", passwordHash: hashPassword("demo1234") })
      .where(eq(appUser.id, user.id));
  }

  seededOnce = true;
}
