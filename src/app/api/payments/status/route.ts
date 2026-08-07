import { NextRequest, NextResponse } from "next/server";
import { ensureSeeded } from "@/db/seed";
import { getDepositStatus } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureSeeded();
  const ref = req.nextUrl.searchParams.get("ref");
  if (!ref) {
    return NextResponse.json({ error: "Référence manquante" }, { status: 400 });
  }
  const status = await getDepositStatus(ref);
  return NextResponse.json(status);
}