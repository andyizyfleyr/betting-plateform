import { timingSafeEqual } from "crypto";
import { count, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser, matches, predictionQuestions } from "@/db/schema";
import { invalidatePublicApiCaches } from "@/lib/response-cache";
import { retrainAllMlModels } from "@/lib/ml-engine";
import { getAuthUserId } from "@/lib/session";
import { syncPlatformStateThrottled } from "@/lib/sync-throttle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN_UNAUTH_CRON_INTERVAL_MS = 10 * 60_000;
let lastCronRunAtMs = 0;

function safeBearerEquals(headerValue: string | null, expectedSecret: string): boolean {
  if (!headerValue) return false;
  const expected = `Bearer ${expectedSecret}`;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Point d'entrée autonome pour Vercel Cron ou tout moniteur externe (UptimeRobot, etc.).
 * Force une synchronisation complète du moteur de matchs séquentiels, des règlements
 * de paris simples / combinés / prédictions, du vivier de questions et du nettoyage
 * des manches ou sessions de paiement expirées — même avec 0 visiteur humain.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    if (!safeBearerEquals(req.headers.get("authorization"), cronSecret)) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
  } else {
    // Si CRON_SECRET n'est pas défini, n'autorise qu'un admin authentifié ou au maximum
    // 1 exécution toutes les 10 minutes pour empêcher tout épuisement malveillant du quota Neon.
    const uid = await getAuthUserId(req);
    let isAdmin = false;
    if (uid) {
      const [u] = await db
        .select({ role: appUser.role })
        .from(appUser)
        .where(eq(appUser.id, uid));
      isAdmin = u?.role === "admin";
    }
    const now = Date.now();
    if (!isAdmin && now - lastCronRunAtMs < MIN_UNAUTH_CRON_INTERVAL_MS) {
      return NextResponse.json(
        { error: "Cron déjà exécuté récemment" },
        { status: 429 }
      );
    }
    lastCronRunAtMs = now;
  }

  try {
    await ensureSeeded();
    await syncPlatformStateThrottled(true);
    const ml = await retrainAllMlModels();
    invalidatePublicApiCaches();

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
