import { schedulePushNotifications } from "@/lib/push-notifications";
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser, betDisputes } from "@/db/schema";
import { formatServerErrorResponse } from "@/lib/db-error";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";
async function admin(req: NextRequest) {
  await ensureSeeded();
  const uid = await requireUserId(req);
  if (typeof uid !== "number") return uid;
  const [user] = await db.select({ role: appUser.role }).from(appUser).where(eq(appUser.id, uid));
  return user?.role === "admin" ? uid : NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
}
export async function GET(req: NextRequest) {
  try {
    const uid = await admin(req);
    if (typeof uid !== "number") return uid;
    const disputes = await db.select({ dispute: betDisputes, userName: appUser.name })
      .from(betDisputes).innerJoin(appUser, eq(appUser.id, betDisputes.userId))
      .orderBy(desc(betDisputes.createdAt)).limit(200);
    return NextResponse.json({ disputes }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return formatServerErrorResponse(e, "GET /api/admin/disputes"); }
}
export async function PATCH(req: NextRequest) {
  try {
    const uid = await admin(req);
    if (typeof uid !== "number") return uid;
    const data = await req.json().catch(() => null);
    const id = Number(data?.id);
    const status = data?.status;
    const reply = typeof data?.reply === "string" ? data.reply.trim() : "";
    if (!Number.isSafeInteger(id) || id <= 0 || !["in_review", "resolved"].includes(status) || reply.length > 2000 || (status === "resolved" && reply.length < 2))
      return NextResponse.json({ error: "Réponse ou statut invalide" }, { status: 400 });
    const [dispute] = await db.update(betDisputes).set({ status, adminReply: reply || null, updatedAt: new Date() })
      .where(eq(betDisputes.id, id)).returning();
    if (!dispute) return NextResponse.json({ error: "Réclamation introuvable" }, { status: 404 });
  schedulePushNotifications();
    return NextResponse.json({ dispute });
  } catch (e) { return formatServerErrorResponse(e, "PATCH /api/admin/disputes"); }
}
