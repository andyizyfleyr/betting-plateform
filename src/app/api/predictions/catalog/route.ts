import { asc, desc, getTableColumns, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { predictionQuestions } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { formatServerErrorResponse } from "@/lib/db-error";
import {
  EDGE_CACHE_TAGS,
  getPredictionsCatalogCache,
  hasUnexpectedSearchParams,
  isManualRefreshRequest,
  publicJsonWithEdgeCache,
  rejectUnexpectedQueryParams,
  runSingleflight,
  setPredictionsCatalogCache,
} from "@/lib/response-cache";
import { syncAllSettlementsThrottled } from "@/lib/sync-throttle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CATALOG_EDGE_POLICY = {
  maxAge: 0,
  sMaxAge: 1,
  staleWhileRevalidate: 2,
  tags: [EDGE_CACHE_TAGS.predictionsCatalog],
} as const;

// Sécurité : exclut strictement `seed_value` (graine interne de résolution serveur)
// et ne contient AUCUNE donnée personnelle ni cookie joueur.
const { seedValue: _omitSeedValue, ...publicQuestionColumns } =
  getTableColumns(predictionQuestions);
void _omitSeedValue;

export async function GET(req: NextRequest) {
  try {
    // Défense en profondeur derrière la règle Vercel Firewall : rejette tout paramètre aléatoire
    if (hasUnexpectedSearchParams(req.nextUrl.searchParams)) {
      return rejectUnexpectedQueryParams();
    }
    const manualRefresh = isManualRefreshRequest(req);

    const stored = await runSingleflight(
      manualRefresh ? "api:predictions:catalog:refresh" : "api:predictions:catalog",
      async () => {
        await ensureSeeded();
        await syncAllSettlementsThrottled(false, { manualRefresh });

        if (!manualRefresh) {
          const freshCached = getPredictionsCatalogCache();
          if (freshCached) {
            return freshCached;
          }
        }

      const rows = await db
        .select(publicQuestionColumns)
        .from(predictionQuestions)
        .orderBy(
          asc(sql`CASE ${predictionQuestions.status} WHEN 'open' THEN 0 ELSE 1 END`),
          asc(predictionQuestions.resolvesAt),
          desc(predictionQuestions.id)
        )
        .limit(120);

      const questions = rows.map((q) => ({
        id: q.id,
        question: q.question,
        category: q.category,
        status: q.status,
        resolution: q.resolution,
        oddsYes: q.oddsYes,
        oddsNo: q.oddsNo,
        options: q.options ?? null,
        volume: q.volume,
        yesCount: q.yesCount,
        noCount: q.noCount,
        resolvesAt: q.resolvesAt.toISOString(),
        resolvedAt: q.resolvedAt ? q.resolvedAt.toISOString() : null,
        myBet: null,
      }));

      return setPredictionsCatalogCache({
        questions,
        serverTime: new Date().toISOString(),
      });
    });

    return publicJsonWithEdgeCache(req, null, stored, CATALOG_EDGE_POLICY);
  } catch (err) {
    return formatServerErrorResponse(err, "GET /api/predictions/catalog");
  }
}
