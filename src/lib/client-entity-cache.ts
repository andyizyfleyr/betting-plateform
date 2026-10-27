import type {
  BetKind,
  ClientBet,
  ClientMatch,
  ClientMatchHistoryItem,
  ClientPrediction,
  ClientWalletData,
} from "./api";

/**
 * Cache mémoire client ultra-léger (0 dépendance, 0 stockage disque sensible) :
 * permet d'hydrater instantanément (0 ms, sans flash de squelette) toutes les pages dédiées
 * (`/matchs/[id]`, `/paris/simple/[id]`, `/paris/combine/[id]`, `/resultats/[id]`, `/predictions/[id]`,
 * `/parametres/depot`, `/parametres/retrait`, `/parametres/transactions`) dès le clic depuis une liste,
 * tout en revalidant silencieusement en arrière-plan.
 */

const matchMap = new Map<number, ClientMatch>();
const historyMap = new Map<number, ClientMatchHistoryItem>();
const betMap = new Map<string, ClientBet>();
const predictionMap = new Map<number, ClientPrediction>();
let cachedWallet: ClientWalletData | null = null;

function betCacheKey(kind: BetKind, id: number): string {
  return `${kind}:${id}`;
}

export function rememberSingleMatch(m: ClientMatch): void {
  const prev = matchMap.get(m.id);
  if (
    prev &&
    m.status !== "finished" &&
    Array.isArray(prev.markets) &&
    prev.markets.length > 1 &&
    (!Array.isArray(m.markets) || m.markets.length <= 1)
  ) {
    const slimResGroup = m.markets?.find(
      (g) => g.key === "result" || g.key === "1x2"
    );
    matchMap.set(m.id, {
      ...prev,
      ...m,
      markets: slimResGroup
        ? prev.markets.map((g) =>
            g.key === "result" || g.key === "1x2" ? slimResGroup : g
          )
        : prev.markets,
      marketCount: m.marketCount ?? prev.marketCount ?? prev.markets.length,
      realStats: m.realStats ?? prev.realStats ?? null,
      ...(m.telemetry
        ? { telemetry: m.telemetry }
        : prev.telemetry && m.status === "live"
          ? { telemetry: prev.telemetry }
          : {}),
    });
    return;
  }
  matchMap.set(m.id, m);
}

export function rememberMatches(list: readonly ClientMatch[]): void {
  for (const m of list) {
    rememberSingleMatch(m);
  }
}

export function getCachedClientMatch(id: number): ClientMatch | undefined {
  return matchMap.get(id);
}

export function rememberMatchHistory(
  list: readonly ClientMatchHistoryItem[],
  focused?: ClientMatchHistoryItem | null
): void {
  for (const item of list) {
    historyMap.set(item.id, item);
  }
  if (focused) {
    historyMap.set(focused.id, focused);
  }
}

export function getCachedMatchHistoryItem(
  id: number
): ClientMatchHistoryItem | undefined {
  return historyMap.get(id);
}

export function rememberBets(list: readonly ClientBet[]): void {
  for (const b of list) {
    betMap.set(betCacheKey(b.kind, b.id), b);
  }
}

export function rememberSingleBet(b: ClientBet): void {
  betMap.set(betCacheKey(b.kind, b.id), b);
}

export function getCachedBet(kind: BetKind, id: number): ClientBet | undefined {
  return betMap.get(betCacheKey(kind, id));
}

export function getAllCachedBets(): ClientBet[] {
  return [...betMap.values()];
}

export function rememberPredictions(list: readonly ClientPrediction[]): void {
  for (const q of list) {
    const prev = predictionMap.get(q.id);
    predictionMap.set(q.id, q.myBet === undefined && prev?.myBet ? { ...q, myBet: prev.myBet } : q);
  }
}

export function getCachedPrediction(id: number): ClientPrediction | undefined {
  return predictionMap.get(id);
}

export function rememberWallet(w: ClientWalletData): void {
  cachedWallet = w;
}

export function getCachedWallet(): ClientWalletData | null {
  return cachedWallet;
}
