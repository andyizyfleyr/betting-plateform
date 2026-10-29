import { recordSecurityAlert } from "@/lib/security-alerts";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser, passwordResetTokens } from "@/db/schema";
import {
  AUTH_EMAIL_RE,
  hashPassword,
  publicUser,
  validateProductionPassword,
} from "@/lib/auth";
import { formatServerErrorResponse } from "@/lib/db-error";
import {
  ensurePasswordResetTable,
  RESET_CODE_MAX_ATTEMPTS,
  verifyResetCode,
} from "@/lib/password-reset";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  invalidateUserSessionCache,
  MOBILE_ANDROID_CLIENT,
  MOBILE_CLIENT_HEADER,
  setAuthCookie,
  signSession,
} from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`reset-pw:${ip}`, 8, 15 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Trop de tentatives. Réessayez dans ${rl.retryAfterSec}s.` },
      { status: 429 }
    );
  }

  let body: { email?: string; code?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const email = (body.email ?? "").toString().trim().toLowerCase();
  const code = (body.code ?? "").toString().replace(/\D/g, "").slice(0, 6);
  const password = (body.password ?? "").toString();

  if (!AUTH_EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Adresse e-mail invalide." },
      { status: 400 }
    );
  }
  if (code.length !== 6) {
    return NextResponse.json(
      { error: "Veuillez saisir le code de sécurité à 6 chiffres." },
      { status: 400 }
    );
  }

  const pwError = validateProductionPassword(password);
  if (pwError) {
    return NextResponse.json({ error: pwError }, { status: 400 });
  }

  try {
    await ensureSeeded();
    await ensurePasswordResetTable();

    const now = new Date();
    const [tokenRow] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.email, email),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now)
        )
      )
      .orderBy(desc(passwordResetTokens.id))
      .limit(1);

    if (!tokenRow || tokenRow.attempts >= RESET_CODE_MAX_ATTEMPTS) {
      return NextResponse.json(
        { error: "Code de vérification invalide ou expiré. Demandez un nouveau code." },
        { status: 400 }
      );
    }

    const validCode = verifyResetCode(email, code, tokenRow.codeHash);
    if (!validCode) {
      const nextAttempts = tokenRow.attempts + 1;
      await db
        .update(passwordResetTokens)
        .set({
          attempts: nextAttempts,
          ...(nextAttempts >= RESET_CODE_MAX_ATTEMPTS ? { usedAt: now } : {}),
        })
        .where(eq(passwordResetTokens.id, tokenRow.id));

      return NextResponse.json(
        {
          error:
            nextAttempts >= RESET_CODE_MAX_ATTEMPTS
              ? "Nombre maximal de tentatives atteint. Demandez un nouveau code."
              : "Code de vérification incorrect.",
        },
        { status: 400 }
      );
    }

    const updatedUser = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(eq(passwordResetTokens.userId, tokenRow.userId));

      const [u] = await tx
        .update(appUser)
        .set({
          passwordHash: hashPassword(password),
          tokenVersion: sql`${appUser.tokenVersion} + 1`,
        })
        .where(eq(appUser.id, tokenRow.userId))
        .returning();

      return u ?? null;
    });

    if (!updatedUser || updatedUser.role === "admin") {
      return NextResponse.json(
        { error: "Impossible de réinitialiser ce compte." },
        { status: 400 }
      );
    }

    invalidateUserSessionCache(updatedUser.id);

    const jwt = await signSession(
      {
        sub: updatedUser.id,
        role: updatedUser.role ?? "user",
        tv: updatedUser.tokenVersion ?? 0,
      },
      { rememberMe: true }
    );

    const isAndroidMobile =
      req.headers.get(MOBILE_CLIENT_HEADER)?.toLowerCase() === MOBILE_ANDROID_CLIENT;
    const res = NextResponse.json(
      isAndroidMobile
        ? { user: publicUser(updatedUser), token: jwt }
        : { user: publicUser(updatedUser) }
    );
    await setAuthCookie(res, jwt, { rememberMe: true });
    await recordSecurityAlert(updatedUser.id, "password_reset");
    return res;
  } catch (err) {
    return formatServerErrorResponse(err, "POST /api/auth/reset-password");
  }
}
