import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser } from "@/db/schema";
import { publicUser } from "@/lib/auth";
import { formatServerErrorResponse } from "@/lib/db-error";
import { clearAuthCookie, requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    await ensureSeeded();
    const auth = await requireUserId(req);
    if (typeof auth !== "number") return auth;
    const [user] = await db.select().from(appUser).where(eq(appUser.id, auth));
    if (!user) {
      const res = NextResponse.json({ error: "Compte introuvable" }, { status: 401 });
      clearAuthCookie(res);
      return res;
    }
    return NextResponse.json({ user: publicUser(user) });
  } catch (err) {
    return formatServerErrorResponse(err, "GET /api/settings");
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureSeeded();
    const auth = await requireUserId(req);
    if (typeof auth !== "number") return auth;

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    }

    const patch: Partial<typeof appUser.$inferInsert> = {};
    if (typeof body.notifications === "boolean") patch.notifications = body.notifications;
    if (typeof body.sound === "boolean") patch.sound = body.sound;
    if (typeof body.haptics === "boolean") patch.haptics = body.haptics;
    if (typeof body.liveSim === "boolean") patch.liveSim = body.liveSim;
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 40);
    if (body.oddsFormat === "decimal" || body.oddsFormat === "fractional")
      patch.oddsFormat = body.oddsFormat;
    if (body.language === "fr" || body.language === "en") patch.language = body.language;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Aucune modification" }, { status: 400 });
    }

    const [user] = await db
      .update(appUser)
      .set(patch)
      .where(eq(appUser.id, auth))
      .returning();

    return NextResponse.json({ user: publicUser(user) });
  } catch (err) {
    return formatServerErrorResponse(err, "PATCH /api/settings");
  }
}
