import type { MatchRow } from "@/db/schema";

/** Repli sur Neon pour toute erreur, preview, secret absent ou données invalides. */
export async function fetchHyperdriveHistory(manualRefresh: boolean): Promise<MatchRow[] | null> {
  const secret = process.env.PARTYKIT_SECRET?.trim();
  if (process.env.HYPERDRIVE_HISTORY_ENABLED !== "true" || process.env.VERCEL_ENV !== "production" || !secret || secret.length < 16) return null;
  try {
    const url = new URL("https://pulse-bet.matiasanauld.workers.dev/internal/hyperdrive/history-v1");
    if (manualRefresh) url.searchParams.set("fresh", "1");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${secret}` }, cache: "no-store", signal: AbortSignal.timeout(3500), redirect: "error" });
    if (!response.ok || Number(response.headers.get("content-length") || 0) > 4 * 1024 * 1024) return null;
    const text = await response.text();
    if (text.length > 4 * 1024 * 1024) return null;
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || !("version" in body) || body.version !== 1 || !("matches" in body) || !Array.isArray(body.matches) || body.matches.length > 240) return null;
    const rows: MatchRow[] = [];
    for (const item of body.matches) {
      if (!item || typeof item !== "object" || !Number.isSafeInteger(item.id) || item.id <= 0 || item.status !== "finished" || typeof item.homeTeam !== "string" || typeof item.awayTeam !== "string" || typeof item.source !== "string" || typeof item.sport !== "string" || typeof item.league !== "string" || typeof item.startsAt !== "string" || !Number.isFinite(Date.parse(item.startsAt)) || (item.finishedAt !== null && (typeof item.finishedAt !== "string" || !Number.isFinite(Date.parse(item.finishedAt)))) || typeof item.oddsHome !== "number" || typeof item.oddsAway !== "number") return null;
      rows.push({ ...item, startsAt: new Date(item.startsAt), finishedAt: item.finishedAt ? new Date(item.finishedAt) : null, markets: null, scriptedEvents: null, tickHistory: [] } as MatchRow);
    }
    return rows;
  } catch { return null; }
}
