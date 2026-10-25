import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { appUser, matches, predictionBets, predictionQuestions } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { findLeague, clubLogo } from "@/lib/leagues";
import { oddsFor } from "@/db/fixtures";
import { teamLogo } from "@/lib/team-logos";

let seededOnce = false;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function ensureSeeded() {
  if (seededOnce) return;

  await db.execute(sql`
    ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user' NOT NULL;
  `);

  await db.execute(sql`
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "home_logo" text;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "away_logo" text;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "markets" jsonb;
  `);

  await db.execute(sql`
    ALTER TABLE "bets" ADD COLUMN IF NOT EXISTS "closing_odds" double precision;
    ALTER TABLE "bets" ADD COLUMN IF NOT EXISTS "risk_flag" text;
  `);

  const virtualLeft = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(matches)
    .where(eq(matches.source, "virtual"));
  if (virtualLeft[0].n > 0) {
    await db.execute(sql`
      DELETE FROM "bets" WHERE "match_id" IN (SELECT "id" FROM "matches" WHERE "source" = 'virtual');
      DELETE FROM "matches" WHERE "source" = 'virtual';
    `);
  }
  await db.execute(sql`DROP TABLE IF EXISTS "sim_state";`);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(matches);

  const freshDb = count === 0;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [{ manualToday }] = await db
    .select({ manualToday: sql<number>`count(*)::int` })
    .from(matches)
    .where(
      and(
        eq(matches.source, "manual"),
        eq(matches.homeTeam, "Paris SG"),
        eq(matches.awayTeam, "Marseille"),
        gte(matches.startsAt, todayStart)
      )
    );

  if (manualToday === 0) {
    const now = Date.now();
    const MIN = 60_000;
    const HOUR = 3_600_000;

    const realFixtures: Array<{
      league: string;
      home: string;
      away: string;
      offsetMs: number;
    }> = [
      { league: "Ligue 1", home: "Paris SG", away: "Marseille", offsetMs: -14 * MIN },
      { league: "Premier League", home: "Arsenal", away: "Chelsea", offsetMs: -6 * MIN },
      { league: "Ligue 1", home: "Lyon", away: "Monaco", offsetMs: 18 * MIN },
      { league: "Liga", home: "Real Betis", away: "Villarreal", offsetMs: 42 * MIN },
      { league: "Premier League", home: "Liverpool", away: "Manchester City", offsetMs: 1 * HOUR + 15 * MIN },
      { league: "Bundesliga", home: "Bayern Munich", away: "Dortmund", offsetMs: 1 * HOUR + 50 * MIN },
      { league: "Serie A", home: "Inter Milan", away: "AC Milan", offsetMs: 2 * HOUR + 30 * MIN },
      { league: "Liga", home: "Atlético Madrid", away: "FC Séville", offsetMs: 3 * HOUR + 10 * MIN },
      { league: "Bundesliga", home: "Leverkusen", away: "RB Leipzig", offsetMs: 3 * HOUR + 50 * MIN },
      { league: "Serie A", home: "Juventus", away: "Naples", offsetMs: 4 * HOUR + 30 * MIN },
    ];

    const manualSeed = realFixtures.map((f) => {
      const leagueDef = findLeague(f.league);
      const startsAt = new Date(now + f.offsetMs);
      const o = oddsFor(f.home, f.away);
      const homeLogo = teamLogo(f.home) ?? (leagueDef ? clubLogo(leagueDef, f.home) : null);
      const awayLogo = teamLogo(f.away) ?? (leagueDef ? clubLogo(leagueDef, f.away) : null);
      return {
        sport: "football",
        league: f.league,
        homeTeam: f.home,
        awayTeam: f.away,
        homeLogo,
        awayLogo,
        homeScore: null,
        awayScore: null,
        status: "upcoming" as const,
        minute: null,
        startsAt,
        oddsHome: o.oddsHome,
        oddsDraw: o.oddsDraw,
        oddsAway: o.oddsAway,
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
      };
    });

    await db.insert(matches).values(manualSeed);
  }

  const [user] = await db.select().from(appUser).limit(1);
  if (!user) {
    await db.insert(appUser).values({ id: 1 });
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "prediction_questions" (
      "id" serial PRIMARY KEY NOT NULL,
      "question" text NOT NULL,
      "category" text NOT NULL,
      "status" text DEFAULT 'open' NOT NULL,
      "resolution" text,
      "seed_value" integer DEFAULT 0 NOT NULL,
      "odds_yes" double precision NOT NULL,
      "odds_no" double precision NOT NULL,
      "options" jsonb,
      "volume" double precision DEFAULT 0 NOT NULL,
      "yes_count" integer DEFAULT 0 NOT NULL,
      "no_count" integer DEFAULT 0 NOT NULL,
      "resolves_at" timestamp NOT NULL,
      "resolved_at" timestamp,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
  `);

  await db.execute(sql`
    ALTER TABLE "prediction_questions" ADD COLUMN IF NOT EXISTS "options" jsonb;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "prediction_bets" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" integer DEFAULT 1 NOT NULL,
      "question_id" integer NOT NULL REFERENCES "prediction_questions"("id"),
      "selection" text NOT NULL,
      "selection_label" text NOT NULL,
      "question" text NOT NULL,
      "category" text NOT NULL,
      "odds" double precision NOT NULL,
      "stake" double precision NOT NULL,
      "potential_win" double precision NOT NULL,
      "status" text DEFAULT 'pending' NOT NULL,
      "cash_out_amount" double precision,
      "placed_at" timestamp DEFAULT now() NOT NULL
    );
  `);

  await db.execute(sql`
    ALTER TABLE "prediction_bets" ADD COLUMN IF NOT EXISTS "cash_out_amount" double precision;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "deposits" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" integer DEFAULT 1 NOT NULL,
      "provider" text NOT NULL,
      "provider_ref" text NOT NULL,
      "amount" double precision NOT NULL,
      "currency" text DEFAULT 'EUR' NOT NULL,
      "status" text DEFAULT 'pending' NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    );
  `);

  const day = 86_400_000;
  const hour = 3_600_000;
  const now = Date.now();
  const endOfMonth = new Date(now);
  endOfMonth.setDate(1);
  endOfMonth.setMonth(endOfMonth.getMonth() + 1, 0);
  endOfMonth.setHours(18, 0, 0, 0);

  const questionsSeed = [
    {
      question: "Qui va remporter le Ballon d'Or 2026 ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 501,
      oddsYes: 2.0,
      oddsNo: 2.0,
      options: [
        { key: "lamine_yamal", label: "Lamine Yamal", odds: 2.85 },
        { key: "kylian_mbappe", label: "Kylian Mbappé", odds: 3.25 },
        { key: "harry_kane", label: "Harry Kane", odds: 4.5 },
        { key: "vinicius_jr", label: "Vinícius Jr.", odds: 6.0 },
        { key: "mohamed_salah", label: "Mohamed Salah", odds: 7.5 },
        { key: "ousmane_dembele", label: "Ousmane Dembélé", odds: 9.0 },
      ],
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 12 * day),
    },
    {
      question: "Quel club remportera la Ligue des Champions cette saison ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 502,
      oddsYes: 2.0,
      oddsNo: 2.0,
      options: [
        { key: "real_madrid", label: "Real Madrid", odds: 3.75 },
        { key: "manchester_city", label: "Manchester City", odds: 4.2 },
        { key: "fc_barcelone", label: "FC Barcelone", odds: 5.0 },
        { key: "arsenal", label: "Arsenal", odds: 6.5 },
        { key: "bayern_munich", label: "Bayern Munich", odds: 7.0 },
        { key: "paris_sg", label: "Paris SG", odds: 8.5 },
      ],
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 55 * day),
    },
    {
      question: "Qui terminera meilleur buteur de Ligue 1 cette saison ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 503,
      oddsYes: 2.0,
      oddsNo: 2.0,
      options: [
        { key: "ousmane_dembele", label: "Ousmane Dembélé", odds: 2.6 },
        { key: "bradley_barcola", label: "Bradley Barcola", odds: 3.4 },
        { key: "jonathan_david", label: "Jonathan David", odds: 4.2 },
        { key: "mason_greenwood", label: "Mason Greenwood", odds: 4.8 },
        { key: "alexandre_lacazette", label: "Alexandre Lacazette", odds: 7.5 },
      ],
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 140 * day),
    },
    {
      question: "Quel pilote sera sacré champion du monde de Formule 1 ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 504,
      oddsYes: 2.0,
      oddsNo: 2.0,
      options: [
        { key: "max_verstappen", label: "Max Verstappen", odds: 2.1 },
        { key: "lando_norris", label: "Lando Norris", odds: 2.75 },
        { key: "charles_leclerc", label: "Charles Leclerc", odds: 5.5 },
        { key: "lewis_hamilton", label: "Lewis Hamilton", odds: 9.0 },
      ],
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 42 * day),
    },
    {
      question: "Quelle franchise remportera le titre NBA cette saison ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 505,
      oddsYes: 2.0,
      oddsNo: 2.0,
      options: [
        { key: "boston_celtics", label: "Boston Celtics", odds: 3.4 },
        { key: "oklahoma_city_thunder", label: "Oklahoma City Thunder", odds: 3.8 },
        { key: "denver_nuggets", label: "Denver Nuggets", odds: 6.5 },
        { key: "new_york_knicks", label: "New York Knicks", odds: 8.0 },
        { key: "los_angeles_lakers", label: "Los Angeles Lakers", odds: 11.0 },
      ],
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 175 * day),
    },
    {
      question: "Quelle cryptomonnaie signera la meilleure performance ce trimestre ?",
      category: "Crypto",
      status: "open" as const,
      seedValue: 506,
      oddsYes: 2.0,
      oddsNo: 2.0,
      options: [
        { key: "bitcoin", label: "Bitcoin (BTC)", odds: 2.4 },
        { key: "solana", label: "Solana (SOL)", odds: 2.9 },
        { key: "ethereum", label: "Ethereum (ETH)", odds: 3.5 },
        { key: "ripple", label: "XRP", odds: 5.5 },
      ],
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 50 * day),
    },
    {
      question: "Le PSG remportera-t-il son prochain match de Ligue 1 ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 7,
      oddsYes: 1.55,
      oddsNo: 2.3,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 3 * day),
    },
    {
      question: "L'équipe de France gagnera-t-elle son prochain match officiel ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 21,
      oddsYes: 1.45,
      oddsNo: 2.6,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 6 * hour),
    },
    {
      question: "Le prix de l'essence baissera-t-il avant la fin du mois ?",
      category: "Actus",
      status: "open" as const,
      seedValue: 42,
      oddsYes: 2.1,
      oddsNo: 1.68,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: endOfMonth,
    },
    {
      question: "Le Bitcoin dépassera-t-il 100 000 € avant la fin de l'année ?",
      category: "Crypto",
      status: "open" as const,
      seedValue: 13,
      oddsYes: 1.4,
      oddsNo: 2.75,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(Date.UTC(2026, 11, 31, 18, 0, 0)),
    },
    {
      question: "Le prochain Ballon d'Or sera-t-il remporté par un joueur de Liga ?",
      category: "Culture",
      status: "open" as const,
      seedValue: 29,
      oddsYes: 1.9,
      oddsNo: 1.8,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 120 * day),
    },
    {
      question: "L'OM terminera-t-il dans le top 3 de la Ligue 1 ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 55,
      oddsYes: 2.2,
      oddsNo: 1.62,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 21 * day),
    },
    {
      question: "L'Ether (ETH) atteindra-t-il un nouveau record historique ce trimestre ?",
      category: "Crypto",
      status: "open" as const,
      seedValue: 108,
      oddsYes: 1.75,
      oddsNo: 2.05,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 45 * day),
    },
    {
      question: "Le Real Madrid remportera-t-il la Ligue des Champions cette saison ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 142,
      oddsYes: 2.5,
      oddsNo: 1.5,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 60 * day),
    },
    {
      question: "Apple lancera-t-il un iPhone entièrement pliable cette année ?",
      category: "Actus",
      status: "open" as const,
      seedValue: 204,
      oddsYes: 3.1,
      oddsNo: 1.35,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 90 * day),
    },
    {
      question: "Un équipage habité posera-t-il le pied sur Mars avant 2030 ?",
      category: "Actus",
      status: "open" as const,
      seedValue: 312,
      oddsYes: 4.5,
      oddsNo: 1.18,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 365 * day),
    },
    {
      question: "Max Verstappen signera-t-il la pole position lors du prochain Grand Prix de Formule 1 ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 408,
      oddsYes: 2.15,
      oddsNo: 1.66,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 9 * day),
    },
    {
      question: "Plus de 2,5 buts seront-ils inscrits lors du prochain Clasico Real Madrid – FC Barcelone ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 404,
      oddsYes: 1.58,
      oddsNo: 2.3,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 14 * day),
    },
    {
      question: "Liverpool restera-t-il invaincu à Anfield lors de ses 5 prochains matchs ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 409,
      oddsYes: 1.65,
      oddsNo: 2.18,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 35 * day),
    },
    {
      question: "Carlos Alcaraz remportera-t-il le prochain Open d'Australie ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 407,
      oddsYes: 2.75,
      oddsNo: 1.42,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 95 * day),
    },
    {
      question: "Victor Wembanyama réalisera-t-il au moins un quadruple-double en NBA cette saison ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 406,
      oddsYes: 3.2,
      oddsNo: 1.33,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 150 * day),
    },
    {
      question: "Le PSG atteindra-t-il au moins les demi-finales de la Ligue des Champions ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 403,
      oddsYes: 2.05,
      oddsNo: 1.74,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 165 * day),
    },
    {
      question: "Arsenal remportera-t-il le titre de Premier League cette saison ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 402,
      oddsYes: 2.35,
      oddsNo: 1.56,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 185 * day),
    },
    {
      question: "Erling Haaland terminera-t-il meilleur buteur de la Ligue des Champions cette saison ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 405,
      oddsYes: 2.6,
      oddsNo: 1.46,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 190 * day),
    },
    {
      question: "Kylian Mbappé dépassera-t-il la barre des 30 buts en Liga cette saison ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 401,
      oddsYes: 1.72,
      oddsNo: 2.08,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 195 * day),
    },
    {
      question: "Un club français remportera-t-il une coupe d'Europe cette saison ?",
      category: "Sport",
      status: "open" as const,
      seedValue: 410,
      oddsYes: 3.4,
      oddsNo: 1.3,
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 205 * day),
    },
    {
      question: "Mbappé marquera-t-il lors du prochain Classico ?",
      category: "Sport",
      status: "resolved" as const,
      resolution: "yes" as const,
      seedValue: 3,
      oddsYes: 1.9,
      oddsNo: 1.8,
      volume: 340,
      yesCount: 12,
      noCount: 4,
      resolvesAt: new Date(now - 2 * day),
      resolvedAt: new Date(now - 2 * day),
    },
  ];

  for (const q of questionsSeed) {
    const [existing] = await db
      .select({ id: predictionQuestions.id })
      .from(predictionQuestions)
      .where(eq(predictionQuestions.question, q.question));

    if (!existing) {
      const { question, category, status, seedValue, oddsYes, oddsNo, volume, yesCount, noCount, resolvesAt } = q;
      const options = "options" in q ? q.options : undefined;
      const resolution = "resolution" in q ? q.resolution : undefined;
      const resolvedAt = "resolvedAt" in q ? q.resolvedAt : undefined;
      const [inserted] = await db
        .insert(predictionQuestions)
        .values({
          question,
          category,
          status,
          seedValue,
          oddsYes,
          oddsNo,
          ...(options ? { options } : {}),
          volume,
          yesCount,
          noCount,
          resolvesAt,
          ...(resolution ? { resolution } : {}),
          ...(resolvedAt ? { resolvedAt } : {}),
        })
        .returning();
      if (q.status === "resolved" && freshDb) {
        await db.insert(predictionBets).values([
          {
            userId: 1,
            questionId: inserted.id,
            selection: "yes",
            selectionLabel: "Oui",
            question: inserted.question,
            category: inserted.category,
            odds: inserted.oddsYes,
            stake: 20,
            potentialWin: round2(20 * inserted.oddsYes),
            status: "won",
            placedAt: new Date(now - 3 * day),
          },
          {
            userId: 1,
            questionId: inserted.id,
            selection: "no",
            selectionLabel: "Non",
            question: inserted.question,
            category: inserted.category,
            odds: inserted.oddsNo,
            stake: 10,
            potentialWin: round2(10 * inserted.oddsNo),
            status: "lost",
            placedAt: new Date(now - 2.5 * day),
          },
        ]);
        await db
          .update(appUser)
          .set({ balance: sql`${appUser.balance} + 8` })
          .where(sql`id = 1`);
      }
    }
  }

  await db.execute(sql`
    SELECT setval(
      pg_get_serial_sequence('app_user', 'id'),
      GREATEST((SELECT COALESCE(MAX(id), 1) FROM app_user), 1)
    )
  `);

  if (user && !user.email) {
    await db
      .update(appUser)
      .set({ email: "demo@pulse.app", passwordHash: hashPassword("demo1234") })
      .where(eq(appUser.id, user.id));
  }

  const adminEmail = (process.env.ADMIN_EMAIL ?? "admin@pulse.app").trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? "admin1234";
  const [adminUser] = await db
    .select()
    .from(appUser)
    .where(eq(appUser.email, adminEmail))
    .limit(1);
  if (adminUser) {
    if (adminUser.role !== "admin") {
      await db.update(appUser).set({ role: "admin" }).where(eq(appUser.id, adminUser.id));
    }
  } else {
    await db.insert(appUser).values({
      name: "Admin",
      email: adminEmail,
      passwordHash: hashPassword(adminPassword),
      balance: 0,
      role: "admin",
    });
  }

  seededOnce = true;
}
