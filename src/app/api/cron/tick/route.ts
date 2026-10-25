import { count, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { matches, predictionQuestions } from "@/db/schema";
import { retrainAllMlModels } from "@/lib/ml-engine";
import { syncPlatformStateThrottled } from "@/lib/sync-throttle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Point d'entrée autonome pour Vercel Cron ou tout moniteur externe (UptimeRobot, etc.).
 * Force une synchronisation complète du moteur de matchs séquentiels, des règlements
 * de paris simples / combinés / prédictions, du vivier de questions et du nettoyage
 * des manches ou sessions de paiement expirées — même avec 0 visiteur humain.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
  }

  try {
    await ensureSeeded();
    await syncPlatformStateThrottled(true);
    const ml = await retrainAllMlModels();

    const [[liveRow], [upcomingCount], [openPreds]] = await Promise.all([
      db
        .select({
          id: matches.id,
          homeTeam: matches.homeTeam,
          awayTeam: matches.awayTeam,
          minute: matches.minute,
          homeScore: matches.homeScore,
          awayScore: matches.awayScore,
        })
        .from(matches)
        .where(eq(matches.status, "live"))
        .limit(1),
      db
        .select({ n: count() })
        .from(matches)
        .where(eq(matches.status, "upcoming")),
      db
        .select({ n: count() })
        .from(predictionQuestions)
        .where(eq(predictionQuestions.status, "open")),
    ]);

    return NextResponse.json({
      ok: true,
      syncedAt: new Date().toISOString(),
      liveMatch: liveRow ?? null,
      upcomingCount: upcomingCount?.n ?? 0,
      openPredictions: openPreds?.n ?? 0,
      mlVersion: ml.sharpMeta.version,
    });
  } catch (err) {
    console.error("[cron/tick] failed:", err);
    return NextResponse.json({ ok: false, error: "Erreur de synchronisation" }, { status: 500 });
  }
}
