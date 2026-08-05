import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser } from "@/db/schema";
import { publicUser } from "@/lib/auth";
import { getAuthUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureSeeded();
  const uid = (await getAuthUserId(req)) ?? 1;
  const [user] = await db.select().from(appUser).where(eq(appUser.id, uid));
  if (!user) return NextResponse.json({ user: null }, { status: 404 });
  return NextResponse.json({ user: publicUser(user) });
}

export async function PATCH(req: NextRequest) {
  await ensureSeeded();
  const uid = (await getAuthUserId(req)) ?? 1;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  // Rechargement du solde (démo)
  if (body.action === "deposit") {
    const amount = Number(body.amount);
    if (!amount || amount <= 0 || amount > 10000) {
      return NextResponse.json({ error: "Montant invalide" }, { status: 400 });
    }
    const [user] = await db
      .update(appUser)
      .set({ balance: sql`${appUser.balance} + ${amount}` })
      .where(eq(appUser.id, uid))
      .returning();
    return NextResponse.json({ user: publicUser(user) });
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
    .where(eq(appUser.id, uid))
    .returning();

  return NextResponse.json({ user: publicUser(user) });
}