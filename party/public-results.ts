import { Client } from "pg";

// SQL fixe : uniquement des résultats publics, sans données joueur ni marchés.
const RESULTS_SQL = `SELECT id, sport, league, home_team AS "homeTeam", away_team AS "awayTeam",
  home_score AS "homeScore", away_score AS "awayScore", finished_at AS "finishedAt"
  FROM matches WHERE status = 'finished'
  ORDER BY finished_at DESC NULLS LAST, id DESC LIMIT 20`;

export async function getPublicResults(
  request: Request,
  binding: Hyperdrive | undefined,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
  if (!binding) return Response.json({ error: "Service indisponible" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  // Cache edge uniquement sur URL canonique ; les paramètres ne créent pas de nouvelles clés.
  const cacheKey = new Request(new URL("/public/hyperdrive/results", request.url).toString());
  const cache = caches.default;
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  } catch { /* continuer si le cache edge est indisponible */ }

  const client = new Client({ connectionString: binding.connectionString, connectionTimeoutMillis: 5000, query_timeout: 5000 });
  try {
    await client.connect();
    const { rows } = await client.query(RESULTS_SQL);
    const response = Response.json({ results: rows }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=30", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" } });
    // Cache uniquement les succès, sans cookies ni données personnalisées.
    ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => undefined));
    return response;
  } catch {
    return Response.json({ error: "Service indisponible" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  } finally {
    await client.end().catch(() => undefined);
  }
}
