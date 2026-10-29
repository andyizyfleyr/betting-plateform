import { hasSecondFactor, verifySecondFactor } from "@/lib/two-factor";
import { recordSecurityAlert } from "@/lib/security-alerts";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser } from "@/db/schema";
import {
  AUTH_EMAIL_RE,
  publicUser,
  runDummyPasswordCheck,
  verifyPassword,
} from "@/lib/auth";
import { formatServerErrorResponse } from "@/lib/db-error";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  MOBILE_ANDROID_CLIENT,
  MOBILE_CLIENT_HEADER,
  setAuthCookie,
  signSession,
} from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`login:${ip}`, 10, 5 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Trop de tentatives. Réessayez dans ${rl.retryAfterSec}s.` },
      { status: 429 }
    );
  }

  let body: { email?: string; password?: string; rememberMe?: boolean; totpCode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const email = (body.email ?? "").toString().trim().toLowerCase();
  const password = (body.password ?? "").toString();
  const rememberMe = body.rememberMe !== false;

  if (!email || !password) {
    return NextResponse.json(
      { error: "Veuillez renseigner votre e-mail et votre mot de passe." },
      { status: 400 }
    );
  }
  if (!AUTH_EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Format d'adresse e-mail invalide." },
      { status: 400 }
    );
  }

  try {
    await ensureSeeded();

    const [user] = await db
      .select()
      .from(appUser)
      .where(eq(appUser.email, email))
      .limit(1);

    if (!user || !user.passwordHash) {
      runDummyPasswordCheck(password);
      return NextResponse.json(
        { error: "Identifiants incorrects. Vérifiez votre e-mail et votre mot de passe." },
        { status: 401 }
      );
    }

    if (!verifyPassword(password, user.passwordHash)) {
      return NextResponse.json(
        { error: "Identifiants incorrects. Vérifiez votre e-mail et votre mot de passe." },
        { status: 401 }
      );
    }

    if (await hasSecondFactor(user.id)) {
      const code = typeof body.totpCode === "string" ? body.totpCode.trim() : "";
      if (!code) return NextResponse.json({ error: "Saisissez votre code d’authentification à 6 chiffres.", code: "TOTP_REQUIRED" }, { status: 401 });
      if (!await verifySecondFactor(user.id, code)) return NextResponse.json({ error: "Code d’authentification invalide ou temporairement verrouillé." }, { status: 401 });
    }

    const token = await signSession(
      {
        sub: user.id,
        role: user.role ?? "user",
        tv: user.tokenVersion ?? 0,
      },
      { rememberMe }
    );
    const isAndroidMobile =
      req.headers.get(MOBILE_CLIENT_HEADER)?.toLowerCase() === MOBILE_ANDROID_CLIENT;
    const res = NextResponse.json(
      isAndroidMobile ? { user: publicUser(user), token } : { user: publicUser(user) }
    );
    await setAuthCookie(res, token, { rememberMe });
    await recordSecurityAlert(user.id, "login");
    return res;
  } catch (err) {
    return formatServerErrorResponse(err, "POST /api/auth/login");
  }
}
