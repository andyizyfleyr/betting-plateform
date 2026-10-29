import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
/** Funds cannot move until dispute resolution and payout integration are complete. */
function unavailable() {
  return NextResponse.json({ error: "Le séquestre n'est pas encore disponible." }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
export const GET = unavailable;
export const POST = unavailable;
