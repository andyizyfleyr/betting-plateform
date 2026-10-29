import { and, eq, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { favoriteTeams, matches } from "@/db/schema";
import { formatServerErrorResponse } from "@/lib/db-error";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await ensureSeeded();
    const uid = await requireUserId(req);
    if (typeof uid !== "number") return uid;
    const teams = await db.select().from(favoriteTeams).where(eq(favoriteTeams.userId, uid));
    return NextResponse.json({ teams }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return formatServerErrorResponse(e, "GET /api/favorites"); }
}

export async function POST(req: NextRequest) {
  try {
    await ensureSeeded();
    const uid = await requireUserId(req);
    if (typeof uid !== "number") return uid;
    const data = await req.json().catch(() => null);
    const name = typeof data?.teamName === "string" ? data.teamName.trim() : "";
    if (!name || name.length > 120 || typeof data?.following !== "boolean")
      return NextResponse.json({ error: "Club ou action invalide" }, { status: 400 });
    const key = name.normalize("NFKC").toLocaleLowerCase("fr");
    if (data.following) {
      // N'accepter que les clubs connus du catalogue de matchs.
      const [known] = await db.select({ id: matches.id }).from(matches)
        .where(or(eq(matches.homeTeam, name), eq(matches.awayTeam, name))).limit(1);
      if (!known) return NextResponse.json({ error: "Club introuvable" }, { status: 404 });
      await db.insert(favoriteTeams).values({ userId: uid, teamKey: key, teamName: name }).onConflictDoNothing();
    } else {
      await db.delete(favoriteTeams).where(and(eq(favoriteTeams.userId, uid), eq(favoriteTeams.teamKey, key)));
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return formatServerErrorResponse(e, "POST /api/favorites"); }
}
