import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json(
      { status: "ok", db: true, rttMs: Date.now() - startedAt, ts: Date.now() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { status: "error", db: false, rttMs: Date.now() - startedAt, ts: Date.now() },
      { status: 503 }
    );
  }
}
