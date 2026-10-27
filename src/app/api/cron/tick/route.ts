import { timingSafeEqual } from "crypto";
import { count, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { consumeRecentEngineMilestone, runLiveEngine } from "@/db/engine";
import { ensureSeeded } from "@/db/seed";
import { appUser, matches, predictionQuestions } from "@/db/schema";
import {
  ensureMatchStoreHydrated,
  getCachedActiveVirtualMatches,
  getCachedOpenManualMatches,
  invalidateAllActiveCaches,
} from "@/lib/active-state-cache";
import { pruneExpiredIdempotencyKeys } from "@/lib/idempotency";
import { ensureMlLoaded, retrainAllMlModels } from "@/lib/ml-engine";
import { expireStaleGatewayDeposits } from "@/lib/payments";
import { ensureOpenPredictions, settleResolvedQuestions } from "@/lib/predictions";
import { syncRealMatchesThrottled } from "@/lib/real-sports-feed";
import {
  invalidatePublicApiCaches,
  rejectUnexpectedQueryParams,
} from "@/lib/response-cache";
import { getAuthUserId } from "@/lib/session";
import { settleFinishedBets } from "@/lib/settle";
import { syncPlatformStateThrottled } from "@/lib/sync-throttle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN_UNAUTH_CRON_INTERVAL_MS = 5 * 60_000;
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
 * Mode léger (« light ») conçu pour tourner toutes les 20 min (GitHub Actions / cron-job.org)
 * tout en préservant ~75 % du quota mensuel gratuit de calcul Neon PostgreSQL :
 *  - Zéro ré-entraînement ML lourd (réservé au cron nocturne 03h00 UTC de `vercel.json`).
 *  - Zéro requête ESPN si aucun match réel n'est en cours, en attente de fin ou à moins de 3h.
 *  - Clôture immédiate des matchs terminés, règlement des paris / combinés / prédictions
 *    et purge ciblée du cache Edge CDN uniquement en cas de changement réel.
 */
async function runLightCronTick() {
  const now = Date.now();
  await ensureSeeded();
  await ensureMlLoaded();
  await ensureMatchStoreHydrated();

  const openManual = getCachedOpenManualMatches().filter((m) => m.autoSync);
  const hasRelevantRealMatch = openManual.some(
    (m) =>
      m.status === "live" ||
      m.feedFinishedAt != null ||
      !m.externalId ||
      !m.feedSyncedAt ||
      m.startsAt.getTime() <= now + 3 * 3600_000
  );

  const [, realSummary] = await Promise.all([
    runLiveEngine(),
    hasRelevantRealMatch ? syncRealMatchesThrottled(false) : Promise.resolve(null),
  ]);

  const hadVirtualMilestone = consumeRecentEngineMilestone();
  const realChanged =
    Boolean(realSummary) &&
    ((realSummary?.settledCount ?? 0) > 0 || (realSummary?.syncedCount ?? 0) > 0);

  await Promise.all([settleFinishedBets(), settleResolvedQuestions()]);
  await Promise.all([ensureOpenPredictions(now), expireStaleGatewayDeposits()]);

  if (hadVirtualMilestone || realChanged) {
    invalidateAllActiveCaches(true);
  }

  await ensureMatchStoreHydrated();
  const activeVirtual = getCachedActiveVirtualMatches();
  const activeManual = getCachedOpenManualMatches();

  return {
    ok: true,
    mode: "light" as const,
    syncedAt: new Date().toISOString(),
    realFeedChecked: hasRelevantRealMatch,
    realSync: realSummary,
    activeVirtualCount: activeVirtual.length,
    openRealCount: activeManual.length,
  };
}

/**
 * Point d'entrée autonome pour Vercel Cron (03h00 UTC, mode `full`), GitHub Actions
 * (toutes les 20 min de 11h00 à 00h15 UTC, mode `light` via `X-Cron-Mode: light`) ou tout
 * moniteur externe (`cron-job.org`, UptimeRobot).
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  if (params.size > 1 || (params.size === 1 && !params.has("mode"))) {
    return rejectUnexpectedQueryParams("Seul le paramètre optionnel mode=light|full est autorisé");
  }
  const queryMode = params.get("mode");
  if (queryMode !== null && queryMode !== "light" && queryMode !== "full") {
    return rejectUnexpectedQueryParams("Valeur mode invalide (attendu : light ou full)");
  }

  const headerMode = req.headers.get("x-cron-mode")?.trim().toLowerCase();
  const ua = req.headers.get("user-agent")?.toLowerCase() ?? "";
  const isVercelNightlyCron = ua.includes("vercel-cron");
  // Par défaut, tout moniteur externe (cron-job.org, UptimeRobot…) exécute le mode `light`
  // économe en quota Neon sans nécessiter ni header ni paramètre d'URL. Le cron nocturne
  // Vercel (`03h00 UTC`, `vercel-cron/1.0`) ou `mode=full` exécute la maintenance complète + ML.
  const isFullMode =
    queryMode === "full" ||
    headerMode === "full" ||
    (isVercelNightlyCron && queryMode !== "light" && headerMode !== "light");
  const isLightMode = !isFullMode;

  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    if (!safeBearerEquals(req.headers.get("authorization"), cronSecret)) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
  } else {
    // Si CRON_SECRET n'est pas défini, n'autorise qu'un admin authentifié ou au maximum
    // 1 exécution toutes les 5 minutes pour empêcher tout épuisement malveillant du quota Neon.
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
        { ok: true, skipped: true, reason: "Cron déjà exécuté récemment" },
        { status: 200 }
      );
    }
    lastCronRunAtMs = now;
  }

  try {
    if (isLightMode) {
      const lightResult = await runLightCronTick();
      return NextResponse.json(lightResult);
    }

    await ensureSeeded();
    await syncPlatformStateThrottled(true);
    await pruneExpiredIdempotencyKeys();
    const ml = await retrainAllMlModels();
    invalidatePublicApiCaches(true);

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
      mode: "full",
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
