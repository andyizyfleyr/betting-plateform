import { runLiveEngine } from "@/db/engine";
import { settlePendingCombos } from "@/lib/combo";
import { settleResolvedQuestions } from "@/lib/predictions";
import { settleFinishedBets } from "@/lib/settle";

const ENGINE_THROTTLE_MS = 1_500;
const SETTLE_THROTTLE_MS = 1_500;

let lastEngineAt = 0;
let inFlightEngine: Promise<void> | null = null;

let lastSettleAt = 0;
let inFlightSettle: Promise<void> | null = null;

/**
 * Exécute le moteur live et le règlement des paris sportifs avec déduplication
 * des requêtes concurrentes et cadence max d'une fois toutes les 1,5 s.
 */
export async function syncLiveMatchesThrottled(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastEngineAt < ENGINE_THROTTLE_MS) {
    if (inFlightEngine) await inFlightEngine;
    return;
  }
  if (inFlightEngine) {
    await inFlightEngine;
    return;
  }
  inFlightEngine = (async () => {
    try {
      await runLiveEngine();
      await settleFinishedBets();
      await settlePendingCombos();
      lastEngineAt = Date.now();
    } finally {
      inFlightEngine = null;
    }
  })();
  await inFlightEngine;
}

/**
 * Règle les matchs terminés, les prédictions échues et les combinés avec cadence 1,5 s.
 */
export async function syncAllSettlementsThrottled(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastSettleAt < SETTLE_THROTTLE_MS) {
    if (inFlightSettle) await inFlightSettle;
    return;
  }
  if (inFlightSettle) {
    await inFlightSettle;
    return;
  }
  inFlightSettle = (async () => {
    try {
      await Promise.all([settleFinishedBets(), settleResolvedQuestions()]);
      await settlePendingCombos();
      lastSettleAt = Date.now();
    } finally {
      inFlightSettle = null;
    }
  })();
  await inFlightSettle;
}

export function resetSyncThrottle(): void {
  lastEngineAt = 0;
  lastSettleAt = 0;
}
