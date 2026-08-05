import { NextRequest, NextResponse } from "next/server";
import { clearAuthCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  clearAuthCookie(res);
  return res;
}
