import { sql } from "drizzle-orm";
import { db } from "../src/db";

/**
 * Migration virtuelle : purge les anciens matchs/paris aléatoires de l'ancien moteur
 * et remet l'horloge du moteur à zéro, pour repartir sur le tournoi virtuel (journée 0).
 * Les prochaines routes API reseederont automatiquement via ensureSeeded().
 */
async function main() {
  await db.execute(sql`DELETE FROM bets;`);
  await db.execute(sql`DELETE FROM matches;`);
  await db.execute(sql`DELETE FROM sim_state;`);
  console.log("Migration OK : anciens matchs/paris purgés, moteur réinitialisé.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  });
