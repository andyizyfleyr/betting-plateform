import { config } from "dotenv";
config({ path: ".env.local" });
import { sql } from "drizzle-orm";
import { db } from "../src/db";

/**
 * Migration idempotente : ajout des colonnes pour le modèle live avancé.
 * - last_goal_at (déjà ajoutée par migration précédente, IF NOT EXISTS)
 * - red_home / red_away (cartons rouges)
 * - events (journal d'événements match)
 * - tick_history (mouvements de cote)
 * - regime (ouvert / fermé / équilibré)
 * - home_form / away_form (facteurs de forme EWMA)
 * - asian_handicap_line (ligne de handicap asiatique courante)
 */
async function main() {
  await db.execute(sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS red_home integer NOT NULL DEFAULT 0`);
  await db.execute(sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS red_away integer NOT NULL DEFAULT 0`);
  await db.execute(sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS events jsonb DEFAULT '[]'`);
  await db.execute(sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS tick_history jsonb DEFAULT '[]'`);
  await db.execute(sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS regime text NOT NULL DEFAULT 'balanced'`);
  await db.execute(sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS home_form double precision NOT NULL DEFAULT 1`);
  await db.execute(sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS away_form double precision NOT NULL DEFAULT 1`);
  await db.execute(sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS asian_handicap_line double precision`);
  await db.execute(sql`ALTER TABLE bets ADD COLUMN IF NOT EXISTS payout_multiplier double precision NOT NULL DEFAULT 1`);
  await db.execute(sql`ALTER TABLE bets ADD COLUMN IF NOT EXISTS stake_returned double precision NOT NULL DEFAULT 0`);
  console.log("Migration OK : colonnes avancées ajoutées à matches et bets.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  });
