import { getTableColumns, sql } from "drizzle-orm";
import { matches, type MatchRow } from "@/db/schema";

// Colonnes complètes pour les contextes d'administration ou d'écriture
export const fullHydrationColumns = getTableColumns(matches);

// Pour les matchs actifs (live et à venir) : tickHistory n'est jamais transféré
// de Neon puisqu'il est géré en RAM et masqué aux clients. Économise jusqu'à 50 Ko par match.
export const activeMatchHydrationColumns = {
  ...fullHydrationColumns,
  tickHistory: sql<MatchRow["tickHistory"]>`'[]'::jsonb`,
};

// Pour les matchs réels terminés : marchés (inutilisés puisque le match est clos),
// tickHistory et scriptedEvents sont projetés à NULL/vide pour minimiser le transfert Neon.
export const finishedRealHydrationColumns = {
  ...fullHydrationColumns,
  markets: sql<MatchRow["markets"]>`NULL::jsonb`,
  tickHistory: sql<MatchRow["tickHistory"]>`'[]'::jsonb`,
  scriptedEvents: sql<MatchRow["scriptedEvents"]>`NULL::jsonb`,
};

// Pour les matchs virtuels terminés : omet également les statistiques réelles
// (toujours nulles sur les virtuels) en plus des marchés, ticks et scripts.
export const finishedVirtualHydrationColumns = {
  ...finishedRealHydrationColumns,
  realStats: sql<MatchRow["realStats"]>`NULL::jsonb`,
};
