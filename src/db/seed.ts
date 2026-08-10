import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appUser, bets, matches, predictionBets, predictionQuestions } from "@/db/schema";
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

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(matches);

  const freshDb = count === 0;

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
      "placed_at" timestamp DEFAULT now() NOT NULL
    );
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
