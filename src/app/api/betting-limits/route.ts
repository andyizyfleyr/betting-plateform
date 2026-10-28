import { NextResponse } from "next/server";
import { ensureSeeded } from "@/db/seed";
import { getBettingLimits } from "@/lib/betting-limits";

export const dynamic = "force-dynamic";
export async function GET() {
  await ensureSeeded();
  return NextResponse.json(await getBettingLimits(), { headers: { "Cache-Control": "no-store" } });
}
