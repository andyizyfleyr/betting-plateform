export const VIRTUAL_LEAGUE = "Ligue des Champions · Europe";
export const ROUND_MS = 60_000;

const BASE = 1.35;
const HOME_ADV = 1.12;
const POWER = 0.9;
const MARGIN = 1.06;

export interface VirtualTeam {
  name: string;
  strength: number;
}

export const TEAMS: VirtualTeam[] = [
  { name: "Paris SG", strength: 91 },
  { name: "Manchester City", strength: 92 },
  { name: "Real Madrid", strength: 90 },
  { name: "Bayern Munich", strength: 89 },
  { name: "Liverpool", strength: 87 },
  { name: "Arsenal", strength: 86 },
  { name: "Inter Milan", strength: 85 },
  { name: "FC Barcelone", strength: 84 },
  { name: "Marseille", strength: 80 },
  { name: "Toulouse", strength: 76 },
];

export interface Pair {
  home: string;
  away: string;
}

function buildRounds(): Pair[][] {
  const n = TEAMS.length;
  const order = TEAMS.map((_, i) => i);
  const rounds: Pair[][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: Pair[] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = order[i];
      const b = order[n - 1 - i];
      const swap = (r + i) % 2 === 1;
      pairs.push({ home: TEAMS[swap ? b : a].name, away: TEAMS[swap ? a : b].name });
    }
    rounds.push(pairs);
    order.splice(1, 0, order.pop()!);
  }
  return rounds;
}

export const ROUNDS: Pair[][] = buildRounds();

export function pairingsForRound(round: number): Pair[] {
  const n = ROUNDS.length;
  return ROUNDS[((round % n) + n) % n];
}

export function roundIndexOf(home: string, away: string): number {
  return ROUNDS.findIndex((round) =>
    round.some((p) => p.home === home && p.away === away)
  );
}

function teamStrength(name: string): number {
  return TEAMS.find((t) => t.name === name)?.strength ?? 85;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function expectedGoals(home: string, away: string): { lambdaHome: number; lambdaAway: number } {
  const sh = teamStrength(home);
  const sa = teamStrength(away);
  const ratio = sh / sa;
  return {
    lambdaHome: clamp(BASE * Math.pow(ratio, POWER) * HOME_ADV, 0.35, 3.5),
    lambdaAway: clamp(BASE * Math.pow(sa / sh, POWER) / HOME_ADV, 0.35, 3.5),
  };
}

function poissonPmf(k: number, lambda: number): number {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact;
}

export function winProbabilities(lambdaHome: number, lambdaAway: number) {
  let home = 0;
  let draw = 0;
  for (let i = 0; i <= 15; i++) {
    for (let j = 0; j <= 15; j++) {
      const p = poissonPmf(i, lambdaHome) * poissonPmf(j, lambdaAway);
      if (i > j) home += p;
      else if (i === j) draw += p;
    }
  }
  const away = Math.max(0.001, 1 - home - draw);
  return { home, draw, away };
}

export function oddsFor(home: string, away: string) {
  const { lambdaHome, lambdaAway } = expectedGoals(home, away);
  const p = winProbabilities(lambdaHome, lambdaAway);
  return {
    oddsHome: round2(clamp(1 / (p.home * MARGIN), 1.01, 50)),
    oddsDraw: round2(clamp(1 / (p.draw * MARGIN), 1.01, 50)),
    oddsAway: round2(clamp(1 / (p.away * MARGIN), 1.01, 50)),
  };
}

function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poissonSample(rng: () => number, lambda: number): number {
  const limit = Math.exp(-lambda);
  let p = 1;
  let k = 0;
  do {
    k++;
    p *= rng();
  } while (p > limit && k < 12);
  return k - 1;
}

function goalMinutes(round: number, team: string, lambda: number): number[] {
  const rng = mulberry32(hashString(`${round}|${team}`));
  const count = poissonSample(rng, lambda);
  const minutes: number[] = [];
  for (let i = 0; i < count; i++) minutes.push(1 + Math.floor(rng() * 90));
  return minutes.sort((a, b) => a - b);
}

export function scoreAt(round: number, minute: number, home: string, away: string) {
  const { lambdaHome, lambdaAway } = expectedGoals(home, away);
  const homeGoals = goalMinutes(round, home, lambdaHome).filter((m) => m <= minute).length;
  const awayGoals = goalMinutes(round, away, lambdaAway).filter((m) => m <= minute).length;
  return { home: homeGoals, away: awayGoals };
}
