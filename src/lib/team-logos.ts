/**
 * Logos officiels des clubs de football (CDN API-Sports PNG haute fiabilité).
 * En cas d'équipe absente ou d'erreur réseau, TeamAvatar bascule automatiquement
 * sur l'URL secondaire puis sur l'écusson monogramme du club.
 */
const LOGO_BY_TEAM: Record<string, string> = {
  // Ligue 1
  "Paris SG": "https://media.api-sports.io/football/teams/85.png",
  Marseille: "https://media.api-sports.io/football/teams/81.png",
  Lyon: "https://media.api-sports.io/football/teams/80.png",
  Monaco: "https://media.api-sports.io/football/teams/91.png",
  Lille: "https://media.api-sports.io/football/teams/79.png",
  Nice: "https://media.api-sports.io/football/teams/84.png",
  Lens: "https://media.api-sports.io/football/teams/116.png",
  Rennes: "https://media.api-sports.io/football/teams/94.png",
  Brest: "https://media.api-sports.io/football/teams/106.png",
  Strasbourg: "https://media.api-sports.io/football/teams/95.png",
  Toulouse: "https://media.api-sports.io/football/teams/96.png",
  Nantes: "https://media.api-sports.io/football/teams/83.png",
  Reims: "https://media.api-sports.io/football/teams/93.png",
  Montpellier: "https://media.api-sports.io/football/teams/82.png",
  Auxerre: "https://media.api-sports.io/football/teams/108.png",
  Angers: "https://media.api-sports.io/football/teams/77.png",
  "Le Havre": "https://media.api-sports.io/football/teams/111.png",
  "Saint-Étienne": "https://media.api-sports.io/football/teams/1063.png",

  // Premier League
  Arsenal: "https://media.api-sports.io/football/teams/42.png",
  "Manchester City": "https://media.api-sports.io/football/teams/50.png",
  Liverpool: "https://media.api-sports.io/football/teams/40.png",
  Chelsea: "https://media.api-sports.io/football/teams/49.png",
  "Aston Villa": "https://media.api-sports.io/football/teams/66.png",
  Tottenham: "https://media.api-sports.io/football/teams/47.png",
  Newcastle: "https://media.api-sports.io/football/teams/34.png",
  "Manchester United": "https://media.api-sports.io/football/teams/33.png",
  Brighton: "https://media.api-sports.io/football/teams/51.png",
  "West Ham": "https://media.api-sports.io/football/teams/48.png",
  Bournemouth: "https://media.api-sports.io/football/teams/35.png",
  Fulham: "https://media.api-sports.io/football/teams/36.png",
  Brentford: "https://media.api-sports.io/football/teams/55.png",
  "Crystal Palace": "https://media.api-sports.io/football/teams/52.png",
  "Nottingham Forest": "https://media.api-sports.io/football/teams/65.png",
  Everton: "https://media.api-sports.io/football/teams/45.png",
  Wolverhampton: "https://media.api-sports.io/football/teams/39.png",
  "Leicester City": "https://media.api-sports.io/football/teams/46.png",
  Southampton: "https://media.api-sports.io/football/teams/41.png",
  "Ipswich Town": "https://media.api-sports.io/football/teams/57.png",

  // Liga
  "Real Madrid": "https://media.api-sports.io/football/teams/541.png",
  "FC Barcelone": "https://media.api-sports.io/football/teams/529.png",
  "Atlético Madrid": "https://media.api-sports.io/football/teams/530.png",
  "Athletic Bilbao": "https://media.api-sports.io/football/teams/531.png",
  Villarreal: "https://media.api-sports.io/football/teams/533.png",
  "Real Sociedad": "https://media.api-sports.io/football/teams/548.png",
  "Real Betis": "https://media.api-sports.io/football/teams/543.png",
  Gérone: "https://media.api-sports.io/football/teams/547.png",
  "FC Séville": "https://media.api-sports.io/football/teams/536.png",
  Valence: "https://media.api-sports.io/football/teams/532.png",
  "Celta Vigo": "https://media.api-sports.io/football/teams/538.png",
  "CA Osasuna": "https://media.api-sports.io/football/teams/727.png",
  "RCD Majorque": "https://media.api-sports.io/football/teams/798.png",
  "Rayo Vallecano": "https://media.api-sports.io/football/teams/728.png",
  Getafe: "https://media.api-sports.io/football/teams/546.png",
  Alavés: "https://media.api-sports.io/football/teams/542.png",

  // Bundesliga
  "Bayern Munich": "https://media.api-sports.io/football/teams/157.png",
  Leverkusen: "https://media.api-sports.io/football/teams/168.png",
  Dortmund: "https://media.api-sports.io/football/teams/165.png",
  "RB Leipzig": "https://media.api-sports.io/football/teams/173.png",
  Stuttgart: "https://media.api-sports.io/football/teams/172.png",
  "Eintracht Francfort": "https://media.api-sports.io/football/teams/169.png",
  Fribourg: "https://media.api-sports.io/football/teams/160.png",
  Wolfsburg: "https://media.api-sports.io/football/teams/161.png",
  Mönchengladbach: "https://media.api-sports.io/football/teams/163.png",
  "Werder Brême": "https://media.api-sports.io/football/teams/162.png",
  Hoffenheim: "https://media.api-sports.io/football/teams/167.png",
  "Union Berlin": "https://media.api-sports.io/football/teams/182.png",
  "Mainz 05": "https://media.api-sports.io/football/teams/164.png",
  Augsbourg: "https://media.api-sports.io/football/teams/170.png",

  // Serie A
  "Inter Milan": "https://media.api-sports.io/football/teams/505.png",
  Naples: "https://media.api-sports.io/football/teams/492.png",
  "AC Milan": "https://media.api-sports.io/football/teams/489.png",
  Juventus: "https://media.api-sports.io/football/teams/496.png",
  Atalanta: "https://media.api-sports.io/football/teams/499.png",
  "AS Rome": "https://media.api-sports.io/football/teams/497.png",
  Latium: "https://media.api-sports.io/football/teams/487.png",
  Fiorentina: "https://media.api-sports.io/football/teams/502.png",
  Bologne: "https://media.api-sports.io/football/teams/500.png",
  Turin: "https://media.api-sports.io/football/teams/503.png",
  Udinese: "https://media.api-sports.io/football/teams/494.png",
  Côme: "https://media.api-sports.io/football/teams/895.png",

  // Europe
  "PSV Eindhoven": "https://media.api-sports.io/football/teams/197.png",
  Feyenoord: "https://media.api-sports.io/football/teams/209.png",
  "FC Porto": "https://media.api-sports.io/football/teams/212.png",
  "Sporting CP": "https://media.api-sports.io/football/teams/228.png",
  "Club Brugge": "https://media.api-sports.io/football/teams/569.png",
  Galatasaray: "https://media.api-sports.io/football/teams/645.png",
  "Chakhtar Donetsk": "https://media.api-sports.io/football/teams/550.png",
  "Slavia Prague": "https://media.api-sports.io/football/teams/560.png",
};

export function teamLogo(teamName: string): string | null {
  return LOGO_BY_TEAM[teamName] ?? null;
}
