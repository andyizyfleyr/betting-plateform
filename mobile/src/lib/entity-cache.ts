import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  ClientBet,
  ClientMatch,
  ClientMatchHistoryItem,
  ClientPrediction,
  ClientWalletData,
} from "./api";

const matchCache = new Map<number, ClientMatch>();
const finishedCache = new Map<number, ClientMatchHistoryItem>();
const betCache = new Map<string, ClientBet>();
const predictionCache = new Map<number, ClientPrediction>();

let latestMatchesList: ClientMatch[] | null = null;
let latestPredictionsList: ClientPrediction[] | null = null;
let latestFinishedList: ClientMatchHistoryItem[] | null = null;
let latestBetsList: ClientBet[] | null = null;
let walletSnapshot: ClientWalletData | null = null;
let walletSnapshotAt = 0;

const LEGACY_DISK_SNAPSHOT_KEY = "pulse_android_swr_snapshot_v2";
const DISK_SNAPSHOT_KEY = "pulse_android_finished_snapshot_v3";
const FINISHED_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

interface PersistedSnapshot {
  savedAt: number;
  finished: ClientMatchHistoryItem[];
}

// Le disque ne doit jamais contenir de flux live, de cotes ou de paris en cours.
// Les résultats terminés restent un aperçu périssable, revalidé par le réseau.
function scheduleDiskSnapshotPersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const payload: PersistedSnapshot = {
      savedAt: Date.now(),
      finished: (latestFinishedList ?? []).filter((m) => m.status === "finished").slice(0, 40),
    };
    void AsyncStorage.setItem(DISK_SNAPSHOT_KEY, JSON.stringify(payload)).catch(() => {});
  }, 1_200);
}

