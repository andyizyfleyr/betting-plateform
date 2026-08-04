/**
 * Vrais logos officiels des clubs.
 * Football : CDN API-Sports · Basketball : CDN ESPN.
 * Chaque URL a été vérifiée (HTTP 200, image/png).
 * Les joueurs de tennis retournent null → avatar monogramme.
 */
const LOGO_BY_TEAM: Record<string, string> = {
  // Ligue 1
  "Paris SG": "https://media.api-sports.io/football/teams/85.png",
  Marseille: "https://media.api-sports.io/football/teams/81.png",
  Lyon: "https://media.api-sports.io/football/teams/80.png",
  Monaco: "https://media.api-sports.io/football/teams/91.png",
  Nice: "https://media.api-sports.io/football/teams/84.png",
  Toulouse: "https://media.api-sports.io/football/teams/96.png",
  // Premier League
  Arsenal: "https://media.api-sports.io/football/teams/42.png",
  Chelsea: "https://media.api-sports.io/football/teams/49.png",
  "Manchester City": "https://media.api-sports.io/football/teams/50.png",
  Liverpool: "https://media.api-sports.io/football/teams/40.png",
  // LaLiga
  "Real Madrid": "https://media.api-sports.io/football/teams/541.png",
  "FC Barcelone": "https://media.api-sports.io/football/teams/529.png",
  "Atlético Madrid": "https://media.api-sports.io/football/teams/530.png",
  "FC Séville": "https://media.api-sports.io/football/teams/536.png",
  // Bundesliga
  "Bayern Munich": "https://media.api-sports.io/football/teams/157.png",
  Dortmund: "https://media.api-sports.io/football/teams/165.png",
  // Serie A
  "Inter Milan": "https://media.api-sports.io/football/teams/505.png",
  Juventus: "https://media.api-sports.io/football/teams/496.png",
  // NBA
  "LA Lakers": "https://a.espncdn.com/i/teamlogos/nba/500/lal.png",
  "Boston Celtics": "https://a.espncdn.com/i/teamlogos/nba/500/bos.png",
  "Golden State": "https://a.espncdn.com/i/teamlogos/nba/500/gs.png",
  "Denver Nuggets": "https://a.espncdn.com/i/teamlogos/nba/500/den.png",
  "Miami Heat": "https://a.espncdn.com/i/teamlogos/nba/500/mia.png",
  "Milwaukee Bucks": "https://a.espncdn.com/i/teamlogos/nba/500/mil.png",
  "New York Knicks": "https://a.espncdn.com/i/teamlogos/nba/500/nyk.png",
  "Phoenix Suns": "https://a.espncdn.com/i/teamlogos/nba/500/phx.png",
};

export function teamLogo(teamName: string): string | null {
  return LOGO_BY_TEAM[teamName] ?? null;
}
