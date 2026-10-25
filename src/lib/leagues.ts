/**
 * Base de données des ligues réelles et de leurs clubs (pour l'administration).
 * Utilisée pour pré-remplir les champs « Championnat » et « Équipe » lors de
 * l'ajout manuel d'un match. Tous les blasons proviennent désormais du résolveur
 * multi-CDN `teamLogo()` (zéro miniature Wikimedia fragile).
 */

import { teamLogo } from "@/lib/team-logos";

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

function makeClubs(names: string[]): LeagueClub[] {
  return names.map((name) => ({
    name,
    logo: teamLogo(name),
  }));
}

export const LEAGUES: LeagueDef[] = [
  {
    id: "liga",
    name: "Liga",
    country: "Espagne",
    clubs: makeClubs([
      "Alavés",
      "Athletic Bilbao",
      "Atlético Madrid",
      "FC Barcelone",
      "Celta Vigo",
      "Deportivo",
      "Elche",
      "Espanyol",
      "Getafe",
      "Gérone",
      "Las Palmas",
      "Leganés",
      "Levante",
      "RCD Majorque",
      "Málaga",
      "CA Osasuna",
      "Racing Santander",
      "Rayo Vallecano",
      "Real Betis",
      "Real Madrid",
      "Real Oviedo",
      "Real Sociedad",
      "Real Valladolid",
      "FC Séville",
      "Valence",
      "Villarreal",
    ]),
  },
  {
    id: "ligue-1",
    name: "Ligue 1",
    country: "France",
    clubs: makeClubs([
      "Angers",
      "Auxerre",
      "Brest",
      "Le Havre",
      "Le Mans",
      "Lens",
      "Lille",
      "Lorient",
      "Lyon",
      "Marseille",
      "Metz",
      "Monaco",
      "Montpellier",
      "Nantes",
      "Nice",
      "Paris FC",
      "Paris SG",
      "Reims",
      "Rennes",
      "Saint-Étienne",
      "Strasbourg",
      "Toulouse",
      "Troyes",
    ]),
  },
  {
    id: "premier-league",
    name: "Premier League",
    country: "Angleterre",
    clubs: makeClubs([
      "Arsenal",
      "Aston Villa",
      "Bournemouth",
      "Brentford",
      "Brighton",
      "Burnley",
      "Chelsea",
      "Coventry City",
      "Crystal Palace",
      "Everton",
      "Fulham",
      "Hull City",
      "Ipswich Town",
      "Leeds United",
      "Leicester City",
      "Liverpool",
      "Manchester City",
      "Manchester United",
      "Newcastle",
      "Nottingham Forest",
      "Southampton",
      "Sunderland",
      "Tottenham",
      "West Ham",
      "Wolverhampton",
    ]),
  },
  {
    id: "bundesliga",
    name: "Bundesliga",
    country: "Allemagne",
    clubs: makeClubs([
      "Augsbourg",
      "Bayern Munich",
      "Bochum",
      "FC Cologne",
      "Dortmund",
      "Eintracht Francfort",
      "SV Elversberg",
      "Fribourg",
      "Hamburg SV",
      "Heidenheim",
      "Hoffenheim",
      "Holstein Kiel",
      "RB Leipzig",
      "Leverkusen",
      "Mainz 05",
      "Mönchengladbach",
      "SC Paderborn 07",
      "Schalke 04",
      "St. Pauli",
      "Stuttgart",
      "Union Berlin",
      "Werder Brême",
      "Wolfsburg",
    ]),
  },
  {
    id: "serie-a",
    name: "Serie A",
    country: "Italie",
    clubs: makeClubs([
      "Atalanta",
      "Bologne",
      "Cagliari",
      "Côme",
      "Cremonese",
      "Empoli",
      "Fiorentina",
      "Frosinone",
      "Genoa",
      "Hellas Vérone",
      "Inter Milan",
      "Juventus",
      "Latium",
      "Lecce",
      "AC Milan",
      "Monza",
      "Naples",
      "Parme",
      "Pisa",
      "AS Rome",
      "Sassuolo",
      "Turin",
      "Udinese",
      "Venise",
    ]),
  },
  {
    id: "champions-league",
    name: "Ligue des Champions",
    country: "Europe",
    clubs: makeClubs([
      "Paris SG",
      "Aston Villa",
      "Arsenal",
      "Manchester City",
      "Manchester United",
      "Liverpool",
      "Inter Milan",
      "AC Milan",
      "Juventus",
      "Naples",
      "AS Rome",
      "Côme",
      "FC Barcelone",
      "Real Madrid",
      "Atlético Madrid",
      "Villarreal",
      "Real Betis",
      "Bayern Munich",
      "Dortmund",
      "Leverkusen",
      "RB Leipzig",
      "Stuttgart",
      "Lens",
      "Lille",
      "Ajax",
      "PSV Eindhoven",
      "Feyenoord",
      "AZ Alkmaar",
      "Benfica",
      "FC Porto",
      "Sporting CP",
      "Club Brugge",
      "Union St.-Gilloise",
      "Anderlecht",
      "Celtic",
      "Rangers",
      "Galatasaray",
      "Fenerbahçe",
      "Besiktas",
      "Olympiacos",
      "AEK Athens",
      "Slavia Prague",
      "Sparta Prague",
      "RB Salzburg",
      "SK Sturm Graz",
      "LASK Linz",
      "Dinamo Zagreb",
      "Bodo/Glimt",
      "Ferencvaros",
      "Slovan Bratislava",
      "Chakhtar Donetsk",
    ]),
  },
];

const LEAGUE_BY_NAME = new Map<string, LeagueDef>();
for (const league of LEAGUES) {
  LEAGUE_BY_NAME.set(league.name.toLowerCase(), league);
}
// Alias usuels ESPN / 1xBet
const laliga = LEAGUES.find((l) => l.id === "liga");
if (laliga) {
  LEAGUE_BY_NAME.set("laliga", laliga);
  LEAGUE_BY_NAME.set("la liga", laliga);
}
const ucl = LEAGUES.find((l) => l.id === "champions-league");
if (ucl) {
  LEAGUE_BY_NAME.set("uefa champions league", ucl);
  LEAGUE_BY_NAME.set("ligue europa", ucl);
  LEAGUE_BY_NAME.set("uefa europa league", ucl);
}

/** Résout une ligue par son nom saisi (normalisé) ou null. */
export function findLeague(name: string): LeagueDef | null {
  const key = name.trim().toLowerCase().split("·")[0]?.trim() ?? "";
  return LEAGUE_BY_NAME.get(key) ?? null;
}

/** Logo d'un club dans une ligue donnée (avec repli sur le catalogue global). */
export function clubLogo(league: LeagueDef, clubName: string): string | null {
  return league.clubs.find((c) => c.name === clubName)?.logo ?? teamLogo(clubName);
}
