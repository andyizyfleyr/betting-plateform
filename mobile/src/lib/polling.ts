import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

/**
 * Planificateur de polling intelligent compatible React Native 0.64 (Expo Go SDK 42) :
 * - Met automatiquement en pause 100 % des requêtes réseau dès que l'application passe en
 *   arrière-plan ou que l'écran est verrouillé (`AppState !== "active"`).
 * - Déclenche une synchronisation immédiate au retour au premier plan.
 * - Multiplie la cadence par ×2.4 lorsque le « Mode économie 3G » (`dataSaver`) est activé.
 */
export function useSmartPolling(
  callback: () => Promise<void> | void,
  baseIntervalMs: number | null,
  options: {
    enabled?: boolean;
    dataSaver?: boolean;
    runImmediately?: boolean;
  } = {}
) {
  const { enabled = true, dataSaver = false, runImmediately = true } = options;
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (!enabled || baseIntervalMs === null || baseIntervalMs <= 0) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveErrors = 0;
    let appState: AppStateStatus = AppState.currentState;

    const effectiveInterval = () => {
      const saverMultiplier = dataSaver ? 2.4 : 1;
      const errorMultiplier = Math.min(4, Math.pow(1.6, consecutiveErrors));
      return Math.round(baseIntervalMs * saverMultiplier * errorMultiplier);
    };

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const scheduleNext = () => {
      clearTimer();
      if (cancelled || appState !== "active") return;
      timer = setTimeout(() => {
        void tick();
      }, effectiveInterval());
    };

    const tick = async () => {
      if (cancelled || appState !== "active") return;
      try {
        await savedCallback.current();
        consecutiveErrors = 0;
      } catch {
        consecutiveErrors = Math.min(5, consecutiveErrors + 1);
      } finally {
        scheduleNext();
      }
    };

    const handleAppStateChange = (nextState: AppStateStatus) => {
      const wasBackground = appState !== "active";
      appState = nextState;
      if (nextState !== "active") {
        clearTimer();
      } else if (wasBackground && !cancelled) {
        consecutiveErrors = 0;
        void tick();
      }
    };

    AppState.addEventListener("change", handleAppStateChange);

    if (runImmediately && appState === "active") {
      void tick();
    } else {
      scheduleNext();
    }

    return () => {
      cancelled = true;
      clearTimer();
      AppState.removeEventListener("change", handleAppStateChange);
    };
  }, [baseIntervalMs, dataSaver, enabled, runImmediately]);
}
