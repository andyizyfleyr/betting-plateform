import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appUser } from "@/db/schema";
import { AUTH_COOKIE, signJwt, verifyJwt, type JwtPayload } from "@/lib/jwt";

export { AUTH_COOKIE, verifyJwt };
export type { JwtPayload };

const TTL_SECONDS = 7 * 24 * 3600; // 7 jours

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
 * afin qu'une session déconnectée soit révoquée sur toutes les instances serverless.
 */
export async function getAuthUserId(req: NextRequest): Promise<number | null> {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyJwt(token);
  if (!payload?.sub) return null;

  const uid = Number(payload.sub);
  if (!Number.isFinite(uid) || uid <= 0) return null;

  // Vérifie l'existence du compte et la version du jeton si présente dans le JWT
  const [row] = await db
    .select({ id: appUser.id, tokenVersion: appUser.tokenVersion })
    .from(appUser)
    .where(eq(appUser.id, uid))
    .limit(1);

  if (!row) return null;
  if (typeof payload.tv === "number" && payload.tv !== (row.tokenVersion ?? 0)) {
    return null;
  }

  return row.id;
}

/**
 * Exige un utilisateur authentifié : renvoie l'`uid` ou une réponse HTTP 401 stricte
 * (aucun repli implicite sur l'utilisateur #1).
 */
export async function requireUserId(req: NextRequest): Promise<number | NextResponse> {
  const uid = await getAuthUserId(req);
  if (!uid) {
    return NextResponse.json({ error: "Session expirée, veuillez vous reconnecter" }, { status: 401 });
  }
  return uid;
}
