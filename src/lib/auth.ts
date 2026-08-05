import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import type { AppUserRow } from "@/db/schema";

/**
 * Hachage des mots de passe (scrypt) + helpers de profil.
 * Uniquement utilisé dans les route handlers Node (pas le middleware edge).
 */

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

/** Profil public (jamais le hash du mot de passe). */
export function publicUser(u: AppUserRow) {
  const { passwordHash: _ph, ...rest } = u;
  return rest;
}
