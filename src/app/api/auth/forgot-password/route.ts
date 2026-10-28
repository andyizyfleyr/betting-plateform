import { and, eq, isNull, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser, passwordResetTokens } from "@/db/schema";
import { AUTH_EMAIL_RE } from "@/lib/auth";
import { formatServerErrorResponse } from "@/lib/db-error";
import {
  ensurePasswordResetTable,
  generateSixDigitResetCode,
  hashResetCode,
  RESET_CODE_TTL_MINUTES,
  sendPasswordResetEmail,
} from "@/lib/password-reset";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const ipRl = checkRateLimit(`forgot-ip:${ip}`, 6, 15 * 60_000);
  if (!ipRl.allowed) {
    return NextResponse.json(
      { error: `Trop de demandes récentes. Réessayez dans ${ipRl.retryAfterSec}s.` },
      { status: 429 }
    );
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const email = (body.email ?? "").toString().trim().toLowerCase();
  if (!AUTH_EMAIL_RE.test(email) || email.length > 160) {
    return NextResponse.json(
      { error: "Veuillez saisir une adresse e-mail valide." },
      { status: 400 }
    );
  }

  const emailRl = checkRateLimit(`forgot-email:${email}`, 3, 15 * 60_000);
  if (!emailRl.allowed) {
    return NextResponse.json(
      { error: `Un code a déjà été demandé récemment. Réessayez dans ${emailRl.retryAfterSec}s.` },
      { status: 429 }
    );
  }

  try {
    await ensureSeeded();
    await ensurePasswordResetTable();

    // Nettoyage opportuniste léger des anciens codes expirés (> 24 h)
    if (Math.random() < 0.1) {
      void db
        .execute(
          sql`DELETE FROM "password_reset_tokens" WHERE "expires_at" < NOW() - INTERVAL '24 hours'`
        )
        .catch(() => undefined);
    }

    const [user] = await db
      .select({
        id: appUser.id,
        name: appUser.name,
        email: appUser.email,
        role: appUser.role,
      })
      .from(appUser)
      .where(eq(appUser.email, email))
      .limit(1);

    // Anti-énumération : réponse identique même si l'e-mail n'est pas enregistré
    // et exclusion des comptes administrateur de la réinitialisation publique libre.
    if (user && user.email && user.role !== "admin") {
      const code = generateSixDigitResetCode();
      const codeHash = hashResetCode(email, code);
      const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MINUTES * 60_000);

      await db
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.userId, user.id),
            isNull(passwordResetTokens.usedAt)
          )
        );

      await db.insert(passwordResetTokens).values({
        userId: user.id,
        email,
        codeHash,
        attempts: 0,
        expiresAt,
      });

      await sendPasswordResetEmail({
        to: user.email,
        userName: user.name,
        code,
      });
    }

    return NextResponse.json({
      ok: true,
      expiresInMinutes: RESET_CODE_TTL_MINUTES,
    });
  } catch (err) {
    return formatServerErrorResponse(err, "POST /api/auth/forgot-password");
  }
}
