import { NextRequest, NextResponse } from "next/server";
import { runScrape, type ScrapeOptions } from "@/lib/scraper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // scraping long (~2 min) — plan Pro requis, sinon plaque au timeout

/**
 * Route indépendante de scraping Playwright (1xBet / bet365).
 *
 * GET  /api/scrape?site=1xbet&limit=20  → exécute le scrape et l'écrit en base.
 * POST /api/scrape  (body JSON, mêmes options) → idem avec un corps.
 *
 * Options supportées (query ou body) :
 *   site      "1xbet" | "bet365"
 *   url       URL personnalisée (source inconnue / test avec page locale fixture)
 *   league    nom de championnat surchargeant la config
 *   limit     nombre max de lignes importées
 *   dryRun    true → ne modifie pas la base (inspection uniquement)
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const opts: ScrapeOptions = {
    site: params.get("site") ?? undefined,
    url: params.get("url") ?? undefined,
    league: params.get("league") ?? undefined,
    limit: params.get("limit") ? Number(params.get("limit")) : undefined,
    dryRun: params.get("dryRun") === "1" || params.get("dryRun") === "true",
  };

  const start = Date.now();
  const result = await runScrape(opts);
  result.durationMs = Date.now() - start;

  const status = result.error && result.rows.length === 0 ? 502 : 200;
  return NextResponse.json(result, { status });
}

export async function POST(req: NextRequest) {
  let body: ScrapeOptions = {};
  try {
    body = (await req.json()) as ScrapeOptions;
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const start = Date.now();
  const result = await runScrape(body);
  result.durationMs = Date.now() - start;

  const status = result.error && result.rows.length === 0 ? 502 : 200;
  return NextResponse.json(result, { status });
}