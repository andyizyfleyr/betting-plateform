import { NextRequest, NextResponse } from "next/server";
import { hydrateLiveMatchRow } from "@/db/engine";
import { ensureSeeded } from "@/db/seed";
import {
  ensureMatchStoreHydrated,
  getCachedAllMatchesForFeed,
} from "@/lib/active-state-cache";
import { formatServerErrorResponse } from "@/lib/db-error";
import { serializeSlimPublicMatch } from "@/lib/match-serializer";
import { ensureMlLoaded } from "@/lib/ml-engine";
import { isRealFeedSyncInFlight } from "@/lib/real-sports-feed";
import {
  computeWeakEtag,
  EDGE_CACHE_TAGS,
  getMatchesSlimPayloadCache,
  hasUnexpectedSearchParams,
  isManualRefreshRequest,
  publicJsonWithEdgeCache,
  rejectUnexpectedQueryParams,
  runSingleflight,
  setMatchesSlimPayloadCache,
} from "@/lib/response-cache";
import { syncLiveMatchesThrottled } from "@/lib/sync-throttle";
import { recordVisitorActivity } from "@/lib/visitor-activity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MATCHES_SLIM_EDGE_POLICY = {
  maxAge: 0,
  sMaxAge: 1,
  staleWhileRevalidate: 1,
  tags: [EDGE_CACHE_TAGS.matches],
} as const;

export async function GET(req: NextRequest) {
  try {
    if (hasUnexpectedSearchParams(req.nextUrl.searchParams)) {
      return rejectUnexpectedQueryParams();
    }
    recordVisitorActivity();
    const manualRefresh = isManualRefreshRequest(req);

    const { entry: stored, catchingUp } = await runSingleflight(
      manualRefresh ? "api:matches:slim:refresh" : "api:matches:slim",
      async () => {
        await ensureSeeded();
        await ensureMlLoaded();
        await syncLiveMatchesThrottled(false, { manualRefresh });

        const feedInFlight = isRealFeedSyncInFlight();
        if (!manualRefresh && !feedInFlight) {
          const freshCached = getMatchesSlimPayloadCache();
          if (freshCached) {
            return { entry: freshCached, catchingUp: false };
          }
        }

        await ensureMatchStoreHydrated(manualRefresh);
        const now = Date.now();
        const rows = getCachedAllMatchesForFeed();
        const slimMatches = rows.map((rawRow) =>
          serializeSlimPublicMatch(hydrateLiveMatchRow(rawRow, now), now)
        );

        const payload = {
          matches: slimMatches,
          serverTime: new Date(now).toISOString(),
        };
        if (feedInFlight) {
          const json = JSON.stringify(payload);
          return {
            entry: { json, etag: computeWeakEtag(json), at: Date.now() },
            catchingUp: true,
          };
        }
        return { entry: setMatchesSlimPayloadCache(payload), catchingUp: false };
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

    return publicJsonWithEdgeCache(req, null, stored, MATCHES_SLIM_EDGE_POLICY);
  } catch (err) {
    return formatServerErrorResponse(err, "GET /api/matches/slim");
  }
}
