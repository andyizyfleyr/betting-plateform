/** Contrat public : seuls des matchs complets modifiés sont transmis. */
export type LiveMatch = { id: number; [key: string]: unknown };
export type LiveSnapshot = { type: "MATCHES_SNAPSHOT"; matches: LiveMatch[]; serverTime?: string; ts?: number };
export type LiveDelta = { type: "MATCHES_DELTA"; base: number; seq: number; matches: LiveMatch[]; order: number[]; serverTime?: string; ts?: number };

export function isLiveSnapshot(value: unknown): value is LiveSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<LiveSnapshot>;
  if (v.type !== "MATCHES_SNAPSHOT" || !Array.isArray(v.matches)) return false;
  const ids = new Set<number>();
  for (const m of v.matches) {
    if (!m || typeof m !== "object" || !Number.isSafeInteger(m.id) || ids.has(m.id)) return false;
    ids.add(m.id);
  }
  return true;
}

export function buildLiveDelta(previous: LiveSnapshot, next: LiveSnapshot, base: number, seq: number): LiveDelta {
  const previousById = new Map(previous.matches.map((match) => [match.id, JSON.stringify(match)]));
  return {
    type: "MATCHES_DELTA", base, seq,
    matches: next.matches.filter((match) => previousById.get(match.id) !== JSON.stringify(match)),
    order: next.matches.map((match) => match.id),
    serverTime: next.serverTime, ts: next.ts,
  };
}
