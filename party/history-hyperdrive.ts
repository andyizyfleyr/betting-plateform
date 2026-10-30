import { Client } from "pg";

// Projection bornée sans colonnes serveur sensibles ni marchés volumineux.
const FIELDS = `id, sport, league, home_team AS "homeTeam", away_team AS "awayTeam",
 home_score AS "homeScore", away_score AS "awayScore", status, minute,
 starts_at AS "startsAt", odds_home AS "oddsHome", odds_draw AS "oddsDraw", odds_away AS "oddsAway",
 suspended, finished_at AS "finishedAt", red_home AS "redHome", red_away AS "redAway", events,
 regime, home_form AS "homeForm", away_form AS "awayForm", home_logo AS "homeLogo", away_logo AS "awayLogo",
 source, ht_home_score AS "htHomeScore", ht_away_score AS "htAwayScore", real_stats AS "realStats"`;
export const HISTORY_SQL = `(SELECT ${FIELDS} FROM matches WHERE status = 'finished' AND source = 'manual' ORDER BY finished_at DESC, id DESC LIMIT 120)
 UNION ALL
 (SELECT ${FIELDS} FROM matches WHERE status = 'finished' AND source <> 'manual' ORDER BY finished_at DESC, id DESC LIMIT 120)`;

export async function hyperdriveHistory(request: Request, binding: Hyperdrive | undefined, secret: string | undefined, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
  if (!secret || secret.length < 16 || request.headers.get("Authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!binding) return Response.json({ error: "Service indisponible" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const url = new URL(request.url);
  const fresh = url.searchParams.get("fresh") === "1";
  const cacheKey = new Request(new URL("/internal/hyperdrive/history-v1", url).toString());
  const cache = caches.default;
  if (!fresh) { try { const hit = await cache.match(cacheKey); if (hit) return new Response(hit.body, { status: hit.status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } }); } catch { /* accès direct */ } }
  const client = new Client({ connectionString: binding.connectionString, connectionTimeoutMillis: 2500, query_timeout: 2500 });
  try {
    await client.connect();
    const { rows } = await client.query(HISTORY_SQL);
    const result = Response.json({ version: 1, matches: rows }, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    if (!fresh) {
      const stored = new Response(result.clone().body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=10" } });
      ctx.waitUntil(cache.put(cacheKey, stored).catch(() => undefined));
    }
    return result;
  } catch { return Response.json({ error: "Service indisponible" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  finally { await client.end().catch(() => undefined); }
}
