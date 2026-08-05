import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser } from "@/db/schema";
import { hashPassword, publicUser } from "@/lib/auth";
import { setAuthCookie, signSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  await ensureSeeded();

  let body: { name?: string; email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const name = (body.name ?? "").toString().trim().slice(0, 40);
  const email = (body.email ?? "").toString().trim().toLowerCase();
  const password = (body.password ?? "").toString();

  if (!name) {
    return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Adresse e-mail invalide" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "Le mot de passe doit contenir au moins 6 caractères" },
      { status: 400 }
    );
  }

  const existing = await db
    .select({ id: appUser.id })
    .from(appUser)
    .where(eq(appUser.email, email))
    .limit(1);
  if (existing[0]) {
    return NextResponse.json(
      { error: "Un compte existe déjà avec cet e-mail" },
      { status: 409 }
    );
  }

  const [user] = await db
    .insert(appUser)
    .values({
      name,
      email,
      passwordHash: hashPassword(password),
      balance: 250,
    })
    .returning();

  const res = NextResponse.json({ user: publicUser(user) });
  setAuthCookie(res, await signSession({ sub: user.id }));
  return res;
}
