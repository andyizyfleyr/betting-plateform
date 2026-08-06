import { sql } from "drizzle-orm";
import { db } from "../src/db";

/**
 * Migration idempotente : blocage des marchés 3 s après un but.
 * Ajoute last_goal_at (horodatage réel du dernier but) à la table matches.
 */
async function main() {
  await db.execute(sql`
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS last_goal_at timestamp;
  `);
  console.log("Migration OK : colonne last_goal_at ajoutée à matches.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  });
