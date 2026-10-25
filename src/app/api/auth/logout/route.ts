import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appUser } from "@/db/schema";
import { clearAuthCookie } from "@/lib/session";
import { verifyJwt, revokeToken, AUTH_COOKIE } from "@/lib/jwt";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (token) {
    const payload = await verifyJwt(token);
    if (payload?.jti) {
      revokeToken(payload.jti);
    }
    if (payload?.sub) {
      await db
        .update(appUser)
        .set({ tokenVersion: sql`${appUser.tokenVersion} + 1` })
        .where(eq(appUser.id, Number(payload.sub)))
        .catch(() => undefined);
    }
  }
  const res = NextResponse.json({ ok: true });
  clearAuthCookie(res);
  return res;
}
