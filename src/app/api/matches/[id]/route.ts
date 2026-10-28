import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { hydrateLiveMatchRow } from "@/db/engine";
import { matches } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import {
  ensureMatchStoreHydrated,
  getCachedMatchById,
} from "@/lib/active-state-cache";
import { formatServerErrorResponse } from "@/lib/db-error";
import { serializePublicMatch } from "@/lib/match-serializer";
import { ensureMlLoaded } from "@/lib/ml-engine";
import { isRealFeedSyncInFlight } from "@/lib/real-sports-feed";
import {
  EDGE_CACHE_TAGS,
  hasUnexpectedSearchParams,
  isManualRefreshRequest,
  publicJsonWithEdgeCache,
  rejectUnexpectedQueryParams,
  runSingleflight,
} from "@/lib/response-cache";
import { syncLiveMatchesThrottled } from "@/lib/sync-throttle";

export const dynamic = "force-dynamic";

const SINGLE_MATCH_ACTIVE_POLICY = {
  maxAge: 0,
  sMaxAge: 1,
  staleWhileRevalidate: 1,
  tags: [EDGE_CACHE_TAGS.matches],
} as const;

const SINGLE_MATCH_FINISHED_POLICY = {
  maxAge: 5,
  sMaxAge: 30,
  staleWhileRevalidate: 60,
  tags: [EDGE_CACHE_TAGS.matches, EDGE_CACHE_TAGS.history],
} as const;

/**
 * GET /api/matches/[id] — Flux ultra-léger (~3 Ko au lieu de ~180 Ko) pour la page
 * dédiée d'un match `/matchs/[id]` et la feuille de marchés :
 * 0 requête SQL à chaud via `getCachedMatchById`, repli PK indexé pour les matchs anciens.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    if (hasUnexpectedSearchParams(req.nextUrl.searchParams)) {
      return rejectUnexpectedQueryParams();
    }
    const manualRefresh = isManualRefreshRequest(req);

    const { id: rawId } = await ctx.params;
    if (!/^[1-9]\d{0,9}$/.test(rawId)) {
      return NextResponse.json({ error: "Identifiant de match invalide" }, { status: 400 });
    }
    const matchId = Number(rawId);
    if (!Number.isInteger(matchId) || matchId <= 0 || matchId > 2_147_483_647) {
      return NextResponse.json({ error: "Identifiant de match hors plage" }, { status: 400 });
    }

    const result = await runSingleflight(
      manualRefresh ? `api:match:${matchId}:refresh` : `api:match:${matchId}`,
      async () => {
        await ensureSeeded();
        await ensureMlLoaded();
        await syncLiveMatchesThrottled(false, { manualRefresh });
        await ensureMatchStoreHydrated(manualRefresh);

        const now = Date.now();
        let row = getCachedMatchById(matchId);
        if (row && !manualRefresh) {
          row = hydrateLiveMatchRow(row, now);
        } else {
          const [dbRow] = await db
            .select()
            .from(matches)
            .where(eq(matches.id, matchId))
            .limit(1);
          const candidate = dbRow ?? row;
          row = candidate ? hydrateLiveMatchRow(candidate, now) : null;
        }

        if (!row) return null;

        return {
          match: serializePublicMatch(row, now),
          serverTime: new Date(now).toISOString(),
          catchingUp: isRealFeedSyncInFlight(),
        };
      }
    );

    if (!result) {
      return NextResponse.json({ error: "Match introuvable" }, { status: 404 });
    }

    if (result.catchingUp) {
      return NextResponse.json(
        { match: result.match, serverTime: result.serverTime },
        {
          status: 200,
          headers: {
            "Cache-Control": "no-store, max-age=0",
            "CDN-Cache-Control": "no-store",
            "Vercel-CDN-Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        }
      );
    }

    const policy =
      result.match.status === "finished"
        ? SINGLE_MATCH_FINISHED_POLICY
        : SINGLE_MATCH_ACTIVE_POLICY;

    return publicJsonWithEdgeCache(
      req,
      { match: result.match, serverTime: result.serverTime },
      undefined,
      policy
    );
  } catch (err) {
    return formatServerErrorResponse(err, "GET /api/matches/[id]");
  }
}
