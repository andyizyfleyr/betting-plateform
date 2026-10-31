import { isPubliclyOfferedMatch } from "@/lib/real-leagues";
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
import { verifyPartyBearerHeader } from "@/lib/partykit";
import { setMatchesSlimPayloadCache } from "@/lib/response-cache";
import { syncLiveMatchesThrottled } from "@/lib/sync-throttle";
import { recordVisitorActivity } from "@/lib/visitor-activity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/realtime/tick — Appelé par `onAlarm()` du salon PartyKit `live-matches`
 * uniquement lorsqu'au moins 1 client WebSocket est connecté :
 * - Maintient l'avancement temps réel des matchs virtuels/réels et le règlement des paris
 *   même lorsque 100 % des clients écoutent en WebSocket (0 polling HTTP client).
 * - Protégé par comparaison temps-constant `Authorization: Bearer <PARTYKIT_SECRET>`.
 */
export async function POST(req: NextRequest) {
  try {
    if (!verifyPartyBearerHeader(req.headers.get("authorization"))) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    recordVisitorActivity();
    await ensureSeeded();
    await ensureMlLoaded();
    await syncLiveMatchesThrottled();
    await ensureMatchStoreHydrated();

    const now = Date.now();
    const rows = getCachedAllMatchesForFeed().filter(isPubliclyOfferedMatch);
    const slimMatches = rows.map((r) =>
      serializeSlimPublicMatch(hydrateLiveMatchRow(r, now), now)
    );
    const serverTime = new Date(now).toISOString();

    setMatchesSlimPayloadCache({
      matches: slimMatches,
      serverTime,
    });

    return NextResponse.json({
      ok: true,
      matches: slimMatches,
      serverTime,
    });
  } catch (err) {
    return formatServerErrorResponse(err, "POST /api/realtime/tick");
  }
}
