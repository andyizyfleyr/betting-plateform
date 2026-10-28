import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import type { AppUserRow } from "@/db/schema";

/**
 * Hachage des mots de passe (scrypt) + helpers de profil et validation production.
 * Uniquement utilisé dans les route handlers Node (pas le middleware edge).
 */

const DUMMY_PASSWORD_HASH =
  "scrypt:00112233445566778899aabbccddeeff:" + "a".repeat(128);

export const AUTH_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [algo, salt, hash] = stored.split(":");
  if (algo !== "scrypt" || !salt || !hash) return false;
  try {
    const test = scryptSync(pw, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return test.length === expected.length && timingSafeEqual(test, expected);
  } catch {
    return false;
  }
}

/** Lisse le temps de réponse en cas d'adresse e-mail inconnue (anti-énumération). */
export function runDummyPasswordCheck(pw: string): void {
  verifyPassword(pw || "invalid", DUMMY_PASSWORD_HASH);
}

/** Validation production d'un nouveau mot de passe (inscription & réinitialisation). */
export function validateProductionPassword(pw: string): string | null {
  if (pw.length < 8) {
    return "Le mot de passe doit contenir au moins 8 caractères.";
  }
  if (pw.length > 128) {
    return "Le mot de passe ne peut pas dépasser 128 caractères.";
  }
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(pw) || !/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw)) {
    return "Le mot de passe doit inclure au moins une lettre et un chiffre (ou symbole).";
  }
  return null;
}

/** Profil public (jamais le hash du mot de passe). */
export function publicUser(u: AppUserRow) {
  const { passwordHash: _ph, ...rest } = u;
  return rest;
}
