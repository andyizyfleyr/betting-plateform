import { NextRequest, NextResponse } from "next/server";
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
  }
  const res = NextResponse.json({ ok: true });
  clearAuthCookie(res);
  return res;
}
