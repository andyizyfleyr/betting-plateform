"use client";

import type { ClientUser } from "@/lib/api";

/**
 * Miroir local des réglages choisis par le joueur.
 * Le serveur reste la source de vérité, mais ce miroir garantit que les choix
 * (cotes, sons, vibrations, notifications…) survivent à une fermeture de
 * l'application, même si la lecture réseau est lente ou incomplète.
 * Il permet aussi de re-pousser automatiquement les valeurs au serveur
 * lorsqu'elles divergent (auto-réparation).
 */
export type UserPreferences = Partial<
  Pick<
    ClientUser,
    | "oddsFormat"
    | "sound"
    | "haptics"
    | "notifications"
    | "notifyMatches"
    | "notifyBets"
    | "notifyPayments"
    | "notifyDisputes"
    | "language"
  >
>;

const PREFS_STORAGE_KEY = "pulsebet_user_prefs_v1";

export const USER_PREFERENCE_FIELDS = [
  "oddsFormat",
  "sound",
  "haptics",
  "notifications",
  "notifyMatches",
  "notifyBets",
  "notifyPayments",
  "notifyDisputes",
  "language",
] as const;

interface StoredPreferences {
  userId: number | null;
  prefs: UserPreferences;
}

function readStored(): StoredPreferences {
  if (typeof window === "undefined") return { userId: null, prefs: {} };
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { userId: null, prefs: {} };
    const parsed = JSON.parse(raw) as {
      userId?: unknown;
      prefs?: unknown;
    };
    return {
      userId: typeof parsed.userId === "number" ? parsed.userId : null,
      prefs:
        parsed.prefs && typeof parsed.prefs === "object"
          ? (parsed.prefs as UserPreferences)
          : {},
    };
  } catch {
    return { userId: null, prefs: {} };
  }
}

export function readUserPreferences(userId: number | null | undefined): UserPreferences {
  if (typeof window === "undefined" || !userId) return {};
  const stored = readStored();
  return stored.userId === userId ? stored.prefs : {};
}

export function writeUserPreferences(
  userId: number | null | undefined,
  patch: Partial<ClientUser>
): void {
  if (typeof window === "undefined" || !userId) return;
  const stored = readStored();
  const next: UserPreferences = stored.userId === userId ? { ...stored.prefs } : {};
  let changed = false;
  for (const field of USER_PREFERENCE_FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    if ((next as Record<string, unknown>)[field] !== value) changed = true;
    (next as Record<string, unknown>)[field] = value;
  }
  if (!changed && stored.userId === userId) return;
  try {
    window.localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({ userId, prefs: next })
    );
  } catch {
    /* silencieux */
  }
}

/** Fusionne les préférences locales avec le profil serveur. */
export function mergeUserPreferences(user: ClientUser): {
  user: ClientUser;
  drift: UserPreferences | null;
} {
  const prefs = readUserPreferences(user.id);
  const keys = Object.keys(prefs) as (keyof UserPreferences)[];
  if (keys.length === 0) return { user, drift: null };

  const drift: UserPreferences = {};
  let hasDrift = false;
  for (const key of keys) {
    const local = prefs[key];
    if (local === undefined) continue;
    if (user[key] !== local) {
      (drift as Record<string, unknown>)[key] = local;
      hasDrift = true;
    }
  }
  return { user: { ...user, ...prefs }, drift: hasDrift ? drift : null };
}
