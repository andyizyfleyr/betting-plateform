import { virtualTeamIdentity } from "./team-logos";

/** Une affiche est identique même si domicile et extérieur sont inversés. */
export const VIRTUAL_MAX_LIVE = 4;
/** Intervalle entre deux coups d’envoi, indépendamment de la durée du match. */
export const VIRTUAL_KICKOFF_GAP_MS = 3 * 60_000;
/** Horizon maximal pour avancer un match et maintenir les 4 directs simultanés. */
export const VIRTUAL_LIVE_PRIME_HORIZON_MS = VIRTUAL_MAX_LIVE * VIRTUAL_KICKOFF_GAP_MS;
export const VIRTUAL_REMATCH_GAP_MS = 7 * 24 * 60 * 60_000;
export interface VirtualFixtureWindow { home: string; away: string; start: number; end: number }
const team = virtualTeamIdentity;
export const virtualPairKey = (home: string, away: string): string => [team(home), team(away)].sort().join("\u0000");
export function sharesVirtualTeam(a: Pick<VirtualFixtureWindow, "home" | "away">, b: Pick<VirtualFixtureWindow, "home" | "away">): boolean {
  const names = new Set([team(a.home), team(a.away)]);
  return names.has(team(b.home)) || names.has(team(b.away));
}
/** Premier créneau compatible : aucune équipe en simultané, et sept jours entre deux mêmes affiches. */
export function nextVirtualStart(fixture: Pick<VirtualFixtureWindow, "home" | "away">, proposed: number, duration: number, windows: readonly VirtualFixtureWindow[]): number {
  let start = proposed;
  const pair = virtualPairKey(fixture.home, fixture.away);
  for (;;) {
    let next = start;
    for (const other of windows) {
      const samePair = pair === virtualPairKey(other.home, other.away);
      if (samePair && start < other.end + VIRTUAL_REMATCH_GAP_MS && start + duration + VIRTUAL_REMATCH_GAP_MS > other.start) next = Math.max(next, other.end + VIRTUAL_REMATCH_GAP_MS);
      else if (sharesVirtualTeam(fixture, other) && start < other.end && start + duration > other.start) next = Math.max(next, other.end);
    }
    if (next === start) return start;
    start = next;
  }
}

/** Parcours complet du catalogue sans cycle court, quel que soit son nombre d'éléments. */
export function coprimeStride(length: number, seed: number): number {
  if (length <= 1) return 1;
  const gcd = (a: number, b: number): number => { while (b) [a, b] = [b, a % b]; return a; };
  let stride = (seed % (length - 1)) + 1;
  while (gcd(stride, length) !== 1) stride = (stride % (length - 1)) + 1;
  return stride;
}

export interface VirtualFixtureTemplate { league: string; home: string; away: string }
/** Affiches déjà définies, puis toutes les nouvelles combinaisons sans doublon. */
export function buildVirtualFixturePool(classics: readonly VirtualFixtureTemplate[], clubs: readonly string[]): VirtualFixtureTemplate[] {
  const fixtures = [...classics];
  const seen = new Set(fixtures.map(f => virtualPairKey(f.home, f.away)));
  for (let i = 0; i < clubs.length; i++) {
    for (let j = i + 1; j < clubs.length; j++) {
      if (team(clubs[i]) === team(clubs[j])) continue;
      const pair = virtualPairKey(clubs[i], clubs[j]);
      if (seen.has(pair)) continue;
      seen.add(pair);
      fixtures.push({ league: "Coupe virtuelle", home: clubs[i], away: clubs[j] });
    }
  }
  return fixtures;
}

/** Planifie une file mondiale, sans laisser une revanche tardive bloquer les autres affiches. */
export function planVirtualQueue<T>(items: readonly T[], cursor: number, fixtureOf: (item: T) => Pick<VirtualFixtureWindow, "home" | "away">, durationOf: (item: T) => number, existing: readonly VirtualFixtureWindow[]): Array<{ item: T; start: number; duration: number }> {
  const remaining = [...items];
  const windows = [...existing];
  const planned: Array<{ item: T; start: number; duration: number }> = [];
  while (remaining.length) {
    let bestIndex = 0;
    let bestStart = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const proposed = nextVirtualStart(fixtureOf(remaining[i]), cursor, durationOf(remaining[i]), windows);
      if (proposed < bestStart) { bestStart = proposed; bestIndex = i; }
    }
    const [item] = remaining.splice(bestIndex, 1);
    const duration = durationOf(item);
    planned.push({ item, start: bestStart, duration });
    windows.push({ ...fixtureOf(item), start: bestStart, end: bestStart + duration });
    cursor = bestStart + VIRTUAL_KICKOFF_GAP_MS;
  }
  return planned;
}
