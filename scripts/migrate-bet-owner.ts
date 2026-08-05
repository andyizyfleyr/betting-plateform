import { sql } from "drizzle-orm";
import { db } from "../src/db";

/**
 * Migration idempotente : isole les paris par utilisateur.
 * Ajoute user_id à la table bets (les paris existants reviennent à l'utilisateur 1).
 */
async function main() {
  await db.execute(sql`
    ALTER TABLE bets
      ADD COLUMN IF NOT EXISTS user_id integer NOT NULL DEFAULT 1;
  `);
  console.log("Migration OK");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  });
