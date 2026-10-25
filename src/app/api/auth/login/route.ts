import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser } from "@/db/schema";
import { publicUser, verifyPassword } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { setAuthCookie, signSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`login:${ip}`, 10, 5 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Trop de tentatives. Réessayez dans ${rl.retryAfterSec}s.` },
      { status: 429 }
    );
  }

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
  setAuthCookie(
    res,
    await signSession({
      sub: user.id,
      role: user.role ?? "user",
      tv: user.tokenVersion ?? 0,
    })
  );
  return res;
}
