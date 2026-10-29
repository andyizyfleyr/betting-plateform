import { eq, sql } from "drizzle-orm";
import { db, ensureHealthyDbConnection } from "@/db";
import {
  adminSettings,
  appUser,
  matches,
  predictionBets,
  predictionQuestions,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { reconcileRedCardCounts, sanitizeMatchEvents } from "@/lib/match-events";

let seededOnce = false;
let seedPromise: Promise<void> | null = null;

/**
 * Marqueur persisté en base (`admin_settings`) une fois le schéma et les données
 * initiales vérifiés : évite d'exécuter ~50 requêtes DDL (`ALTER TABLE`, `CREATE TABLE`)
 * et de verrouiller les tables à chaque démarrage à froid (cold start) sur Vercel Serverless.
 * Incrémenter cette clé dès qu'une nouvelle migration SQL est ajoutée dans `runSeedInternal`.
 */
const SCHEMA_SEED_MARKER_KEY = "schema_seed_v17";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Initialisation atomique et idempotente de la base :
 * - Fast-path O(1) sur base déjà initialisée (évite les timeouts 504 au réveil serverless)
 * - Verrou mémoire `seedPromise` contre les requêtes concurrentes au démarrage
 * - Déduplication SQL automatique des questions en doublon + index UNIQUE.
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
  // Vérifie la connectivité PostgreSQL et bascule automatiquement sur une variable de secours
  // (`POSTGRES_URL`, `STORAGE_DATABASE_URL`, etc.) si `DATABASE_URL` pointe vers une base supprimée.
  await ensureHealthyDbConnection();

  // Fast-path serverless en UNE SEULE requête SQL (au lieu de 2 allers-retours séquentiels) :
  // vérifie simultanément le marqueur `schema_seed_v8` et l'existence du compte administrateur.
  try {
    const adminEmailFast = (process.env.ADMIN_EMAIL ?? "admin@pulse.app")
      .trim()
      .toLowerCase();
    const fastCheck = await db.execute(sql`
      SELECT
        EXISTS (
          SELECT 1 FROM "admin_settings" WHERE "setting_key" = ${SCHEMA_SEED_MARKER_KEY}
        ) AS has_marker,
        EXISTS (
          SELECT 1 FROM "app_user" WHERE "email" = ${adminEmailFast}
        ) AS has_admin
    `);
    const chk = (fastCheck.rows?.[0] ?? {}) as {
      has_marker?: boolean;
      has_admin?: boolean;
    };
    if (chk.has_marker && chk.has_admin) {
      return;
    }
  } catch {
    // Table `admin_settings` ou colonne absente sur une base neuve : exécute la migration complète.
  }

  // Création idempotente de toutes les tables de base (permet de brancher une base PostgreSQL
  // 100 % vierge sur Vercel Storage sans avoir besoin de lancer `drizzle-kit push`).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "app_user" (
      "id" serial PRIMARY KEY NOT NULL,
      "name" text DEFAULT 'Alex Martin' NOT NULL,
      "balance" double precision DEFAULT 250 NOT NULL,
      "notifications" boolean DEFAULT true NOT NULL,
      "sound" boolean DEFAULT false NOT NULL,
      "haptics" boolean DEFAULT true NOT NULL,
      "odds_format" text DEFAULT 'decimal' NOT NULL,
      "language" text DEFAULT 'fr' NOT NULL,
      "country_code" text DEFAULT 'FR' NOT NULL,
      "currency" text DEFAULT 'EUR' NOT NULL,
      "live_sim" boolean DEFAULT true NOT NULL,
      "role" text DEFAULT 'user' NOT NULL,
      "bonus_locked" double precision DEFAULT 0 NOT NULL,
      "token_version" integer DEFAULT 0 NOT NULL,
      "email" text UNIQUE,
      "password_hash" text,
      "created_at" timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "app_user_balance_nonneg_chk" CHECK ("balance" >= 0),
      CONSTRAINT "app_user_bonus_nonneg_chk" CHECK ("bonus_locked" >= 0)
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "push_devices" (
      "token" text PRIMARY KEY, "user_id" integer NOT NULL REFERENCES "app_user"("id"),
      "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "push_devices_user_idx" ON "push_devices" ("user_id");
    CREATE TABLE IF NOT EXISTS "push_outbox" (
      "id" serial PRIMARY KEY, "token" text NOT NULL REFERENCES "push_devices"("token") ON DELETE CASCADE,
      "event_key" text NOT NULL, "title" text NOT NULL, "body" text NOT NULL,
      "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "created_at" timestamp NOT NULL DEFAULT now(), "sent_at" timestamp,
      "claimed_until" timestamp, "attempts" integer NOT NULL DEFAULT 0,
      UNIQUE ("token", "event_key")
    );
    CREATE INDEX IF NOT EXISTS "push_outbox_pending_idx" ON "push_outbox" ("id") WHERE "sent_at" IS NULL;
    CREATE TABLE IF NOT EXISTS "payment_incident_reviews" (
      "kind" text NOT NULL CHECK ("kind" IN ('deposit', 'withdrawal')),
      "payment_id" integer NOT NULL CHECK ("payment_id" > 0),
      "state" text NOT NULL CHECK ("state" IN ('open', 'investigating', 'resolved')),
      "note" text NOT NULL DEFAULT '', "updated_by" integer NOT NULL REFERENCES "app_user"("id"),
      "updated_at" timestamp NOT NULL DEFAULT now(), PRIMARY KEY ("kind", "payment_id")
    );
    CREATE TABLE IF NOT EXISTS "payment_incident_actions" (
      "id" serial PRIMARY KEY, "kind" text NOT NULL, "payment_id" integer NOT NULL,
      "state" text NOT NULL, "note" text NOT NULL DEFAULT '',
      "actor_id" integer NOT NULL REFERENCES "app_user"("id"), "created_at" timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "payment_incident_actions_lookup_idx" ON "payment_incident_actions" ("kind", "payment_id", "id" DESC);
    CREATE TABLE IF NOT EXISTS "support_conversations" (
      "id" serial PRIMARY KEY, "user_id" integer NOT NULL UNIQUE REFERENCES "app_user"("id"),
      "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "support_messages" (
      "id" serial PRIMARY KEY, "conversation_id" integer NOT NULL REFERENCES "support_conversations"("id"),
      "sender_id" integer NOT NULL REFERENCES "app_user"("id"),
      "sender_role" text NOT NULL CHECK ("sender_role" IN ('admin', 'user')),
      "client_id" text NOT NULL, "body" text NOT NULL CHECK (char_length("body") BETWEEN 1 AND 2000),
      "created_at" timestamp NOT NULL DEFAULT now(), "read_at" timestamp,
      UNIQUE ("sender_id", "client_id")
    );
    CREATE INDEX IF NOT EXISTS "support_messages_conversation_idx" ON "support_messages" ("conversation_id", "id" DESC);
    CREATE TABLE IF NOT EXISTS "support_presence" (
      "user_id" integer PRIMARY KEY REFERENCES "app_user"("id"), "last_seen_at" timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "favorite_teams" (
      "user_id" integer NOT NULL REFERENCES "app_user"("id"),
      "team_key" text NOT NULL,
      "team_name" text NOT NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY ("user_id", "team_key")
    );
    CREATE TABLE IF NOT EXISTS "bet_disputes" (
      "id" serial PRIMARY KEY,
      "user_id" integer NOT NULL REFERENCES "app_user"("id"),
      "bet_kind" text NOT NULL CHECK ("bet_kind" IN ('sport', 'prediction', 'combo')),
      "bet_id" integer NOT NULL CHECK ("bet_id" > 0),
      "message" text NOT NULL,
      "status" text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'in_review', 'resolved')),
      "admin_reply" text,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "bet_disputes_one_active_idx" ON "bet_disputes" ("user_id", "bet_kind", "bet_id") WHERE "status" IN ('open', 'in_review');
    CREATE INDEX IF NOT EXISTS "bet_disputes_user_created_idx" ON "bet_disputes" ("user_id", "created_at" DESC);
    CREATE INDEX IF NOT EXISTS "bet_disputes_status_idx" ON "bet_disputes" ("status", "created_at" DESC);
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "matches" (
      "id" serial PRIMARY KEY NOT NULL,
      "sport" text NOT NULL,
      "league" text NOT NULL,
      "home_team" text NOT NULL,
      "away_team" text NOT NULL,
      "home_score" integer,
      "away_score" integer,
      "status" text DEFAULT 'upcoming' NOT NULL,
      "minute" text,
      "starts_at" timestamp NOT NULL,
      "odds_home" double precision NOT NULL,
      "odds_draw" double precision,
      "odds_away" double precision NOT NULL,
      "suspended" boolean DEFAULT false NOT NULL,
      "last_goal_at" timestamp,
      "finished_at" timestamp,
      "red_home" integer DEFAULT 0 NOT NULL,
      "red_away" integer DEFAULT 0 NOT NULL,
      "events" jsonb DEFAULT '[]'::jsonb,
      "tick_history" jsonb DEFAULT '[]'::jsonb,
      "regime" text DEFAULT 'balanced' NOT NULL,
      "home_form" double precision DEFAULT 1 NOT NULL,
      "away_form" double precision DEFAULT 1 NOT NULL,
      "asian_handicap_line" double precision,
      "home_logo" text,
      "away_logo" text,
      "markets" jsonb,
      "source" text DEFAULT 'virtual' NOT NULL,
      "scenario_locked" boolean DEFAULT false NOT NULL,
      "scenario_nonce" integer DEFAULT 0 NOT NULL,
      "scripted_events" jsonb,
      "external_id" text,
      "external_league" text,
      "auto_sync" boolean DEFAULT true NOT NULL,
      "ht_home_score" integer,
      "ht_away_score" integer,
      "real_stats" jsonb,
      "feed_synced_at" timestamp,
      "feed_finished_at" timestamp,
      "feed_status_note" text
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "bets" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" integer DEFAULT 1 NOT NULL,
      "match_id" integer REFERENCES "matches"("id"),
      "sport" text NOT NULL,
      "league" text NOT NULL,
      "home_team" text NOT NULL,
      "away_team" text NOT NULL,
      "market" text DEFAULT 'result' NOT NULL,
      "selection" text NOT NULL,
      "selection_label" text NOT NULL,
      "odds" double precision NOT NULL,
      "stake" double precision NOT NULL,
      "potential_win" double precision NOT NULL,
      "status" text DEFAULT 'pending' NOT NULL,
      "cash_out_amount" double precision,
      "payout_multiplier" double precision DEFAULT 1 NOT NULL,
      "stake_returned" double precision DEFAULT 0 NOT NULL,
      "closing_odds" double precision,
      "risk_flag" text,
      "idempotency_key" text,
      "cashout_idempotency_key" text,
      "placed_at" timestamp DEFAULT now() NOT NULL,
      "settled_at" timestamp
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "tap_history" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" integer DEFAULT 1 NOT NULL,
      "bet_amount" double precision NOT NULL,
      "target_multiplier" double precision NOT NULL,
      "crash_multiplier" double precision NOT NULL,
      "win" boolean NOT NULL,
      "balance_after" double precision NOT NULL,
      "description" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "accelerator_rounds" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" integer DEFAULT 1 NOT NULL,
      "bet_amount" double precision NOT NULL,
      "g_base" double precision NOT NULL,
      "m_max" double precision DEFAULT 2.0 NOT NULL,
      "auto_target" double precision,
      "started_at" timestamp NOT NULL,
      "last_ms" bigint NOT NULL,
      "current_multiplier" double precision DEFAULT 1.01 NOT NULL,
      "crash_point" double precision NOT NULL,
      "cashout_multiplier" double precision,
      "status" text DEFAULT 'active' NOT NULL,
      "server_seed" text,
      "seed_hash" text,
      "ended_at" timestamp,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
  `);

  await db.execute(sql`
    ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user' NOT NULL;
    ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "bonus_locked" double precision DEFAULT 0 NOT NULL;
    ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "notify_matches" boolean NOT NULL DEFAULT true;
    ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "notify_bets" boolean NOT NULL DEFAULT true;
    ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "notify_payments" boolean NOT NULL DEFAULT true;
    ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "notify_disputes" boolean NOT NULL DEFAULT true;
    ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "token_version" integer DEFAULT 0 NOT NULL;
    ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "country_code" text DEFAULT 'FR' NOT NULL;
    ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "currency" text DEFAULT 'EUR' NOT NULL;
    UPDATE "app_user" SET "balance" = 0 WHERE "balance" < 0;
    UPDATE "app_user" SET "bonus_locked" = 0 WHERE "bonus_locked" < 0;
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'app_user_balance_nonneg_chk'
      ) THEN
        ALTER TABLE "app_user"
          ADD CONSTRAINT "app_user_balance_nonneg_chk" CHECK ("balance" >= 0);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'app_user_bonus_nonneg_chk'
      ) THEN
        ALTER TABLE "app_user"
          ADD CONSTRAINT "app_user_bonus_nonneg_chk" CHECK ("bonus_locked" >= 0);
      END IF;
    END $$;
  `);

  await db.execute(sql`
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "home_logo" text;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "away_logo" text;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "markets" jsonb;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "scenario_locked" boolean DEFAULT false NOT NULL;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "scenario_nonce" integer DEFAULT 0 NOT NULL;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "scripted_events" jsonb;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "external_id" text;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "external_league" text;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "auto_sync" boolean DEFAULT true NOT NULL;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "ht_home_score" integer;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "ht_away_score" integer;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "real_stats" jsonb;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "feed_synced_at" timestamp;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "feed_finished_at" timestamp;
    ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "feed_status_note" text;
    CREATE INDEX IF NOT EXISTS "matches_external_id_idx" ON "matches" ("external_id");
    CREATE INDEX IF NOT EXISTS "matches_status_source_idx" ON "matches" ("status", "source", "finished_at" DESC);
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "admin_settings" (
      "setting_key" text PRIMARY KEY NOT NULL,
      "value" jsonb NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    );
  `);

  await db.execute(sql`
    ALTER TABLE "bets" ADD COLUMN IF NOT EXISTS "closing_odds" double precision;
    ALTER TABLE "bets" ADD COLUMN IF NOT EXISTS "risk_flag" text;
    ALTER TABLE "bets" ADD COLUMN IF NOT EXISTS "settled_at" timestamp;
    CREATE INDEX IF NOT EXISTS "bets_user_status_idx" ON "bets" ("user_id", "status", "placed_at" DESC);
  `);

  await db.execute(sql`DROP TABLE IF EXISTS "sim_state";`);

  // Déduplique uniquement d'éventuels matchs virtuels "upcoming" identiques créés en parallèle sans paris
  // (ne touche JAMAIS aux matchs réels ajoutés ou importés par l'administrateur).
  await db.execute(sql`
    DELETE FROM "matches" m1
    USING "matches" m2
    WHERE m1."id" > m2."id"
      AND m1."source" = 'virtual'
      AND m2."source" = 'virtual'
      AND m1."status" = 'upcoming'
      AND m2."status" = 'upcoming'
      AND m1."home_team" = m2."home_team"
      AND m1."away_team" = m2."away_team"
      AND NOT EXISTS (SELECT 1 FROM "bets" b WHERE b."match_id" = m1."id");
  `);

  // Réparation idempotente des chronologies d'événements existantes en base
  // (supprime les doublons inter-flux ex. "5' C. Egan-Riley" + "5' CJ Egan-Riley"
  //  sur les matchs déjà terminés ou en cours, et recalibre `red_home`/`red_away`).
  const rowsWithEvents = await db
    .select({
      id: matches.id,
      homeScore: matches.homeScore,
      awayScore: matches.awayScore,
      redHome: matches.redHome,
      redAway: matches.redAway,
      events: matches.events,
    })
    .from(matches)
    .where(sql`jsonb_typeof(${matches.events}) = 'array' AND jsonb_array_length(${matches.events}) >= 1`)
    .orderBy(sql`${matches.id} DESC`)
    .limit(200);

  const eventFixTuples: ReturnType<typeof sql>[] = [];
  for (const row of rowsWithEvents) {
    const rawEvents = row.events ?? [];
    const cleanEvents = sanitizeMatchEvents(rawEvents, row.homeScore, row.awayScore);
    const { redHome: cleanRedH, redAway: cleanRedA } = reconcileRedCardCounts(
      rawEvents,
      cleanEvents,
      row.redHome,
      row.redAway
    );
    const eventsChanged = JSON.stringify(cleanEvents) !== JSON.stringify(rawEvents);
    const redsChanged =
      cleanRedH !== (row.redHome ?? 0) || cleanRedA !== (row.redAway ?? 0);

    if (eventsChanged || redsChanged) {
      eventFixTuples.push(
        sql`(${row.id}::int, ${JSON.stringify(cleanEvents)}::jsonb, ${cleanRedH}::int, ${cleanRedA}::int)`
      );
    }
  }
  if (eventFixTuples.length > 0) {
    await db.execute(sql`
      UPDATE "matches" AS m
      SET
        "events" = v.events,
        "red_home" = v.red_home,
        "red_away" = v.red_away
      FROM (VALUES ${sql.join(eventFixTuples, sql`, `)}) AS v(id, events, red_home, red_away)
      WHERE m."id" = v.id
    `);
  }

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
      "idempotency_key" text,
      "cashout_idempotency_key" text,
      "placed_at" timestamp DEFAULT now() NOT NULL
    );
  `);

  await db.execute(sql`
    ALTER TABLE "bets" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
    ALTER TABLE "bets" ADD COLUMN IF NOT EXISTS "cashout_idempotency_key" text;
    ALTER TABLE "prediction_bets" ADD COLUMN IF NOT EXISTS "cash_out_amount" double precision;
    ALTER TABLE "prediction_bets" ADD COLUMN IF NOT EXISTS "settled_at" timestamp;
    ALTER TABLE "prediction_bets" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
    ALTER TABLE "prediction_bets" ADD COLUMN IF NOT EXISTS "cashout_idempotency_key" text;
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
      "idempotency_key" text,
      "cashout_idempotency_key" text,
      "placed_at" timestamp DEFAULT now() NOT NULL,
      "settled_at" timestamp
    );
    ALTER TABLE "combo_bets" ADD COLUMN IF NOT EXISTS "settled_at" timestamp;
    ALTER TABLE "combo_bets" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
    ALTER TABLE "combo_bets" ADD COLUMN IF NOT EXISTS "cashout_idempotency_key" text;
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
      "idempotency_key" text,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "processed_at" timestamp
    );
    ALTER TABLE "withdrawals" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "idempotency_keys" (
      "user_id" integer NOT NULL,
      "scope" text NOT NULL,
      "idempotency_key" text NOT NULL,
      "request_hash" text NOT NULL,
      "status" text DEFAULT 'completed' NOT NULL,
      "status_code" integer DEFAULT 200 NOT NULL,
      "response_body" jsonb NOT NULL,
      "expires_at" timestamp DEFAULT (now() + interval '24 hours') NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "idempotency_keys_pk" PRIMARY KEY ("user_id", "scope", "idempotency_key")
    );
    ALTER TABLE "idempotency_keys"
      ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'completed' NOT NULL;
    ALTER TABLE "idempotency_keys"
      ADD COLUMN IF NOT EXISTS "expires_at" timestamp DEFAULT (now() + interval '24 hours') NOT NULL;
    ALTER TABLE "idempotency_keys"
      ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
    UPDATE "idempotency_keys"
      SET "status" = 'processing',
          "expires_at" = "created_at" + interval '45 seconds'
      WHERE ("response_body"->>'__pending') = 'true' AND "status" <> 'processing';
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'idempotency_keys_status_chk'
      ) THEN
        ALTER TABLE "idempotency_keys"
          ADD CONSTRAINT "idempotency_keys_status_chk"
          CHECK ("status" IN ('processing', 'completed'));
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS "webhook_events" (
      "provider" text NOT NULL,
      "event_id" text NOT NULL,
      "event_type" text NOT NULL,
      "object_id" text,
      "processed_at" timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "webhook_events_pk" PRIMARY KEY ("provider", "event_id")
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

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "ml_models" (
      "model_key" text PRIMARY KEY NOT NULL,
      "version" integer DEFAULT 1 NOT NULL,
      "samples_count" integer DEFAULT 0 NOT NULL,
      "brier_score" double precision DEFAULT 0.21 NOT NULL,
      "log_loss" double precision DEFAULT 0.61 NOT NULL,
      "state" jsonb NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
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
      "idempotency_key" text,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    );
    ALTER TABLE "deposits" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
  `);

  // ──────────────────────────────────────────────────────────────────────────
  //  Suite complète d'index B-tree composites & partiels (Zéro Seq Scan)
  //  Exécutée en 1 seul lot DDL pour éliminer tout scan séquentiel PostgreSQL
  //  sur les lectures temps réel, les règlements groupés et les agrégations 24h.
  // ──────────────────────────────────────────────────────────────────────────
  await db.execute(sql`
    -- Matchs (actifs, historique paginé, synchro externe ESPN)
    CREATE INDEX IF NOT EXISTS "matches_active_idx"
      ON "matches" ("source", "starts_at" ASC, "id" DESC)
      WHERE "status" <> 'finished';
    CREATE INDEX IF NOT EXISTS "matches_finished_source_idx"
      ON "matches" ("source", "finished_at" DESC NULLS LAST, "id" DESC)
      WHERE "status" = 'finished';
    CREATE INDEX IF NOT EXISTS "matches_live_idx"
      ON "matches" ("id")
      WHERE "status" = 'live';

    -- Paris sportifs simples (règlements partiels O(1), jointure match_id, historique parieur, fenêtre 24h)
    CREATE INDEX IF NOT EXISTS "bets_pending_match_idx"
      ON "bets" ("match_id")
      WHERE "status" = 'pending';
    CREATE INDEX IF NOT EXISTS "bets_match_id_idx"
      ON "bets" ("match_id")
      WHERE "match_id" IS NOT NULL;
    CREATE INDEX IF NOT EXISTS "bets_user_settled_idx"
      ON "bets" ("user_id", "status", "settled_at" DESC NULLS LAST, "placed_at" DESC);
    CREATE INDEX IF NOT EXISTS "bets_user_id_desc_idx"
      ON "bets" ("user_id", "id" DESC);
    CREATE INDEX IF NOT EXISTS "bets_placed_at_idx"
      ON "bets" ("placed_at" DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS "bets_user_idem_uniq"
      ON "bets" ("user_id", "idempotency_key")
      WHERE "idempotency_key" IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "bets_user_cashout_idem_uniq"
      ON "bets" ("user_id", "cashout_idempotency_key")
      WHERE "cashout_idempotency_key" IS NOT NULL;

    -- Questions & paris de prédictions (questions ouvertes/échues, règlements partiels, parieur, 24h)
    CREATE INDEX IF NOT EXISTS "pred_questions_status_resolves_idx"
      ON "prediction_questions" ("status", "resolves_at" ASC, "id" DESC);
    CREATE INDEX IF NOT EXISTS "pred_questions_cat_status_idx"
      ON "prediction_questions" ("category", "status", "resolves_at" ASC);
    CREATE INDEX IF NOT EXISTS "pred_bets_pending_question_idx"
      ON "prediction_bets" ("question_id")
      WHERE "status" = 'pending';
    CREATE INDEX IF NOT EXISTS "pred_bets_user_question_idx"
      ON "prediction_bets" ("user_id", "question_id");
    CREATE INDEX IF NOT EXISTS "pred_bets_user_status_idx"
      ON "prediction_bets" ("user_id", "status", "settled_at" DESC NULLS LAST, "placed_at" DESC);
    CREATE INDEX IF NOT EXISTS "pred_bets_placed_at_idx"
      ON "prediction_bets" ("placed_at" DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS "pred_bets_user_idem_uniq"
      ON "prediction_bets" ("user_id", "idempotency_key")
      WHERE "idempotency_key" IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "pred_bets_user_cashout_idem_uniq"
      ON "prediction_bets" ("user_id", "cashout_idempotency_key")
      WHERE "cashout_idempotency_key" IS NOT NULL;

    -- Paris combinés (index partiel sur les tickets ayant encore >= 1 sélection ouverte, parieur, 24h)
    CREATE INDEX IF NOT EXISTS "combo_bets_open_legs_idx"
      ON "combo_bets" ("id")
      WHERE "status" = 'pending' OR "legs" @> '[{"status":"pending"}]'::jsonb;
    CREATE INDEX IF NOT EXISTS "combo_bets_pending_idx"
      ON "combo_bets" ("id")
      WHERE "status" = 'pending';
    CREATE INDEX IF NOT EXISTS "combo_bets_user_status_idx"
      ON "combo_bets" ("user_id", "status", "settled_at" DESC NULLS LAST, "placed_at" DESC);
    CREATE INDEX IF NOT EXISTS "combo_bets_placed_at_idx"
      ON "combo_bets" ("placed_at" DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS "combo_bets_user_idem_uniq"
      ON "combo_bets" ("user_id", "idempotency_key")
      WHERE "idempotency_key" IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "combo_bets_user_cashout_idem_uniq"
      ON "combo_bets" ("user_id", "cashout_idempotency_key")
      WHERE "cashout_idempotency_key" IS NOT NULL;

    -- Portefeuille, dépôts, retraits, idempotence, jeux & ajustements (historiques paginés + agrégation House Brain 24h)
    CREATE INDEX IF NOT EXISTS "deposits_user_created_idx"
      ON "deposits" ("user_id", "created_at" DESC);
    CREATE INDEX IF NOT EXISTS "deposits_status_created_idx"
      ON "deposits" ("status", "created_at" DESC);
    CREATE INDEX IF NOT EXISTS "deposits_provider_ref_idx"
      ON "deposits" ("provider_ref");
    DELETE FROM "deposits"
    WHERE "id" IN (
      SELECT "id"
      FROM (
        SELECT
          "id",
          ROW_NUMBER() OVER (
            PARTITION BY "provider", "provider_ref"
            ORDER BY CASE WHEN "status" = 'credited' THEN 0 ELSE 1 END, "id" ASC
          ) AS rn
        FROM "deposits"
      ) ranked
      WHERE ranked.rn > 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "deposits_provider_ref_uniq"
      ON "deposits" ("provider", "provider_ref");
    CREATE UNIQUE INDEX IF NOT EXISTS "deposits_user_idem_uniq"
      ON "deposits" ("user_id", "idempotency_key")
      WHERE "idempotency_key" IS NOT NULL;
    CREATE INDEX IF NOT EXISTS "withdrawals_user_created_idx"
      ON "withdrawals" ("user_id", "created_at" DESC);
    CREATE INDEX IF NOT EXISTS "withdrawals_pending_idx"
      ON "withdrawals" ("created_at" DESC)
      WHERE "status" = 'pending';
    CREATE UNIQUE INDEX IF NOT EXISTS "withdrawals_user_idem_uniq"
      ON "withdrawals" ("user_id", "idempotency_key")
      WHERE "idempotency_key" IS NOT NULL;
    CREATE INDEX IF NOT EXISTS "idempotency_keys_created_idx"
      ON "idempotency_keys" ("created_at");
    CREATE INDEX IF NOT EXISTS "idempotency_keys_expires_idx"
      ON "idempotency_keys" ("expires_at");
    CREATE INDEX IF NOT EXISTS "webhook_events_processed_idx"
      ON "webhook_events" ("processed_at" DESC);
    CREATE INDEX IF NOT EXISTS "wallet_adj_user_created_idx"
      ON "wallet_adjustments" ("user_id", "created_at" DESC);
    CREATE INDEX IF NOT EXISTS "tap_history_user_created_idx"
      ON "tap_history" ("user_id", "created_at" DESC);
    CREATE INDEX IF NOT EXISTS "tap_history_created_idx"
      ON "tap_history" ("created_at" DESC);
    CREATE INDEX IF NOT EXISTS "accel_rounds_user_id_idx"
      ON "accelerator_rounds" ("user_id", "id" DESC);
    CREATE INDEX IF NOT EXISTS "accel_rounds_active_idx"
      ON "accelerator_rounds" ("last_ms")
      WHERE "status" = 'active';
    CREATE INDEX IF NOT EXISTS "accel_rounds_started_idx"
      ON "accelerator_rounds" ("started_at" DESC);
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
        { key: "ferran_torres", label: "Ferran Torres", odds: 3.3 },
        { key: "amine_gouiri", label: "Amine Gouiri", odds: 4.4 },
        { key: "lois_openda", label: "Loïs Openda", odds: 5.0 },
        { key: "khvicha_kvaratskhelia", label: "Khvicha Kvaratskhelia", odds: 6.5 },
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

  const existingQuestionRows = await db
    .select({ question: predictionQuestions.question })
    .from(predictionQuestions);
  const existingTitlesSet = new Set(
    existingQuestionRows.map((r) => r.question.trim().toLowerCase())
  );

  const missingQuestions: Array<typeof predictionQuestions.$inferInsert> = [];
  for (const q of questionsSeed) {
    const normTitle = q.question.trim().toLowerCase();
    if (!existingTitlesSet.has(normTitle)) {
      existingTitlesSet.add(normTitle);
      const { question, category, status, seedValue, oddsYes, oddsNo, volume, yesCount, noCount, resolvesAt } = q;
      const options = "options" in q ? q.options : undefined;
      const resolution = "resolution" in q ? q.resolution : undefined;
      const resolvedAt = "resolvedAt" in q ? q.resolvedAt : undefined;
      missingQuestions.push({
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
      });
    }
  }

  if (missingQuestions.length > 0) {
    const insertedQuestions = await db
      .insert(predictionQuestions)
      .values(missingQuestions)
      .onConflictDoNothing()
      .returning();

    if (freshDb) {
      const demoPredBets: Array<typeof predictionBets.$inferInsert> = [];
      let demoBonusCount = 0;
      for (const inserted of insertedQuestions) {
        if (inserted.status === "resolved") {
          demoBonusCount++;
          demoPredBets.push(
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
            }
          );
        }
      }
      if (demoPredBets.length > 0) {
        await db.insert(predictionBets).values(demoPredBets);
        await db
          .update(appUser)
          .set({ balance: sql`${appUser.balance} + ${demoBonusCount * 8}` })
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

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "saved_coupons" (
      "code" text PRIMARY KEY NOT NULL,
      "legs" jsonb NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
  `);

  await db
    .insert(adminSettings)
    .values({
      settingKey: SCHEMA_SEED_MARKER_KEY,
      value: { ready: true, version: SCHEMA_SEED_MARKER_KEY },
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: adminSettings.settingKey,
      set: {
        value: { ready: true, version: SCHEMA_SEED_MARKER_KEY },
        updatedAt: new Date(),
      },
    });
}
