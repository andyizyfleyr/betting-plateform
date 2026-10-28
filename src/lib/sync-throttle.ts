import { waitUntil } from "@vercel/functions";
import {
  consumeRecentEngineMilestone,
  pruneOldFinishedVirtualMatches,
  runLiveEngine,
} from "@/db/engine";
import { expireStaleAcceleratorRounds } from "@/lib/accelerator-engine";
import {
  hasLiveActiveMatches,
  invalidateAllActiveCaches,
} from "@/lib/active-state-cache";
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
const SYNC_THROTTLE_MS = 2_000;
const SETTLE_SWEEP_THROTTLE_MS = 15_000;
const HOUSEKEEPING_THROTTLE_MS = 5 * 60_000;
const PRUNE_THROTTLE_MS = 10 * 60_000;
const USER_READ_FEED_BUDGET_MS = 2_500;
const WAKEUP_FEED_BUDGET_MS = 5_500;

let lastFullSyncAt = 0;
let inFlightFullSync: Promise<void> | null = null;
let lastSettleSweepAt = 0;
let lastHousekeepingAt = 0;
let lastPruneAt = 0;

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
  opts?: { fromCron?: boolean }
): Promise<void> {
  const now = Date.now();
  if (!opts?.fromCron) {
    recordVisitorActivity(now);
  }
  if (!force && now - lastFullSyncAt < SYNC_THROTTLE_MS) {
    if (inFlightFullSync) await inFlightFullSync;
    return;
  }
  if (inFlightFullSync) {
    await inFlightFullSync;
    return;
  }

  inFlightFullSync = (async () => {
    try {
      const realFeedPromise = syncRealMatchesThrottled(force).catch((err) => {
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
      if (hasLiveActiveMatches()) {
        // Rafraîchit les snapshots JSON en RAM à chaque cycle live (minutes continues + cotes 30s/1m).
        invalidatePublicApiCaches(false);
      }
      const settleNow = Date.now();

      if (
        force ||
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

export async function syncLiveMatchesThrottled(force = false): Promise<void> {
  await syncPlatformStateThrottled(force);
}

export async function syncAllSettlementsThrottled(force = false): Promise<void> {
  await syncPlatformStateThrottled(force);
}

export function resetSyncThrottle(): void {
  lastFullSyncAt = 0;
  lastSettleSweepAt = 0;
  lastHousekeepingAt = 0;
  invalidateAllActiveCaches();
}
