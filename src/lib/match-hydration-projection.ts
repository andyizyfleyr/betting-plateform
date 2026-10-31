import { getTableColumns, sql } from "drizzle-orm";
import { matches, type MatchRow } from "@/db/schema";

// Le moteur et les paris actifs conservent toujours la ligne complète.
export const fullHydrationColumns = getTableColumns(matches);

// Pour les matchs réels terminés seulement : ces deux champs internes ne sont
// ni exposés par l'API ni utilisés pour calculer les marchés/statistiques réels.
// La base reste intacte ; scores, événements, statistiques et marchés sont lus.
export const finishedRealHydrationColumns = {
  ...fullHydrationColumns,
  tickHistory: sql<MatchRow["tickHistory"]>`'[]'::jsonb`,
  scriptedEvents: sql<MatchRow["scriptedEvents"]>`NULL::jsonb`,
};
