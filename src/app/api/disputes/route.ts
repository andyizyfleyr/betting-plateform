import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { bets, betDisputes, comboBets, predictionBets } from "@/db/schema";
import { formatServerErrorResponse } from "@/lib/db-error";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    await ensureSeeded();
    const uid = await requireUserId(req);
    if (typeof uid !== "number") return uid;
    const disputes = await db.select().from(betDisputes).where(eq(betDisputes.userId, uid))
      .orderBy(desc(betDisputes.createdAt)).limit(100);
    return NextResponse.json({ disputes }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return formatServerErrorResponse(e, "GET /api/disputes"); }
}
export async function POST(req: NextRequest) {
  try {
    await ensureSeeded();
    const uid = await requireUserId(req);
    if (typeof uid !== "number") return uid;
    const data = await req.json().catch(() => null);
    const id = Number(data?.betId);
    const kind = data?.betKind;
    const message = typeof data?.message === "string" ? data.message.trim() : "";
    if (!Number.isSafeInteger(id) || id <= 0 || !["sport", "prediction", "combo"].includes(kind) || message.length < 10 || message.length > 2000)
      return NextResponse.json({ error: "Ticket ou message invalide (10 à 2 000 caractères)" }, { status: 400 });
    const table = kind === "sport" ? bets : kind === "prediction" ? predictionBets : comboBets;
    const [ticket] = await db.select({ id: table.id }).from(table)
      .where(and(eq(table.id, id), eq(table.userId, uid))).limit(1);
    if (!ticket) return NextResponse.json({ error: "Ticket introuvable" }, { status: 404 });
    const [dispute] = await db.insert(betDisputes).values({ userId: uid, betId: id, betKind: kind, message }).onConflictDoNothing().returning();
    if (!dispute) return NextResponse.json({ error: "Une réclamation est déjà en cours pour ce ticket." }, { status: 409 });
    return NextResponse.json({ dispute }, { status: 201 });
  } catch (e) { return formatServerErrorResponse(e, "POST /api/disputes"); }
}
