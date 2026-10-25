import { runLiveEngine } from "@/db/engine";
import { expireStaleAcceleratorRounds } from "@/lib/accelerator-engine";
import { settlePendingCombos } from "@/lib/combo";
import { expireStaleGatewayDeposits } from "@/lib/payments";
import { ensureOpenPredictions, settleResolvedQuestions } from "@/lib/predictions";
import { syncRealMatchesThrottled } from "@/lib/real-sports-feed";
import { settleFinishedBets } from "@/lib/settle";

/**
 * Orchestrateur unifié « Time-Continuum » :
 * - Garantit que n'importe quelle requête réveillant le serveur après une période
 *   avec 0 visiteur rattrape séquentiellement tous les matchs écoulés, résout les
 *   questions arrivées à terme, règle tous les paris simples / combinés aux dates
 *   réelles de fin d'événement et maintient les files actives.
 * - Borne l'attente réseau externe (ESPN) à 2,5 s sur les lectures utilisateurs pour
 *   qu'aucune lenteur d'API tierce ne bloque ni ne provoque de 504 sur Vercel Serverless.
 */
const SYNC_THROTTLE_MS = 1_500;
const HOUSEKEEPING_THROTTLE_MS = 60_000;
const USER_READ_FEED_BUDGET_MS = 2_500;

let lastFullSyncAt = 0;
let inFlightFullSync: Promise<void> | null = null;
let lastHousekeepingAt = 0;

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

export async function syncPlatformStateThrottled(force = false): Promise<void> {
  const now = Date.now();
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

      if (force) {
        await Promise.all([runLiveEngine(), realFeedPromise]);
      } else {
        const [, feedStatus] = await Promise.all([
          runLiveEngine(),
          withTimeoutBudget(realFeedPromise, USER_READ_FEED_BUDGET_MS),
        ]);
        // Si le flux externe dépasse 2,5 s, laisse-le finir en tâche de fond et déclenche
        // le règlement dès qu'il termine sans bloquer l'affichage utilisateur.
        if (feedStatus === "timed_out") {
          void realFeedPromise.then(async (res) => {
            if (res && res.settledCount > 0) {
              await settleFinishedBets().catch(() => undefined);
            }
          });
        }
      }

      await Promise.all([settleFinishedBets(), settleResolvedQuestions()]);
      await settlePendingCombos();

      const hkNow = Date.now();
      if (force || hkNow - lastHousekeepingAt >= HOUSEKEEPING_THROTTLE_MS) {
        await Promise.all([
          ensureOpenPredictions(hkNow),
          expireStaleAcceleratorRounds(hkNow),
          expireStaleGatewayDeposits(),
        ]);
        lastHousekeepingAt = Date.now();
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
  lastHousekeepingAt = 0;
}
