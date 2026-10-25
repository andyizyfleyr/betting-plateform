import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser } from "@/db/schema";
import { publicUser } from "@/lib/auth";
import { formatServerErrorResponse } from "@/lib/db-error";
import { clearAuthCookie, getAuthUserId } from "@/lib/session";
import { syncAllSettlementsThrottled } from "@/lib/sync-throttle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    await ensureSeeded();
    await syncAllSettlementsThrottled();

    const uid = await getAuthUserId(req);
    if (!uid) {
      const res = NextResponse.json({ error: "Non authentifié" }, { status: 401 });
      clearAuthCookie(res);
      return res;
    }

    const [user] = await db.select().from(appUser).where(eq(appUser.id, uid));
    if (!user) {
      const res = NextResponse.json({ error: "Compte introuvable" }, { status: 401 });
      clearAuthCookie(res);
      return res;
    }

    return NextResponse.json({ user: publicUser(user) });
  } catch (err) {
    return formatServerErrorResponse(err, "GET /api/auth/me");
  }
}