export async function hydrateEntityCacheFromDisk(): Promise<void> {
  try {
    // Supprime les anciennes copies qui contenaient des cotes et prédictions live.
    await AsyncStorage.removeItem(LEGACY_DISK_SNAPSHOT_KEY);
    const raw = await AsyncStorage.getItem(DISK_SNAPSHOT_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as PersistedSnapshot;
    if (Number.isFinite(parsed.savedAt) && parsed.savedAt <= Date.now() &&
        Date.now() - parsed.savedAt < FINISHED_CACHE_TTL_MS &&
        Array.isArray(parsed.finished) && !latestFinishedList) {
      seedFinishedMatchesSnapshot(parsed.finished.filter((m) => m.status === "finished"), false);
    } else {
      await AsyncStorage.removeItem(DISK_SNAPSHOT_KEY);
    }
  } catch {
    /* stockage indisponible : le réseau reste la source de vérité */
  }
}

export function seedMatchSnapshot(m: ClientMatch | null | undefined) {
  if (!m || typeof m.id !== "number") return;
  const prev = matchCache.get(m.id);
  if (
    prev &&
    (prev.markets?.length ?? 0) > 1 &&
    (m.markets?.length ?? 0) <= 1
  ) {
    const updatedResGroup = m.markets?.find(
      (g) => g.key === "result" || g.key === "1x2"
    );
    matchCache.set(m.id, {
      ...prev,
      ...m,
      marketCount: m.marketCount ?? prev.marketCount ?? prev.markets.length,
      realStats: m.realStats ?? prev.realStats ?? null,
      telemetry: m.telemetry ?? prev.telemetry,
      markets: updatedResGroup
        ? prev.markets.map((g) =>
            g.key === "result" || g.key === "1x2"
              ? { ...g, outcomes: updatedResGroup.outcomes }
              : g
          )
        : prev.markets,
    });
    return;
  }
  matchCache.set(m.id, m);
}

export function seedMatchesSnapshot(list: ClientMatch[], persist = true) {
  for (const m of list) seedMatchSnapshot(m);
  latestMatchesList = list.map((m) => matchCache.get(m.id) ?? m);
  void persist; // Flux live uniquement en mémoire.
}

export function getCachedMatchSnapshot(id: number): ClientMatch | null {
  return matchCache.get(id) ?? null;
}

export function getCachedMatchesList(): ClientMatch[] | null {
  return latestMatchesList;
}

export function seedFinishedMatchesSnapshot(
  list: ClientMatchHistoryItem[],
  persist = true
) {
  latestFinishedList = list;
  for (const m of list) {
    if (m && typeof m.id === "number") finishedCache.set(m.id, m);
  }
  if (persist) scheduleDiskSnapshotPersist();
}

export function seedFinishedMatchSnapshot(m: ClientMatchHistoryItem | null | undefined) {
  if (!m || typeof m.id !== "number") return;
  finishedCache.set(m.id, m);
}

export function getCachedFinishedMatchSnapshot(id: number): ClientMatchHistoryItem | null {
  return finishedCache.get(id) ?? null;
}

export function getCachedFinishedMatchesList(): ClientMatchHistoryItem[] | null {
  return latestFinishedList;
}

export function seedBetsSnapshot(list: ClientBet[]) {
  latestBetsList = list;
  for (const b of list) {
    if (!b || typeof b.id !== "number") continue;
    betCache.set(`${b.kind}:${b.id}`, b);
  }
}

export function seedSingleBetSnapshot(b: ClientBet | null | undefined) {
  if (!b || typeof b.id !== "number") return;
  const k = `${b.kind ?? "sport"}:${b.id}`;
  betCache.set(k, b);
  if (latestBetsList) {
    const idx = latestBetsList.findIndex(
      (x) => (x.kind ?? "sport") === (b.kind ?? "sport") && x.id === b.id
    );
    if (idx >= 0) {
      const next = [...latestBetsList];
      next[idx] = b;
      latestBetsList = next;
    }
  }
}

export function getCachedBetSnapshot(
  kind: "sport" | "prediction" | "combo",
  id: number
): ClientBet | null {
  return betCache.get(`${kind}:${id}`) ?? null;
}

export function getCachedSingleOrPredictionBet(id: number): ClientBet | null {
  return betCache.get(`sport:${id}`) ?? betCache.get(`prediction:${id}`) ?? null;
}

export function getCachedBetsList(): ClientBet[] | null {
  return latestBetsList;
}

export function seedPredictionsSnapshot(
  list: ClientPrediction[],
  persist = true
) {
  latestPredictionsList = list;
  for (const q of list) {
    if (q && typeof q.id === "number") predictionCache.set(q.id, q);
  }
  void persist; // Les prédictions peuvent contenir des paris et cotes en cours.
}

export function getCachedPredictionSnapshot(id: number): ClientPrediction | null {
  return predictionCache.get(id) ?? null;
}

export function getCachedPredictionsList(): ClientPrediction[] | null {
  return latestPredictionsList;
}

export function setCachedWalletSnapshot(w: ClientWalletData | null) {
  walletSnapshot = w;
  walletSnapshotAt = w ? Date.now() : 0;
}

export function getCachedWalletSnapshot(): ClientWalletData | null {
  return walletSnapshot;
}

export function getCachedWalletUpdatedAt(): number {
  return walletSnapshotAt;
}

export const getCachedClientMatch = getCachedMatchSnapshot;
export const getCachedClientPrediction = getCachedPredictionSnapshot;
export const getCachedMatchHistoryItem = getCachedFinishedMatchSnapshot;
export const getCachedWallet = getCachedWalletSnapshot;

export function getCachedUnifiedBet(
  kindOrId: "sport" | "prediction" | "combo" | number | string,
  maybeId?: number
): ClientBet | null {
  if (typeof maybeId === "number") {
    return betCache.get(`${String(kindOrId)}:${maybeId}`) ?? null;
  }
  if (typeof kindOrId === "number") {
    return (
      betCache.get(`sport:${kindOrId}`) ??
      betCache.get(`prediction:${kindOrId}`) ??
      betCache.get(`combo:${kindOrId}`) ??
      null
    );
  }
  const s = String(kindOrId);
  if (s.startsWith("sport-")) {
    return betCache.get(`sport:${Number(s.slice(6))}`) ?? null;
  }
  if (s.startsWith("pred-")) {
    return betCache.get(`prediction:${Number(s.slice(5))}`) ?? null;
  }
  const n = Number(s);
  if (Number.isInteger(n) && n > 0) {
    return (
      betCache.get(`combo:${n}`) ??
      betCache.get(`sport:${n}`) ??
      betCache.get(`prediction:${n}`) ??
      null
    );
  }
  return null;
}

export function clearPrivateEntityCaches() {
  betCache.clear();
  latestBetsList = null;
  walletSnapshot = null;
  walletSnapshotAt = 0;
}
