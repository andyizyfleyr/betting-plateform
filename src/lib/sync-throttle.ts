import { isPubliclyOfferedMatch } from "@/lib/real-leagues";
import { waitUntil } from "@vercel/functions";
import {
  consumeRecentEngineMilestone,
  hydrateLiveMatchRow,
  pruneOldFinishedVirtualMatches,
  runLiveEngine,
} from "@/db/engine";
import { expireStaleAcceleratorRounds } from "@/lib/accelerator-engine";
import {
  ensureMatchStoreHydrated,
  getCachedAllMatchesForFeed,
  invalidateAllActiveCaches,
} from "@/lib/active-state-cache";
import { serializeSlimPublicMatch } from "@/lib/match-serializer";
import { PARTY_LIVE_MATCHES_ROOM, publishPartyRoomEvent } from "@/lib/partykit";
import { expireStaleGatewayDeposits } from "@/lib/payments";
import { ensureOpenPredictions, settleResolvedQuestions } from "@/lib/predictions";
import {
  hasOverdueRealMatches,
  syncRealMatchesThrottled,
  type RealSyncSummary,
} from "@/lib/real-sports-feed";
import { invalidatePublicApiCaches } from "@/lib/response-cache";
import { settleFinishedBets } from "@/lib/settle";
import { recordVisitorActivity } from "@/lib/visitor-activity";

/**
 * Orchestrateur unifié « Time-Continuum » à empreinte SQL minimale :
 * - Fait progresser les matchs virtuels en pure mémoire toutes les 3 s (sans requêter Neon
 *   en dehors des jalons réels : coup d'envoi, but/carton, fin de match).
 * - N'exécute le règlement des paris que sur jalon réel ou balayage de sécurité espacé.
 * - Espace les tâches de maintenance de fond (prédictions, dépôts expirés, purge) à 5–10 min.
 */
const SYNC_THROTTLE_MS = 3_000;
const SETTLE_SWEEP_THROTTLE_MS = 20_000;
const HOUSEKEEPING_THROTTLE_MS = 5 * 60_000;
const PRUNE_THROTTLE_MS = 10 * 60_000;
const USER_READ_FEED_BUDGET_MS = 2_600;
const MANUAL_REFRESH_FEED_BUDGET_MS = 3_600;
const WAKEUP_FEED_BUDGET_MS = 5_500;

let lastFullSyncAt = 0;
let inFlightFullSync: Promise<void> | null = null;
let lastSettleSweepAt = 0;
let lastHousekeepingAt = 0;
let lastPruneAt = 0;

function broadcastCurrentSlimSnapshot(): void {
  const nowMs = Date.now();
  const rows = getCachedAllMatchesForFeed().filter(isPubliclyOfferedMatch);
  if (rows.length === 0) return;
  const slim = rows.map((r) =>
    serializeSlimPublicMatch(hydrateLiveMatchRow(r, nowMs), nowMs)
  );
  publishPartyRoomEvent(PARTY_LIVE_MATCHES_ROOM, {
    type: "MATCHES_SNAPSHOT",
    matches: slim,
    serverTime: new Date(nowMs).toISOString(),
    ts: nowMs,
  });
}

function withTimeoutBudget<T>(promise: Promise<T>, budgetMs: number): Promise<T | "timed_out"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timed_out"), budgetMs);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve("timed_out");
      });
  });
}

