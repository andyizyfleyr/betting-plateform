import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appUser } from "@/db/schema";
import { publicUser } from "@/lib/auth";
import { getAuthUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
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
