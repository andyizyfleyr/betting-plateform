import { NextRequest, NextResponse } from "next/server";
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

export async function signSession(payload: JwtPayload): Promise<string> {
  return signJwt(payload);
}

export async function setAuthCookie(res: NextResponse, token: string) {
  res.cookies.set(AUTH_COOKIE, token, { ...cookieOpts, maxAge: TTL_SECONDS });
}

export function clearAuthCookie(res: NextResponse) {
  res.cookies.set(AUTH_COOKIE, "", { ...cookieOpts, maxAge: 0 });
}

/** Id utilisateur authentifié (via cookie JWT), ou null. */
export async function getAuthUserId(req: NextRequest): Promise<number | null> {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyJwt(token);
  return payload?.sub ?? null;
}