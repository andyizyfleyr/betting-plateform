import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser } from "@/db/schema";
import { publicUser } from "@/lib/auth";
import { formatServerErrorResponse } from "@/lib/db-error";
import { getAuthUserId } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Met à jour le nom et/ou l'email du compte connecté. */
export async function PATCH(req: NextRequest) {
  try {
    await ensureSeeded();
    const uid = await getAuthUserId(req);
    if (!uid) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    let body: { name?: unknown; email?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    }

    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : undefined;
    const email = typeof body.email === "string" ? body.email.trim().slice(0, 160) : undefined;

    if (name !== undefined && name.length === 0) {
      return NextResponse.json({ error: "Le nom ne peut pas être vide" }, { status: 400 });
    }
    if (email !== undefined && !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Email invalide" }, { status: 400 });
    }

    if (email !== undefined) {
      const [existing] = await db
        .select({ id: appUser.id })
        .from(appUser)
        .where(eq(appUser.email, email))
        .limit(1);
      if (existing && existing.id !== uid) {
        return NextResponse.json({ error: "Cet email est déjà utilisé" }, { status: 409 });
      }
    }

    const [updated] = await db
      .update(appUser)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(email !== undefined ? { email } : {}),
      })
      .where(eq(appUser.id, uid))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
    }

    return NextResponse.json({ user: publicUser(updated) });
  } catch (err) {
    return formatServerErrorResponse(err, "PATCH /api/auth/me");
  }
}
