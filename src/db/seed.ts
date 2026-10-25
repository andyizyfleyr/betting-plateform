import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appUser, matches, predictionBets, predictionQuestions } from "@/db/schema";
import { hashPassword } from "@/lib/auth";

let seededOnce = false;
let seedPromise: Promise<void> | null = null;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Initialisation atomique et idempotente de la base :
 * - Verrou mémoire `seedPromise` contre les requêtes concurrentes au démarrage
 * - Déduplication SQL automatique des questions en doublon + index UNIQUE
 * - Nettoyage des anciens matchs auto-générés bloqués sur le rythme de 55 min.
 */
export async function ensureSeeded(): Promise<void> {
  if (seededOnce) return;
  if (!seedPromise) {
    seedPromise = runSeedInternal()
      .then(() => {
        seededOnce = true;
      })
      .catch((err) => {
        seedPromise = null;
        throw err;
      });
  }
  return seedPromise;
}

async function runSeedInternal(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user' NOT NULL;
    ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "bonus_locked" double precision DEFAULT 0 NOT NULL;
    ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "token_version" integer DEFAULT 0 NOT NULL;
  `);

  await db.execute(sql`
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "home_logo" text;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "away_logo" text;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "markets" jsonb;
  `);

  await db.execute(sql`
    ALTER TABLE "bets" ADD COLUMN IF NOT EXISTS "closing_odds" double precision;
    ALTER TABLE "bets" ADD COLUMN IF NOT EXISTS "risk_flag" text;
    ALTER TABLE "bets" ADD COLUMN IF NOT EXISTS "settled_at" timestamp;
  `);

  await db.execute(sql`DROP TABLE IF EXISTS "sim_state";`);

  // Nettoie les anciens matchs auto-seedés en mode "manual" sans marchés perso ni paris liés
  // afin que le nouveau moteur virtuel (2–3 minutes) prenne le relais proprement sans doublons.
  await db.execute(sql`
    DELETE FROM "matches" m
    WHERE m."source" = 'manual'
      AND m."markets" IS NULL
      AND m."status" = 'upcoming'
      AND m."home_score" IS NULL
      AND m."starts_at" > now() + interval '15 minutes'
      AND NOT EXISTS (SELECT 1 FROM "bets" b WHERE b."match_id" = m."id");
  `);

  // Déduplique aussi d'éventuels matchs "upcoming" identiques créés en parallèle sans paris
  await db.execute(sql`
    DELETE FROM "matches" m1
    USING "matches" m2
    WHERE m1."id" > m2."id"
      AND m1."status" = 'upcoming'
      AND m2."status" = 'upcoming'
      AND m1."home_team" = m2."home_team"
      AND m1."away_team" = m2."away_team"
      AND NOT EXISTS (SELECT 1 FROM "bets" b WHERE b."match_id" = m1."id");
  `);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(matches);

  const freshDb = count === 0;

  let [user] = await db.select().from(appUser).limit(1);
  if (!user) {
    const [insertedUser] = await db
      .insert(appUser)
      .values({ id: 1 })
      .onConflictDoNothing()
      .returning();
    user = insertedUser ?? (await db.select().from(appUser).limit(1))[0];
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
    ALTER TABLE "prediction_bets" ADD COLUMN IF NOT EXISTS "settled_at" timestamp;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "combo_bets" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" integer DEFAULT 1 NOT NULL,
      "legs" jsonb NOT NULL,
      "base_odds" double precision NOT NULL,
      "boost_pct" double precision DEFAULT 0 NOT NULL,
      "total_odds" double precision NOT NULL,
      "stake" double precision NOT NULL,
      "potential_win" double precision NOT NULL,
      "status" text DEFAULT 'pending' NOT NULL,
      "cash_out_amount" double precision,
      "placed_at" timestamp DEFAULT now() NOT NULL,
      "settled_at" timestamp
    );
    ALTER TABLE "combo_bets" ADD COLUMN IF NOT EXISTS "settled_at" timestamp;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "withdrawals" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" integer DEFAULT 1 NOT NULL,
      "method" text NOT NULL,
      "destination" text NOT NULL,
      "amount" double precision NOT NULL,
      "status" text DEFAULT 'pending' NOT NULL,
      "admin_note" text,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "processed_at" timestamp
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "wallet_adjustments" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" integer NOT NULL,
      "amount" double precision NOT NULL,
      "reason" text NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
  `);

  // ──────────────────────────────────────────────────────────────────────────
  //  Déduplication automatique des questions en base + contrainte d'unicité
  // ──────────────────────────────────────────────────────────────────────────
  await db.execute(sql`
    WITH canon AS (
      SELECT LOWER(TRIM("question")) AS norm_q,
             MIN("id") AS keep_id,
             SUM("volume") AS sum_vol,
             SUM("yes_count") AS sum_yes,
             SUM("no_count") AS sum_no
      FROM "prediction_questions"
      GROUP BY LOWER(TRIM("question"))
      HAVING COUNT(*) > 1
    )
    UPDATE "prediction_bets" pb
    SET "question_id" = c.keep_id
    FROM "prediction_questions" pq
    JOIN canon c ON LOWER(TRIM(pq."question")) = c.norm_q
    WHERE pb."question_id" = pq."id"
      AND pq."id" <> c.keep_id;
  `);

  await db.execute(sql`
    WITH canon AS (
      SELECT LOWER(TRIM("question")) AS norm_q,
             MIN("id") AS keep_id,
             SUM("volume") AS sum_vol,
             SUM("yes_count") AS sum_yes,
             SUM("no_count") AS sum_no
      FROM "prediction_questions"
      GROUP BY LOWER(TRIM("question"))
      HAVING COUNT(*) > 1
    )
    UPDATE "prediction_questions" pq
    SET "volume" = c.sum_vol,
        "yes_count" = c.sum_yes,
        "no_count" = c.sum_no
    FROM canon c
    WHERE pq."id" = c.keep_id;
  `);

  await db.execute(sql`
    DELETE FROM "prediction_questions" pq1
    USING "prediction_questions" pq2
    WHERE pq1."id" > pq2."id"
      AND LOWER(TRIM(pq1."question")) = LOWER(TRIM(pq2."question"));
  `);

  // Supprime aussi les deux anciennes questions binaires redondantes avec les nouveaux choix multiples
  // uniquement si aucun pari n'y est attaché.
  await db.execute(sql`
    DELETE FROM "prediction_questions" pq
    WHERE pq."question" IN (
      'Le prochain Ballon d''Or sera-t-il remporté par un joueur de Liga ?',
      'Le Real Madrid remportera-t-il la Ligue des Champions cette saison ?'
    )
    AND NOT EXISTS (
      SELECT 1 FROM "prediction_bets" pb WHERE pb."question_id" = pq."id"
    );
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "prediction_questions_question_uniq"
    ON "prediction_questions" ("question");
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
      question: "Quel film remportera l'Oscar du meilleur film lors de la prochaine cérémonie ?",
      category: "Culture",
      status: "open" as const,
      seedValue: 507,
      oddsYes: 2.0,
      oddsNo: 2.0,
      options: [
        { key: "dune_messiah", label: "Dune : Messiah", odds: 2.7 },
        { key: "the_odyssey", label: "The Odyssey (C. Nolan)", odds: 3.1 },
        { key: "mickey_17", label: "Mickey 17", odds: 5.4 },
        { key: "autre_film", label: "Un film indépendant", odds: 6.2 },
      ],
      volume: 0,
      yesCount: 0,
      noCount: 0,
      resolvesAt: new Date(now + 110 * day),
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
      .where(sql`LOWER(TRIM(${predictionQuestions.question})) = LOWER(TRIM(${q.question}))`)
      .limit(1);

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
        .onConflictDoNothing()
        .returning();

      if (inserted && q.status === "resolved" && freshDb) {
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
}
