import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { sql } from "drizzle-orm";
import { db, ensureHealthyDbConnection } from "@/db";

export const RESET_CODE_TTL_MINUTES = 15;
export const RESET_CODE_MAX_ATTEMPTS = 5;

let resetTableReady = false;

/**
 * Crée de façon idempotente la table PostgreSQL des jetons de réinitialisation
 * (y compris sur une base Neon de production déjà initialisée).
 */
export async function ensurePasswordResetTable(): Promise<void> {
  if (resetTableReady) return;
  await ensureHealthyDbConnection();
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" integer NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
      "email" text NOT NULL,
      "code_hash" text NOT NULL,
      "attempts" integer DEFAULT 0 NOT NULL,
      "used_at" timestamp,
      "expires_at" timestamp NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "password_reset_tokens_email_exp_idx"
    ON "password_reset_tokens" ("email", "expires_at" DESC);
  `);
  resetTableReady = true;
}

export function generateSixDigitResetCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

export function hashResetCode(email: string, code: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = createHash("sha256")
    .update(`${salt}:${email.toLowerCase().trim()}:${code.trim()}`)
    .digest("hex");
  return `sha256:${salt}:${digest}`;
}

export function verifyResetCode(
  email: string,
  code: string,
  stored: string
): boolean {
  const [algo, salt, hexDigest] = stored.split(":");
  if (algo !== "sha256" || !salt || !hexDigest) return false;
  try {
    const candidate = createHash("sha256")
      .update(`${salt}:${email.toLowerCase().trim()}:${code.trim()}`)
      .digest();
    const expected = Buffer.from(hexDigest, "hex");
    return (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    );
  } catch {
    return false;
  }
}

/**
 * Envoie le code de sécurité à 6 chiffres via l'API transactionnelle Resend
 * lorsque `RESEND_API_KEY` est configuré en production.
 */
export async function sendPasswordResetEmail(params: {
  to: string;
  userName: string;
  code: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return false;
  }

  const from =
    process.env.RESEND_FROM_EMAIL?.trim() ||
    "Pulse Bet Sécurité <security@pulsebets.app>";

  const safeName = params.userName.replace(/[<>&"']/g, "");
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f4f5f7;padding:32px 16px;color:#111827;">
      <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;padding:28px;">
        <div style="display:inline-block;background:#e10014;color:#ffffff;font-weight:900;font-style:italic;font-size:13px;padding:4px 10px;border-radius:8px;letter-spacing:0.4px;">
          PULSE BET
        </div>
        <h1 style="font-size:20px;font-weight:800;margin:18px 0 8px;color:#111827;">
          Code de sécurité de votre compte
        </h1>
        <p style="font-size:14px;line-height:1.55;color:#4b5563;margin:0 0 20px;">
          Bonjour ${safeName || ""}, vous avez demandé la réinitialisation de votre mot de passe Pulse Bet. Saisissez ce code à 6 chiffres pour choisir un nouveau mot de passe :
        </p>
        <div style="background:#f4f5f7;border:1px solid #e5e7eb;border-radius:14px;padding:18px;text-align:center;letter-spacing:8px;font-size:28px;font-weight:800;color:#111827;">
          ${params.code}
        </div>
        <p style="font-size:12.5px;line-height:1.5;color:#6b7280;margin:18px 0 0;">
          Ce code expire dans ${RESET_CODE_TTL_MINUTES} minutes. Si vous n'êtes pas à l'origine de cette demande, aucune action n'est requise : votre compte reste protégé.
        </p>
      </div>
    </div>
  `.trim();

  const text = `Pulse Bet — Votre code de réinitialisation est ${params.code} (valable ${RESET_CODE_TTL_MINUTES} minutes). Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: `${params.code} est votre code de sécurité Pulse Bet`,
        html,
        text,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}
