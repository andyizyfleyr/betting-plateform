import { sql } from "drizzle-orm";
import { db } from "../src/db";

/**
 * Migration idempotente pour l'authentification : ajoute
 * email / password_hash / created_at à la table app_user.
 */
async function main() {
  await db.execute(sql`
    ALTER TABLE app_user
      ADD COLUMN IF NOT EXISTS email text UNIQUE,
      ADD COLUMN IF NOT EXISTS password_hash text,
      ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();
  `);
  console.log("Migration OK");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  });
