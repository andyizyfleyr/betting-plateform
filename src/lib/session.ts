import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appUser } from "@/db/schema";
import { AUTH_COOKIE, signJwt, verifyJwt, type JwtPayload } from "@/lib/jwt";

export { AUTH_COOKIE, verifyJwt };
export type { JwtPayload };

const TTL_SECONDS = 7 * 24 * 3600; // 7 jours
const SESSION_TV_CACHE_TTL_MS = 20_000;
const SESSION_TV_CACHE_MAX = 2_000;

const tokenVersionCache = new Map<
  number,
  { tokenVersion: number; expiresAt: number }
>();

export function invalidateUserSessionCache(userId?: number) {
  if (typeof userId === "number") {
    tokenVersionCache.delete(userId);
  } else {
    tokenVersionCache.clear();
  }
}

export function primeUserSessionCache(userId: number, tokenVersion: number) {
  if (tokenVersionCache.size >= SESSION_TV_CACHE_MAX) {
    const firstKey = tokenVersionCache.keys().next().value;
    if (firstKey !== undefined) tokenVersionCache.delete(firstKey);
  }
  tokenVersionCache.set(userId, {
    tokenVersion,
    expiresAt: Date.now() + SESSION_TV_CACHE_TTL_MS,
  });
}

const cookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export interface SessionPayload extends JwtPayload {
  sub: number;
  role?: string;
  tv?: number; // tokenVersion persisté en base
}

export async function signSession(payload: SessionPayload): Promise<string> {
  if (typeof payload.sub === "number" && typeof payload.tv === "number") {
    primeUserSessionCache(payload.sub, payload.tv);
  }
  return signJwt(payload);
}

export async function setAuthCookie(res: NextResponse, token: string) {
  res.cookies.set(AUTH_COOKIE, token, { ...cookieOpts, maxAge: TTL_SECONDS });
}

export function clearAuthCookie(res: NextResponse) {
  res.cookies.set(AUTH_COOKIE, "", { ...cookieOpts, maxAge: 0 });
}

/**
 * Vérifie la signature JWT ET la version du jeton en base de données
 * (avec mémoïsation mémoire 20 s invalidée dès la déconnexion / suppression)
 * afin d'économiser 1 requête SQL sur > 90 % des appels API authentifiés.
 */
export async function getAuthUserId(req: NextRequest): Promise<number | null> {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyJwt(token);
  if (!payload?.sub) return null;

  const uid = Number(payload.sub);
  if (!Number.isFinite(uid) || uid <= 0) return null;

  const now = Date.now();
  const cached = tokenVersionCache.get(uid);
  if (cached && cached.expiresAt > now) {
    if (typeof payload.tv === "number" && payload.tv !== cached.tokenVersion) {
      return null;
    }
    return uid;
  }

  // Vérifie l'existence du compte et la version du jeton si présente dans le JWT
  const [row] = await db
    .select({ id: appUser.id, tokenVersion: appUser.tokenVersion })
    .from(appUser)
    .where(eq(appUser.id, uid))
    .limit(1);

  if (!row) {
    tokenVersionCache.delete(uid);
    return null;
  }

  const tv = row.tokenVersion ?? 0;
  primeUserSessionCache(uid, tv);

  if (typeof payload.tv === "number" && payload.tv !== tv) {
    return null;
  }

  return row.id;
}

/**
 * Exige un utilisateur authentifié : renvoie l'`uid` ou une réponse HTTP 401 stricte
 * en effaçant immédiatement le cookie obsolète pour éviter toute boucle avec `proxy.ts`.
 */
export async function requireUserId(req: NextRequest): Promise<number | NextResponse> {
  const uid = await getAuthUserId(req);
  if (!uid) {
    const res = NextResponse.json(
      { error: "Session expirée, veuillez vous reconnecter", code: "SESSION_EXPIRED" },
      { status: 401 }
    );
    clearAuthCookie(res);
    return res;
  }
  return uid;
}
