/** Générateur de nouvelles affiches pour le moteur live (football uniquement). */

const FOOTBALL_TEAMS = [
  "Paris SG",
  "Marseille",
  "Lyon",
  "Monaco",
  "Nice",
  "Toulouse",
  "Arsenal",
  "Chelsea",
  "Manchester City",
  "Liverpool",
  "Real Madrid",
  "FC Barcelone",
  "Atlético Madrid",
  "FC Séville",
  "Bayern Munich",
  "Dortmund",
  "Inter Milan",
  "Juventus",
];

const FOOTBALL_LEAGUES = [
  "Ligue 1 · France",
  "Premier League · Angleterre",
  "LaLiga · Espagne",
  "Bundesliga · Allemagne",
  "Serie A · Italie",
];

const HOUR = 60 * 60 * 1000;
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const round2 = (n: number) => Math.round(n * 100) / 100;
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

export function randomFixture(sport: string, startsAt?: Date) {
  const home = pick(FOOTBALL_TEAMS);
  let away = pick(FOOTBALL_TEAMS);
  while (away === home) away = pick(FOOTBALL_TEAMS);

  return {
    sport: "football",
    league: pick(FOOTBALL_LEAGUES),
    homeTeam: home,
    awayTeam: away,
    homeScore: null,
    awayScore: null,
    status: "upcoming" as const,
    minute: null,
    startsAt: startsAt ?? new Date(Date.now() + rand(3, 26) * HOUR),
    oddsHome: round2(rand(1.45, 3.2)),
    oddsDraw: round2(rand(2.9, 4.2)),
    oddsAway: round2(rand(1.45, 3.2)),
  };
}
