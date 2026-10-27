export interface OfficialSoccerLeague {
  slug: string;
  label: string;
  country: string;
  aliases: string[];
}

/**
 * Catalogue des compétitions officielles prises en charge gratuitement via le flux JSON public ESPN
 * (aucune clé API ni abonnement requis).
 */
export const OFFICIAL_SOCCER_LEAGUES: OfficialSoccerLeague[] = [
  {
    slug: "uefa.champions",
    label: "Ligue des Champions",
    country: "UEFA",
    aliases: ["champions league", "uefa champions league", "ucl", "ligue des champions", "c1"],
  },
  {
    slug: "uefa.europa",
    label: "Ligue Europa",
    country: "UEFA",
    aliases: ["europa league", "uefa europa league", "uel", "ligue europa", "c3"],
  },
  {
    slug: "uefa.europa.conf",
    label: "Conference League",
    country: "UEFA",
    aliases: ["europa conference league", "conference league", "uecl", "ligue conference"],
  },
  {
    slug: "eng.1",
    label: "Premier League",
    country: "Angleterre",
    aliases: ["premier league", "english premier league", "epl", "angleterre"],
  },
  {
    slug: "fra.1",
    label: "Ligue 1",
    country: "France",
    aliases: ["ligue 1", "french ligue 1", "ligue 1 mcdonald's", "ligue 1 uber eats"],
  },
  {
    slug: "esp.1",
    label: "LaLiga",
    country: "Espagne",
    aliases: ["laliga", "la liga", "liga", "primera division", "spanish laliga"],
  },
  {
    slug: "ita.1",
    label: "Serie A",
    country: "Italie",
    aliases: ["serie a", "italian serie a", "calcio"],
  },
  {
    slug: "ger.1",
    label: "Bundesliga",
    country: "Allemagne",
    aliases: ["bundesliga", "german bundesliga"],
  },
  {
    slug: "por.1",
    label: "Liga Portugal",
    country: "Portugal",
    aliases: ["liga portugal", "primeira liga", "portuguese liga"],
  },
  {
    slug: "ned.1",
    label: "Eredivisie",
    country: "Pays-Bas",
    aliases: ["eredivisie", "dutch eredivisie"],
  },
  {
    slug: "tur.1",
    label: "Süper Lig",
    country: "Turquie",
    aliases: ["super lig", "süper lig", "turkish super lig"],
  },
  {
    slug: "bel.1",
    label: "Pro League",
    country: "Belgique",
    aliases: ["pro league", "jupiler pro league", "belgian pro league"],
  },
  {
    slug: "eng.fa",
    label: "FA Cup",
    country: "Angleterre",
    aliases: ["fa cup", "english fa cup"],
  },
  {
    slug: "esp.copa_del_rey",
    label: "Copa del Rey",
    country: "Espagne",
    aliases: ["copa del rey", "coupe du roi"],
  },
  {
    slug: "caf.nations",
    label: "CAN",
    country: "Afrique",
    aliases: ["can", "coupe d'afrique", "afcon", "africa cup of nations"],
  },
  {
    slug: "caf.champions",
    label: "Ligue des Champions CAF",
    country: "Afrique",
    aliases: ["caf champions league", "ligue des champions caf"],
  },
  {
    slug: "uefa.nations",
    label: "Ligue des Nations",
    country: "UEFA",
    aliases: ["nations league", "uefa nations league", "ligue des nations"],
  },
  {
    slug: "fifa.world",
    label: "Coupe du Monde",
    country: "FIFA",
    aliases: ["world cup", "fifa world cup", "coupe du monde"],
  },
  {
    slug: "ksa.1",
    label: "Saudi Pro League",
    country: "Arabie Saoudite",
    aliases: ["saudi pro league", "roshn saudi league"],
  },
  {
    slug: "usa.1",
    label: "MLS",
    country: "États-Unis",
    aliases: ["mls", "major league soccer"],
  },
];

export const TOP_DISCOVERY_LEAGUE_SLUGS = [
  "uefa.champions",
  "uefa.europa",
  "eng.1",
  "fra.1",
  "esp.1",
  "ita.1",
  "ger.1",
] as const;

export function resolveEspnSlugForLeague(leagueNameOrSlug: string | null | undefined): string | null {
  if (!leagueNameOrSlug) return null;
  const norm = leagueNameOrSlug
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!norm) return null;

  const bySlug = OFFICIAL_SOCCER_LEAGUES.find((l) => l.slug === norm);
  if (bySlug) return bySlug.slug;

  for (const lg of OFFICIAL_SOCCER_LEAGUES) {
    const labelNorm = lg.label
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (labelNorm === norm) return lg.slug;
    for (const al of lg.aliases) {
      const alNorm = al
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      if (alNorm === norm || norm.includes(alNorm)) return lg.slug;
    }
  }
  return null;
}

export function officialLeagueLabel(slug: string, fallback = "Football"): string {
  return OFFICIAL_SOCCER_LEAGUES.find((l) => l.slug === slug)?.label ?? fallback;
}

export function resolveRealLeagueBySlug(
  availableLeagues: string[],
  slug: string
): string | null {
  for (const lg of availableLeagues) {
    if (resolveEspnSlugForLeague(lg) === slug) return lg;
  }
  return null;
}

export function sortRealLeaguesByPriority(leagues: string[]): string[] {
  const rankOf = (name: string): number => {
    const slug = resolveEspnSlugForLeague(name);
    if (!slug) return 999;
    const idx = OFFICIAL_SOCCER_LEAGUES.findIndex((l) => l.slug === slug);
    return idx === -1 ? 999 : idx;
  };
  return [...leagues].sort(
    (a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b, "fr")
  );
}
