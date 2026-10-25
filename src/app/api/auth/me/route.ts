import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser } from "@/db/schema";
import { publicUser } from "@/lib/auth";
import { getAuthUserId } from "@/lib/session";
import { syncAllSettlementsThrottled } from "@/lib/sync-throttle";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureSeeded();
  await syncAllSettlementsThrottled();

  const uid = await getAuthUserId(req);
  if (!uid) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const [user] = await db.select().from(appUser).where(eq(appUser.id, uid));
  if (!user) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 401 });
  }

  return NextResponse.json({ user: publicUser(user) });
}
