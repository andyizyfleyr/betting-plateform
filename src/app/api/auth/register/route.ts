import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser } from "@/db/schema";
import {
  AUTH_EMAIL_RE,
  hashPassword,
  publicUser,
  validateProductionPassword,
} from "@/lib/auth";
import {
  getOfficialCurrencyForCountry,
  isValidCountryCode,
} from "@/lib/countries";
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
  const rl = checkRateLimit(`register:${ip}`, 5, 15 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Trop de créations de compte récentes. Réessayez dans ${rl.retryAfterSec}s.` },
      { status: 429 }
    );
  }

  let body: {
    name?: string;
    email?: string;
    password?: string;
    countryCode?: string;
    acceptedTerms?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const name = (body.name ?? "").toString().trim().replace(/\s+/g, " ").slice(0, 40);
  const email = (body.email ?? "").toString().trim().toLowerCase();
  const password = (body.password ?? "").toString();
  const rawCountry = (
    body.countryCode ??
    req.headers.get("x-vercel-ip-country") ??
    req.headers.get("cf-ipcountry") ??
    ""
  )
    .toString()
    .trim()
    .toUpperCase();

  if (name.length < 2) {
    return NextResponse.json(
      { error: "Veuillez indiquer un nom ou pseudonyme (2 caractères minimum)." },
      { status: 400 }
    );
  }
  if (!isValidCountryCode(rawCountry)) {
    return NextResponse.json(
      { error: "Veuillez sélectionner votre pays de résidence." },
      { status: 400 }
    );
  }
  const countryCode = rawCountry;
  const currency = getOfficialCurrencyForCountry(countryCode);
  if (!AUTH_EMAIL_RE.test(email) || email.length > 160) {
    return NextResponse.json(
      { error: "Veuillez saisir une adresse e-mail valide." },
      { status: 400 }
    );
  }

  const pwError = validateProductionPassword(password);
  if (pwError) {
    return NextResponse.json({ error: pwError }, { status: 400 });
  }

  if (body.acceptedTerms !== true) {
    return NextResponse.json(
      { error: "Vous devez certifier avoir 18 ans révolus et accepter les conditions générales." },
      { status: 400 }
    );
  }

  try {
    await ensureSeeded();

    const existing = await db
      .select({ id: appUser.id })
      .from(appUser)
      .where(eq(appUser.email, email))
      .limit(1);
    if (existing[0]) {
      return NextResponse.json(
        { error: "Un compte existe déjà avec cette adresse e-mail." },
        { status: 409 }
      );
    }

    const [user] = await db
      .insert(appUser)
      .values({
        name,
        email,
        passwordHash: hashPassword(password),
        countryCode,
        currency,
        balance: 0,
        bonusLocked: 0,
        tokenVersion: 0,
      })
      .returning();

    const token = await signSession(
      {
        sub: user.id,
        role: user.role ?? "user",
        tv: user.tokenVersion ?? 0,
      },
      { rememberMe: true }
    );
    const isAndroidMobile =
      req.headers.get(MOBILE_CLIENT_HEADER)?.toLowerCase() === MOBILE_ANDROID_CLIENT;
    const res = NextResponse.json(
      isAndroidMobile ? { user: publicUser(user), token } : { user: publicUser(user) }
    );
    await setAuthCookie(res, token, { rememberMe: true });
    return res;
  } catch (err) {
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      return NextResponse.json(
        { error: "Un compte existe déjà avec cette adresse e-mail." },
        { status: 409 }
      );
    }
    return formatServerErrorResponse(err, "POST /api/auth/register");
  }
}
