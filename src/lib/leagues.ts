/**
 * Base de données des ligues réelles et de leurs clubs (pour l'admin).
 * Utilisée pour pré-remplir les champs « Ligue » et « Équipe » lors de
 * l'ajout manuel d'un match : choisir la Liga filtre les clubs proposés.
 * Logo = URL du CDN API-Sports (même source que src/lib/team-logos.ts) ;
 * en cas d'échec de chargement, l'avatar monogramme prend le relais.
 */

export interface LeagueClub {
  name: string;
  logo: string | null;
}

export interface LeagueDef {
  id: string;
  name: string;
  country: string;
  clubs: LeagueClub[];
}

const T = (id: string) => `https://media.api-sports.io/football/teams/${id}.png`;

export const LEAGUES: LeagueDef[] = [
  {
    id: "liga",
    name: "Liga",
    country: "Espagne",
    clubs: [
      { name: "Real Madrid", logo: T("541") },
      { name: "FC Barcelone", logo: T("529") },
      { name: "Atlético Madrid", logo: T("530") },
      { name: "FC Séville", logo: T("536") },
      { name: "Valence", logo: T("532") },
      { name: "Villarreal", logo: T("533") },
      { name: "Real Betis", logo: T("543") },
      { name: "Athletic Bilbao", logo: T("531") },
      { name: "Real Sociedad", logo: T("548") },
      { name: "Celta Vigo", logo: T("538") },
      { name: "Gérone", logo: T("547") },
      { name: "CA Osasuna", logo: T("727") },
    ],
  },
  {
    id: "premier-league",
    name: "Premier League",
    country: "Angleterre",
    clubs: [
      { name: "Manchester City", logo: T("50") },
      { name: "Arsenal", logo: T("42") },
      { name: "Liverpool", logo: T("40") },
      { name: "Chelsea", logo: T("49") },
      { name: "Manchester United", logo: T("33") },
      { name: "Tottenham", logo: T("47") },
      { name: "Newcastle", logo: T("34") },
      { name: "Aston Villa", logo: T("66") },
      { name: "West Ham", logo: T("48") },
      { name: "Everton", logo: T("45") },
      { name: "Brighton", logo: T("51") },
      { name: "Brentford", logo: T("55") },
      { name: "Crystal Palace", logo: T("52") },
      { name: "Fulham", logo: T("36") },
    ],
  },
  {
    id: "ligue-1",
    name: "Ligue 1",
    country: "France",
    clubs: [
      { name: "Paris SG", logo: T("85") },
      { name: "Marseille", logo: T("81") },
      { name: "Lyon", logo: T("80") },
      { name: "Monaco", logo: T("91") },
      { name: "Nice", logo: T("84") },
      { name: "Lille", logo: T("79") },
      { name: "Rennes", logo: T("94") },
      { name: "Lens", logo: T("116") },
      { name: "Toulouse", logo: T("96") },
      { name: "Nantes", logo: T("83") },
      { name: "Strasbourg", logo: T("98") },
      { name: "Reims", logo: T("93") },
      { name: "Brest", logo: T("95") },
    ],
  },
  {
    id: "bundesliga",
    name: "Bundesliga",
    country: "Allemagne",
    clubs: [
      { name: "Bayern Munich", logo: T("157") },
      { name: "Dortmund", logo: T("165") },
      { name: "RB Leipzig", logo: T("173") },
      { name: "Leverkusen", logo: T("168") },
      { name: "Eintracht Francfort", logo: T("169") },
      { name: "Wolfsburg", logo: T("161") },
      { name: "Mönchengladbach", logo: T("163") },
      { name: "Stuttgart", logo: T("172") },
      { name: "Fribourg", logo: T("160") },
      { name: "Hoffenheim", logo: T("167") },
      { name: "Werder Brême", logo: T("162") },
      { name: "Augsbourg", logo: T("170") },
    ],
  },
  {
    id: "serie-a",
    name: "Serie A",
    country: "Italie",
    clubs: [
      { name: "Inter Milan", logo: T("505") },
      { name: "Juventus", logo: T("496") },
      { name: "AC Milan", logo: T("489") },
      { name: "Naples", logo: T("492") },
      { name: "AS Rome", logo: T("497") },
      { name: "Latium", logo: T("487") },
      { name: "Atalanta", logo: T("499") },
      { name: "Fiorentina", logo: T("502") },
      { name: "Bologne", logo: T("500") },
      { name: "Turin", logo: T("503") },
      { name: "Genoa", logo: T("495") },
    ],
  },
  {
    id: "europa",
    name: "Ligue des Champions · Europe",
    country: "Europe",
    clubs: [
      { name: "Paris SG", logo: T("85") },
      { name: "Manchester City", logo: T("50") },
      { name: "Real Madrid", logo: T("541") },
      { name: "Bayern Munich", logo: T("157") },
      { name: "Liverpool", logo: T("40") },
      { name: "Arsenal", logo: T("42") },
      { name: "Inter Milan", logo: T("505") },
      { name: "FC Barcelone", logo: T("529") },
      { name: "Marseille", logo: T("81") },
      { name: "Toulouse", logo: T("96") },
    ],
  },
];

const LEAGUE_BY_NAME = new Map<string, LeagueDef>();
for (const league of LEAGUES) {
  LEAGUE_BY_NAME.set(league.name.toLowerCase(), league);
}

/** Résout une ligue par son nom saisi (normalisé) ou null. */
export function findLeague(name: string): LeagueDef | null {
  const key = name.trim().toLowerCase();
  return LEAGUE_BY_NAME.get(key) ?? null;
}

/** Logo d'un club dans une ligue donnée (null si inconnu). */
export function clubLogo(league: LeagueDef, clubName: string): string | null {
  return league.clubs.find((c) => c.name === clubName)?.logo ?? null;
}