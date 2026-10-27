import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  ClientBet,
  ClientFinishedMatch,
  ClientMatch,
  ClientPredictionQuestion,
  ClientWalletResponse,
} from "./api";

/**
 * Cache mémoire 0 ms + persistance disque AsyncStorage (Stale-While-Revalidate).
 * Permet d'afficher instantanément :
 * - les listes (`/matchs`, `/predictions`, `/paris`, `/resultats`, `/parametres`) dès l'ouverture à froid
 * - les pages dédiées (`/matchs/[id]`, `/paris/simple/[id]`, `/paris/combine/[id]`, `/predictions/[id]`, `/resultats/[id]`)
 *   en 0 ms pendant que la revalidation silencieuse met à jour les données en tâche de fond.
 */
const matchCache = new Map<number, ClientMatch>();
const finishedCache = new Map<number, ClientFinishedMatch>();
const betCache = new Map<string, ClientBet>();
const predictionCache = new Map<number, ClientPredictionQuestion>();

let latestMatchesList: ClientMatch[] | null = null;
let latestPredictionsList: ClientPredictionQuestion[] | null = null;
let latestFinishedList: ClientFinishedMatch[] | null = null;
let latestBetsList: ClientBet[] | null = null;
let walletSnapshot: ClientWalletResponse | null = null;

const DISK_SNAPSHOT_KEY = "pulse_android_swr_snapshot_v1";
let persistTimer: ReturnType<typeof setTimeout> | null = null;

interface PersistedSnapshot {
  matches?: ClientMatch[];
  predictions?: ClientPredictionQuestion[];
  finished?: ClientFinishedMatch[];
}

function scheduleDiskSnapshotPersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const payload: PersistedSnapshot = {
      matches: latestMatchesList ? latestMatchesList.slice(0, 60) : undefined,
      predictions: latestPredictionsList ? latestPredictionsList.slice(0, 40) : undefined,
      finished: latestFinishedList ? latestFinishedList.slice(0, 40) : undefined,
    };
    void AsyncStorage.setItem(DISK_SNAPSHOT_KEY, JSON.stringify(payload)).catch(() => {
      // Silencieux si quota disque saturé
    });
  }, 1_200);
}

export async function hydrateEntityCacheFromDisk(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(DISK_SNAPSHOT_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as PersistedSnapshot;
    if (Array.isArray(parsed.matches) && !latestMatchesList) {
      seedMatchesSnapshot(parsed.matches, false);
    }
    if (Array.isArray(parsed.predictions) && !latestPredictionsList) {
      seedPredictionsSnapshot(parsed.predictions, false);
    }
    if (Array.isArray(parsed.finished) && !latestFinishedList) {
      seedFinishedMatchesSnapshot(parsed.finished, false);
    }
  } catch {
    // Ignore tout snapshot corrompu
  }
}

export function seedMatchSnapshot(m: ClientMatch | null | undefined) {
  if (!m || typeof m.id !== "number") return;
  const prev = matchCache.get(m.id);
  // Si le snapshot entrant est "slim" (1 seul groupe `result`) mais que le cache RAM possède déjà
  // les 18 groupes complets du match, on fusionne en préservant les marchés détaillés jusqu'au prochain refresh.
  if (
    prev &&
    prev.markets.length > 1 &&
    m.markets.length <= 1 &&
    m.status === prev.status
  ) {
    const updatedResGroup = m.markets.find((g) => g.key === "result");
    matchCache.set(m.id, {
      ...prev,
      ...m,
      realStats: m.realStats ?? prev.realStats ?? null,
      telemetry: m.telemetry ?? prev.telemetry,
      markets: updatedResGroup
        ? prev.markets.map((g) => (g.key === "result" ? updatedResGroup : g))
        : prev.markets,
    });
    return;
  }
  matchCache.set(m.id, m);
}

export function seedMatchesSnapshot(list: ClientMatch[], persist = true) {
  latestMatchesList = list;
  for (const m of list) seedMatchSnapshot(m);
  if (persist) scheduleDiskSnapshotPersist();
}

export function getCachedMatchSnapshot(id: number): ClientMatch | null {
  return matchCache.get(id) ?? null;
}

export function getCachedMatchesList(): ClientMatch[] | null {
  return latestMatchesList;
}

export function seedFinishedMatchesSnapshot(
  list: ClientFinishedMatch[],
  persist = true
) {
  latestFinishedList = list;
  for (const m of list) {
    if (m && typeof m.id === "number") finishedCache.set(m.id, m);
  }
  if (persist) scheduleDiskSnapshotPersist();
}

export function seedFinishedMatchSnapshot(m: ClientFinishedMatch | null | undefined) {
  if (!m || typeof m.id !== "number") return;
  finishedCache.set(m.id, m);
}

export function getCachedFinishedMatchSnapshot(id: number): ClientFinishedMatch | null {
  return finishedCache.get(id) ?? null;
}

export function getCachedFinishedMatchesList(): ClientFinishedMatch[] | null {
  return latestFinishedList;
}

export function seedBetsSnapshot(list: ClientBet[]) {
  latestBetsList = list;
  for (const b of list) {
    if (!b || typeof b.id !== "number") continue;
    betCache.set(`${b.kind}:${b.id}`, b);
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
  list: ClientPredictionQuestion[],
  persist = true
) {
  latestPredictionsList = list;
  for (const q of list) {
    if (q && typeof q.id === "number") predictionCache.set(q.id, q);
  }
  if (persist) scheduleDiskSnapshotPersist();
}

export function getCachedPredictionSnapshot(
  id: number
): ClientPredictionQuestion | null {
  return predictionCache.get(id) ?? null;
}

export function getCachedPredictionsList(): ClientPredictionQuestion[] | null {
  return latestPredictionsList;
}

export function setCachedWalletSnapshot(w: ClientWalletResponse | null) {
  walletSnapshot = w;
}

export function getCachedWalletSnapshot(): ClientWalletResponse | null {
  return walletSnapshot;
}

export function clearPrivateEntityCaches() {
  betCache.clear();
  latestBetsList = null;
  walletSnapshot = null;
}
