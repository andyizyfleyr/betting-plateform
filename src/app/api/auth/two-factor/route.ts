import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
/** Not exposed until recovery and existing-session security have been validated. */
export function GET() {
  return NextResponse.json({ available: false, enabled: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
export function POST() {
  return NextResponse.json({ error: "La double authentification n'est pas encore disponible." }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
