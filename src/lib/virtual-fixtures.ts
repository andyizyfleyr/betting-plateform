/** Une affiche est identique même si domicile et extérieur sont inversés. */
export const VIRTUAL_MAX_LIVE = 4;
export const VIRTUAL_REMATCH_GAP_MS = 30 * 60_000;
export interface VirtualFixtureWindow { home: string; away: string; start: number; end: number }
const team = (name: string) => name.normalize("NFKC").trim().toLocaleLowerCase("fr").replace(/\s+/g, " ");
export const virtualPairKey = (home: string, away: string): string => [team(home), team(away)].sort().join("\u0000");
export function sharesVirtualTeam(a: Pick<VirtualFixtureWindow, "home" | "away">, b: Pick<VirtualFixtureWindow, "home" | "away">): boolean {
  const names = new Set([team(a.home), team(a.away)]);
  return names.has(team(b.home)) || names.has(team(b.away));
}
/** Premier créneau compatible : aucune équipe en simultané, et 30 min entre deux mêmes affiches. */
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