export async function syncPlatformStateThrottled(
  force = false,
  opts?: { fromCron?: boolean; manualRefresh?: boolean }
): Promise<void> {
  const now = Date.now();
  const manualRefresh = Boolean(opts?.manualRefresh);
  if (!opts?.fromCron) {
    recordVisitorActivity(now);
  }
  if (!force && !manualRefresh && now - lastFullSyncAt < SYNC_THROTTLE_MS) {
    if (inFlightFullSync) await inFlightFullSync;
    await ensureMatchStoreHydrated(false);
    return;
  }
  if (inFlightFullSync) {
    await inFlightFullSync;
    if (!force && !manualRefresh) return;
  }

  inFlightFullSync = (async () => {
    try {
      if (force || manualRefresh) {
        await ensureMatchStoreHydrated(true);
      }

      const realFeedPromise = syncRealMatchesThrottled(force, {
        manualRefresh,
      }).catch((err) => {
        console.error("[syncRealMatchesThrottled] non-fatal error:", err);
        return null;
      });

      let realFeedResult: RealSyncSummary | null = null;

      if (force) {
        const [, rf] = await Promise.all([runLiveEngine(), realFeedPromise]);
        realFeedResult = rf;
      } else {
        const hasOverdue = await hasOverdueRealMatches(now).catch(() => false);
        const readBudgetMs = hasOverdue
          ? WAKEUP_FEED_BUDGET_MS
          : manualRefresh
            ? MANUAL_REFRESH_FEED_BUDGET_MS
            : USER_READ_FEED_BUDGET_MS;
        const [, feedStatus] = await Promise.all([
          runLiveEngine(),
          withTimeoutBudget(realFeedPromise, readBudgetMs),
        ]);
        if (feedStatus === "timed_out") {
          const continuation = realFeedPromise.then(async (res) => {
            if (res && (res.settledCount > 0 || res.syncedCount > 0)) {
              await settleFinishedBets().catch(() => undefined);
              invalidateAllActiveCaches(true);
              await ensureMatchStoreHydrated(true).catch(() => undefined);
              broadcastCurrentSlimSnapshot();
            }
          });
          try {
            waitUntil(continuation);
          } catch {
            void continuation;
          }
        } else {
          realFeedResult = feedStatus;
        }
      }

      const hadMilestone = consumeRecentEngineMilestone();
      const realChanged =
        Boolean(realFeedResult) &&
        ((realFeedResult?.settledCount ?? 0) > 0 || (realFeedResult?.syncedCount ?? 0) > 0);
      // Ne purge plus les caches publics à chaque tick : les simples changements de minute
      // restent bornés par le TTL mémoire/Edge. Les vrais jalons (but, statut, feed réel)
      // déclenchent toujours une invalidation immédiate.
      if (manualRefresh || realChanged || hadMilestone) {
        invalidatePublicApiCaches(realChanged || hadMilestone);
      }
      const settleNow = Date.now();

      if (
        force ||
        manualRefresh ||
        hadMilestone ||
        realChanged ||
        settleNow - lastSettleSweepAt >= SETTLE_SWEEP_THROTTLE_MS
      ) {
        lastSettleSweepAt = settleNow;
        await Promise.all([settleFinishedBets(), settleResolvedQuestions()]);
      } else {
        // Vérification 0-SQL en RAM tant que la prochaine question n'est pas échue
        await settleResolvedQuestions();
      }

      if (realChanged || hadMilestone) {
        broadcastCurrentSlimSnapshot();
      }

      const hkNow = Date.now();
      if (force || hkNow - lastHousekeepingAt >= HOUSEKEEPING_THROTTLE_MS) {
        lastHousekeepingAt = hkNow;
        await Promise.all([
          ensureOpenPredictions(hkNow),
          expireStaleAcceleratorRounds(hkNow),
          expireStaleGatewayDeposits(),
        ]);
      }

      if (hkNow - lastPruneAt >= PRUNE_THROTTLE_MS) {
        lastPruneAt = hkNow;
        await pruneOldFinishedVirtualMatches().catch((err) => {
          console.error("[pruneOldFinishedVirtualMatches]", err);
        });
      }

      lastFullSyncAt = Date.now();
    } finally {
      inFlightFullSync = null;
    }
  })();

  await inFlightFullSync;
}

export async function syncLiveMatchesThrottled(
  force = false,
  opts?: { manualRefresh?: boolean }
): Promise<void> {
  await syncPlatformStateThrottled(force, opts);
}

export async function syncAllSettlementsThrottled(
  force = false,
  opts?: { manualRefresh?: boolean }
): Promise<void> {
  await syncPlatformStateThrottled(force, opts);
}

export function resetSyncThrottle(): void {
  lastFullSyncAt = 0;
  lastSettleSweepAt = 0;
  lastHousekeepingAt = 0;
  invalidateAllActiveCaches();
}
