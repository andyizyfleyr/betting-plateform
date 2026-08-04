import { sql } from "drizzle-orm";
import { db } from "@/db";
import { appUser, bets, matches } from "@/db/schema";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let seededOnce = false;

/**
 * Seed idempotent : ne fait rien si des matchs existent déjà.
 * Appelé paresseusement depuis les routes API.
 */
export async function ensureSeeded() {
  if (seededOnce) return;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(matches);

  if (count === 0) {
    const now = Date.now();
    const seedMatches = [
      // ------- LIVE -------
      {
        sport: "football",
        league: "Ligue 1 · France",
        homeTeam: "Paris SG",
        awayTeam: "Marseille",
        homeScore: 2,
        awayScore: 1,
        status: "live",
        minute: "67'",
        startsAt: new Date(now - 67 * 60 * 1000),
        oddsHome: 1.62,
        oddsDraw: 4.2,
        oddsAway: 5.1,
      },
      {
        sport: "football",
        league: "Premier League · Angleterre",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        homeScore: 0,
        awayScore: 0,
        status: "live",
        minute: "24'",
        startsAt: new Date(now - 24 * 60 * 1000),
        oddsHome: 2.05,
        oddsDraw: 3.4,
        oddsAway: 3.6,
      },
      {
        sport: "football",
        league: "Ligue 1 · France",
        homeTeam: "Lyon",
        awayTeam: "Monaco",
        homeScore: 1,
        awayScore: 2,
        status: "live",
        minute: "53'",
        startsAt: new Date(now - 53 * 60 * 1000),
        oddsHome: 2.75,
        oddsDraw: 3.3,
        oddsAway: 2.5,
      },
      // ------- À VENIR -------
      {
        sport: "football",
        league: "LaLiga · Espagne",
        homeTeam: "Real Madrid",
        awayTeam: "FC Barcelone",
        homeScore: null,
        awayScore: null,
        status: "upcoming",
        minute: null,
        startsAt: new Date(now + 4 * HOUR),
        oddsHome: 2.3,
        oddsDraw: 3.45,
        oddsAway: 2.95,
      },
      {
        sport: "football",
        league: "Bundesliga · Allemagne",
        homeTeam: "Bayern Munich",
        awayTeam: "Dortmund",
        homeScore: null,
        awayScore: null,
        status: "upcoming",
        minute: null,
        startsAt: new Date(now + 7 * HOUR),
        oddsHome: 1.72,
        oddsDraw: 4.05,
        oddsAway: 4.4,
      },
      {
        sport: "football",
        league: "Serie A · Italie",
        homeTeam: "Inter Milan",
        awayTeam: "Juventus",
        homeScore: null,
        awayScore: null,
        status: "upcoming",
        minute: null,
        startsAt: new Date(now + DAY + 2 * HOUR),
        oddsHome: 2.1,
        oddsDraw: 3.25,
        oddsAway: 3.55,
      },
      {
        sport: "football",
        league: "Premier League · Angleterre",
        homeTeam: "Liverpool",
        awayTeam: "Tottenham",
        homeScore: null,
        awayScore: null,
        status: "upcoming",
        minute: null,
        startsAt: new Date(now + 9 * HOUR),
        oddsHome: 1.9,
        oddsDraw: 3.7,
        oddsAway: 3.95,
      },
      {
        sport: "football",
        league: "LaLiga · Espagne",
        homeTeam: "Atlético Madrid",
        awayTeam: "FC Séville",
        homeScore: null,
        awayScore: null,
        status: "upcoming",
        minute: null,
        startsAt: new Date(now + 12 * HOUR),
        oddsHome: 2.15,
        oddsDraw: 3.1,
        oddsAway: 3.5,
      },
      {
        sport: "football",
        league: "Ligue 1 · France",
        homeTeam: "Nice",
        awayTeam: "Toulouse",
        homeScore: null,
        awayScore: null,
        status: "upcoming",
        minute: null,
        startsAt: new Date(now + DAY + 6 * HOUR),
        oddsHome: 1.95,
        oddsDraw: 3.4,
        oddsAway: 3.85,
      },
      // ------- TERMINÉS -------
      {
        sport: "football",
        league: "Premier League · Angleterre",
        homeTeam: "Manchester City",
        awayTeam: "Liverpool",
        homeScore: 3,
        awayScore: 1,
        status: "finished",
        minute: "Terminé",
        startsAt: new Date(now - DAY),
        oddsHome: 1.95,
        oddsDraw: 3.6,
        oddsAway: 3.8,
      },
      {
        sport: "football",
        league: "LaLiga · Espagne",
        homeTeam: "FC Séville",
        awayTeam: "Atlético Madrid",
        homeScore: 0,
        awayScore: 2,
        status: "finished",
        minute: "Terminé",
        startsAt: new Date(now - DAY - 3 * HOUR),
        oddsHome: 2.15,
        oddsDraw: 3.1,
        oddsAway: 3.5,
      },
      {
        sport: "football",
        league: "Ligue 1 · France",
        homeTeam: "Toulouse",
        awayTeam: "Nice",
        homeScore: 1,
        awayScore: 1,
        status: "finished",
        minute: "Terminé",
        startsAt: new Date(now - 2 * DAY),
        oddsHome: 2.2,
        oddsDraw: 3.2,
        oddsAway: 3.3,
      },
    ];

    const inserted = await db
      .insert(matches)
      .values(seedMatches)
      .returning({ id: matches.id, homeTeam: matches.homeTeam });

    const idOf = (team: string) =>
      inserted.find((m) => m.homeTeam === team)?.id ?? null;

    await db.insert(bets).values([
      {
        matchId: idOf("Paris SG"),
        sport: "football",
        league: "Ligue 1 · France",
        homeTeam: "Paris SG",
        awayTeam: "Marseille",
        selection: "home",
        selectionLabel: "Victoire Paris SG",
        odds: 1.62,
        stake: 25,
        potentialWin: 40.5,
        status: "pending",
        placedAt: new Date(now - 70 * 60 * 1000),
      },
      {
        matchId: idOf("Real Madrid"),
        sport: "football",
        league: "LaLiga · Espagne",
        homeTeam: "Real Madrid",
        awayTeam: "FC Barcelone",
        selection: "away",
        selectionLabel: "Victoire FC Barcelone",
        odds: 2.95,
        stake: 10,
        potentialWin: 29.5,
        status: "pending",
        placedAt: new Date(now - 2 * 60 * 60 * 1000),
      },
      {
        matchId: idOf("Manchester City"),
        sport: "football",
        league: "Premier League · Angleterre",
        homeTeam: "Manchester City",
        awayTeam: "Liverpool",
        selection: "home",
        selectionLabel: "Victoire Manchester City",
        odds: 1.95,
        stake: 30,
        potentialWin: 58.5,
        status: "won",
        placedAt: new Date(now - 26 * 60 * 60 * 1000),
      },
      {
        matchId: idOf("Toulouse"),
        sport: "football",
        league: "Ligue 1 · France",
        homeTeam: "Toulouse",
        awayTeam: "Nice",
        selection: "home",
        selectionLabel: "Victoire Toulouse",
        odds: 2.2,
        stake: 15,
        potentialWin: 33,
        status: "lost",
        placedAt: new Date(now - 2 * 24 * 60 * 60 * 1000 - 5 * HOUR),
      },
    ]);
  }

  const [user] = await db.select().from(appUser).limit(1);
  if (!user) {
    await db.insert(appUser).values({ id: 1 });
    // Le solde reflète les paris déjà engagés / gagnés du seed.
    await db
      .update(appUser)
      .set({ balance: 250 - 25 - 10 - 30 - 15 + 58.5 })
      .where(sql`id = 1`);
  }

  seededOnce = true;
}
