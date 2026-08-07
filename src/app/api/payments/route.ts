import { NextResponse } from "next/server";
import { paymentProviders } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ providers: paymentProviders() });
}