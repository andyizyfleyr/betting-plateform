import { NextRequest, NextResponse } from "next/server";
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
  maxAge: 1,
  sMaxAge: 5,
  staleWhileRevalidate: 8,
  tags: [EDGE_CACHE_TAGS.matches],
} as const;

export async function GET(req: NextRequest) {
  try {
    recordVisitorActivity();
    if (req.nextUrl.searchParams.size > 0) {
      return rejectUnexpectedQueryParams();
    }

    const { entry: stored, catchingUp } = await runSingleflight(
      "api:matches:slim",
      async () => {
        await ensureSeeded();
        await ensureMlLoaded();
        await syncLiveMatchesThrottled();

        const feedInFlight = isRealFeedSyncInFlight();
        if (!feedInFlight) {
          const freshCached = getMatchesSlimPayloadCache();
          if (freshCached) {
            return { entry: freshCached, catchingUp: false };
          }
        }

        await ensureMatchStoreHydrated();
        const now = Date.now();
        const rows = getCachedAllMatchesForFeed();
        const slimMatches = rows.map((rawRow) =>
          serializeSlimPublicMatch(rawRow, now)
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
