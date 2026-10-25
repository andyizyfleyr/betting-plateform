import { NextRequest, NextResponse } from "next/server";
import { ensureSeeded } from "@/db/seed";
import { getPersonalizedRecommendations } from "@/lib/ml-engine";
import { getAuthUserId } from "@/lib/session";
import { syncLiveMatchesThrottled } from "@/lib/sync-throttle";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureSeeded();
  await syncLiveMatchesThrottled();
  const uid = await getAuthUserId(req);
  const data = await getPersonalizedRecommendations(uid);
  return NextResponse.json(data);
}
