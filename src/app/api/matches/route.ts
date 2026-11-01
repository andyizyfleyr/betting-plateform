import { isPubliclyOfferedMatch } from "@/lib/real-leagues";
import { NextRequest, NextResponse } from "next/server";
import { hydrateLiveMatchRow } from "@/db/engine";
import { ensureSeeded } from "@/db/seed";
import {
  ensureMatchStoreHydrated,
  getCachedAllMatchesForFeed,
} from "@/lib/active-state-cache";
import { formatServerErrorResponse } from "@/lib/db-error";
import { serializePublicMatch } from "@/lib/match-serializer";
import { ensureMlLoaded } from "@/lib/ml-engine";
import { isRealFeedSyncInFlight } from "@/lib/real-sports-feed";
import {
  computeWeakEtag,
  EDGE_CACHE_TAGS,
  getMatchesPayloadCache,
  hasUnexpectedSearchParams,
  isManualRefreshRequest,
  publicJsonWithEdgeCache,
  rejectUnexpectedQueryParams,
  runSingleflight,
  setMatchesPayloadCache,
} from "@/lib/response-cache";
import { syncLiveMatchesThrottled } from "@/lib/sync-throttle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MATCHES_EDGE_POLICY = {
  maxAge: 2,
  sMaxAge: 10,
  staleWhileRevalidate: 10,
  tags: [EDGE_CACHE_TAGS.matches],
} as const;

export async function GET(req: NextRequest) {
  try {
    if (hasUnexpectedSearchParams(req.nextUrl.searchParams)) {
      return rejectUnexpectedQueryParams();
    }
    const manualRefresh = isManualRefreshRequest(req);

    // Cache hit chaud : ne réveille ni le moteur, ni la réconciliation SQL.
    if (!manualRefresh) {
      const freshCached = getMatchesPayloadCache();
      if (freshCached) {
        return publicJsonWithEdgeCache(req, null, freshCached, MATCHES_EDGE_POLICY);
      }
    }

    const { entry: stored, catchingUp } = await runSingleflight(
      manualRefresh ? "api:matches:refresh" : "api:matches",
      async () => {
        await ensureSeeded();
        await ensureMlLoaded();
        await syncLiveMatchesThrottled(false, { manualRefresh });

        const feedInFlight = isRealFeedSyncInFlight();
        if (!manualRefresh && !feedInFlight) {
          const freshCached = getMatchesPayloadCache();
          if (freshCached) {
            return { entry: freshCached, catchingUp: false };
          }
        }

        await ensureMatchStoreHydrated(manualRefresh);
        const now = Date.now();
        const rows = getCachedAllMatchesForFeed().filter(isPubliclyOfferedMatch);
        const withMarkets = rows.map((rawRow) =>
          serializePublicMatch(hydrateLiveMatchRow(rawRow, now), now)
        );

        const payload = {
          matches: withMarkets,
          serverTime: new Date(now).toISOString(),
        };
        if (feedInFlight) {
          const json = JSON.stringify(payload);
          return {
            entry: { json, etag: computeWeakEtag(json), at: Date.now() },
            catchingUp: true,
          };
        }
        return { entry: setMatchesPayloadCache(payload), catchingUp: false };
      }
    );

    if (catchingUp) {
      return new NextResponse(stored.json, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ETag: stored.etag,
          "Cache-Control": "no-store, max-age=0",
          "CDN-Cache-Control": "no-store",
          "Vercel-CDN-Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    return publicJsonWithEdgeCache(req, null, stored, MATCHES_EDGE_POLICY);
  } catch (err) {
    return formatServerErrorResponse(err, "GET /api/matches");
  }
}
