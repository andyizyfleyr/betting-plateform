/** Générateur de nouvelles affiches pour le moteur live. */

type SportKey = "football" | "basketball" | "tennis";

const POOLS: Record<SportKey, string[]> = {
  football: [
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
  ],
  basketball: [
    "LA Lakers",
    "Boston Celtics",
    "Golden State",
    "Denver Nuggets",
    "Miami Heat",
    "Milwaukee Bucks",
    "New York Knicks",
    "Phoenix Suns",
  ],
  tennis: ["C. Alcaraz", "J. Sinner", "N. Djokovic", "A. Zverev", "C. Gauff", "I. Swiatek"],
};

const LEAGUES: Record<SportKey, string[]> = {
  football: [
    "Ligue 1 · France",
    "Premier League · Angleterre",
    "LaLiga · Espagne",
    "Bundesliga · Allemagne",
    "Serie A · Italie",
  ],
  basketball: ["NBA · États-Unis"],
  tennis: ["ATP 500 · Dubaï", "WTA 1000 · Miami", "Masters 1000 · Rome"],
};

const HOUR = 60 * 60 * 1000;
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const round2 = (n: number) => Math.round(n * 100) / 100;
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

export function randomFixture(sport: string, startsAt?: Date) {
  const s = (sport in POOLS ? sport : "football") as SportKey;
  const pool = POOLS[s];
  const home = pick(pool);
  let away = pick(pool);
  while (away === home) away = pick(pool);

  return {
    sport: s,
    league: pick(LEAGUES[s]),
    homeTeam: home,
    awayTeam: away,
    homeScore: null,
    awayScore: null,
    status: "upcoming" as const,
    minute: null,
    startsAt: startsAt ?? new Date(Date.now() + rand(3, 26) * HOUR),
    oddsHome: round2(rand(1.45, 3.2)),
    oddsDraw: s === "football" ? round2(rand(2.9, 4.2)) : null,
    oddsAway: round2(rand(1.45, 3.2)),
  };
}
