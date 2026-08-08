import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser } from "@/db/schema";
import { publicUser, verifyPassword } from "@/lib/auth";
import { setAuthCookie, signSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  await ensureSeeded();

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const email = (body.email ?? "").toString().trim().toLowerCase();
  const password = (body.password ?? "").toString();

  if (!email || !password) {
    return NextResponse.json(
      { error: "E-mail et mot de passe requis" },
      { status: 400 }
    );
  }

  const [user] = await db
    .select()
    .from(appUser)
    .where(eq(appUser.email, email))
    .limit(1);

  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json(
      { error: "E-mail ou mot de passe incorrect" },
      { status: 401 }
    );
  }

  const res = NextResponse.json({ user: publicUser(user) });
  setAuthCookie(res, await signSession({ sub: user.id, role: user.role ?? "user" }));
  return res;
}
