import { NextResponse } from "next/server";
import { publicPaymentClientConfig } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(publicPaymentClientConfig());
}
