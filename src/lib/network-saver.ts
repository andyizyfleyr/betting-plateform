"use client";

import { useSyncExternalStore } from "react";

const DATA_SAVER_STORAGE_KEY = "pulsebet_data_saver_v1";

interface NavigatorConnectionLike {
  saveData?: boolean;
  effectiveType?: string;
  rtt?: number;
  downlink?: number;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

function getConnection(): NavigatorConnectionLike | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & {
    connection?: NavigatorConnectionLike;
    mozConnection?: NavigatorConnectionLike;
    webkitConnection?: NavigatorConnectionLike;
  };
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null;
}

const listeners = new Set<() => void>();

function emitChange() {
  for (const l of listeners) l();
}

export function setManualDataSaverPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) {
      localStorage.setItem(DATA_SAVER_STORAGE_KEY, "1");
    } else {
      localStorage.removeItem(DATA_SAVER_STORAGE_KEY);
    }
  } catch {
    /* silencieux */
  }
  emitChange();
}

export function readNetworkSnapshotString(): string {
  if (typeof window === "undefined") {
    return "0|0|0|4g";
  }
  let manual = false;
  try {
    manual = localStorage.getItem(DATA_SAVER_STORAGE_KEY) === "1";
  } catch {
    manual = false;
  }
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const conn = getConnection();
  const eff = conn?.effectiveType ?? "4g";
  const autoSlow =
    Boolean(conn?.saveData) ||
    eff === "slow-2g" ||
    eff === "2g" ||
    eff === "3g" ||
    (typeof conn?.rtt === "number" && conn.rtt >= 420);

  return `${offline ? 1 : 0}|${manual ? 1 : 0}|${autoSlow ? 1 : 0}|${eff}`;
}

function getServerNetworkSnapshot(): string {
  return "0|0|0|4g";
}

function subscribeNetwork(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.add(cb);

  const onChange = () => cb();
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  window.addEventListener("storage", onChange);
  const conn = getConnection();
  conn?.addEventListener?.("change", onChange);

  return () => {
    listeners.delete(cb);
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
    window.removeEventListener("storage", onChange);
    conn?.removeEventListener?.("change", onChange);
  };
}

/**
 * Calcule l'intervalle de rafraîchissement optimal en fonction de l'état 3G / Économie de données.
 */
export function getAdaptiveIntervalMs(baseMs: number, constrained: boolean): number {
  return constrained ? Math.round(baseMs * 2.8) : baseMs;
}

export function useNetworkQuality() {
  const raw = useSyncExternalStore(
    subscribeNetwork,
    readNetworkSnapshotString,
    getServerNetworkSnapshot
  );
  const [offBit, manBit, slowBit, effectiveType] = raw.split("|");
  const isOffline = offBit === "1";
  const manualDataSaver = manBit === "1";
  const autoConstrained = slowBit === "1";
  const isConstrained = manualDataSaver || autoConstrained;

  return {
    isOffline,
    manualDataSaver,
    autoConstrained,
    isConstrained,
    effectiveType: effectiveType || "4g",
    setManualDataSaver: setManualDataSaverPreference,
    effectiveInterval: (baseMs: number) => getAdaptiveIntervalMs(baseMs, isConstrained),
  };
}
