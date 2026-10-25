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
 * - Déduplique les appels concurrents (< 1,5 s) pour ménager le pool PostgreSQL.
 */
const SYNC_THROTTLE_MS = 1_500;
const HOUSEKEEPING_THROTTLE_MS = 60_000;

let lastFullSyncAt = 0;
let inFlightFullSync: Promise<void> | null = null;
let lastHousekeepingAt = 0;

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
      await Promise.all([runLiveEngine(), syncRealMatchesThrottled(force)]);
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
