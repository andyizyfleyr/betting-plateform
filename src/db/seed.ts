import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { appUser, bets, matches, predictionBets, predictionQuestions } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { findLeague, clubLogo } from "@/lib/leagues";
import { oddsFor } from "@/db/fixtures";

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

  // Colonne role (admin) — idempotent pour les bases déjà en service.
  await db.execute(sql`
    ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user' NOT NULL;
  `);

  // Colonnes des matchs manuels enrichis (logos + marchés personnalisés).
  await db.execute(sql`
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "home_logo" text;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "away_logo" text;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "markets" jsonb;
  `);

  // Colonnes de la couche trading/risk sur les paris (CLV + flags d'audit).
  await db.execute(sql`
    ALTER TABLE "bets" ADD COLUMN IF NOT EXISTS "closing_odds" double precision;
    ALTER TABLE "bets" ADD COLUMN IF NOT EXISTS "risk_flag" text;
  `);

  // Suppression définitive du moteur virtuel : plus aucun match auto, uniquement
  // des affiches réelles (source "manual"). Idempotent — ne fait rien si déjà vide.
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

  // Matchs réels du jour (source "manual") — idempotent : la première affiche du
  // programme sert de sentinelle, avec des heures de coup d'envoi variées.
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
    const endOfToday = new Date(todayStart.getTime() + 86_400_000);

    // Affichages réels, heures variées : deux déjà en cours (passées il y a quelques
    // minutes → l'engine les démarre en live au prochain tick) puis le reste de la
    // journée à venir, sans jamais déborder sur demain.
    const realFixtures: Array<{
      league: string;
      home: string;
      away: string;
      offsetMs: number;
    }> = [
      { league: "Ligue 1", home: "Paris SG", away: "Marseille", offsetMs: -18 * MIN },
      { league: "Premier League", home: "Arsenal", away: "Chelsea", offsetMs: -7 * MIN },
      { league: "Ligue 1", home: "Lyon", away: "Monaco", offsetMs: 25 * MIN },
      { league: "Liga", home: "Real Betis", away: "Villarreal", offsetMs: 55 * MIN },
      { league: "Premier League", home: "Liverpool", away: "Manchester City", offsetMs: 1 * HOUR + 40 * MIN },
      { league: "Bundesliga", home: "Bayern Munich", away: "Dortmund", offsetMs: 2 * HOUR + 30 * MIN },
      { league: "Serie A", home: "Inter Milan", away: "AC Milan", offsetMs: 3 * HOUR + 20 * MIN },
      { league: "Liga", home: "Atlético Madrid", away: "FC Séville", offsetMs: 4 * HOUR + 10 * MIN },
      { league: "Bundesliga", home: "Leverkusen", away: "RB Leipzig", offsetMs: 5 * HOUR },
      { league: "Serie A", home: "Juventus", away: "Naples", offsetMs: 6 * HOUR },
    ];

    const manualSeed = realFixtures.map((f) => {
      const leagueDef = findLeague(f.league);
      const startsAt = new Date(Math.min(now + f.offsetMs, endOfToday.getTime() - 30 * MIN));
      const o = oddsFor(f.home, f.away);
      const homeLogo = leagueDef ? clubLogo(leagueDef, f.home) : null;
      const awayLogo = leagueDef ? clubLogo(leagueDef, f.away) : null;
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

  // S'assure que les tables de prédictions existent (sécurité pour le déploiement Vercel)
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
      "volume" double precision DEFAULT 0 NOT NULL,
      "yes_count" integer DEFAULT 0 NOT NULL,
      "no_count" integer DEFAULT 0 NOT NULL,
      "resolves_at" timestamp NOT NULL,
      "resolved_at" timestamp,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
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

  // Migration idempotente : ajoute la colonne de cash-out si elle manque (bases existantes).
  await db.execute(sql`
    ALTER TABLE "prediction_bets" ADD COLUMN IF NOT EXISTS "cash_out_amount" double precision;
  `);

  // Table des dépôts (Stripe / PayPal) — sécurise le déploiement Vercel.
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

  // Questions de prédiction (idempotent, indépendant des matchs).
  const [{ predictionCount }] = await db
    .select({ predictionCount: sql<number>`count(*)::int` })
    .from(predictionQuestions);

  if (predictionCount === 0) {
    const day = 86_400_000;
    const hour = 3_600_000;
    const now = Date.now();
    const endOfMonth = new Date(now);
    endOfMonth.setDate(1);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1, 0);
    endOfMonth.setHours(18, 0, 0, 0);

    const questionsSeed = [
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

    const insertedQuestions = await db
      .insert(predictionQuestions)
      .values(questionsSeed)
      .returning();

    // Paris démo sur la question résolue (base fraîche uniquement) : net +8 € pour le joueur.
    if (freshDb) {
      const resolved = insertedQuestions.find((q) => q.status === "resolved");
      if (resolved) {
        await db.insert(predictionBets).values([
          {
            userId: 1,
            questionId: resolved.id,
            selection: "yes",
            selectionLabel: "Oui",
            question: resolved.question,
            category: resolved.category,
            odds: resolved.oddsYes,
            stake: 20,
            potentialWin: round2(20 * resolved.oddsYes),
            status: "won",
            placedAt: new Date(now - 3 * day),
          },
          {
            userId: 1,
            questionId: resolved.id,
            selection: "no",
            selectionLabel: "Non",
            question: resolved.question,
            category: resolved.category,
            odds: resolved.oddsNo,
            stake: 10,
            potentialWin: round2(10 * resolved.oddsNo),
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

  // Compte administrateur (email dédié) — créé ou promu à chaque démarrage.
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
