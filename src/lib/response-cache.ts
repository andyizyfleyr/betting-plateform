import { NextResponse } from "next/server";

/**
 * Empreinte ETag ultra-légère (double FNV-1a 32 bits + taille) et caches mémoire + Edge CDN :
 *  1) Singleflight (`runSingleflight`) : fusionne les requêtes concurrentes sur une même promesse ;
 *  2) `publicJsonWithEdgeCache` : partage la réponse d'1 visiteur avec des milliers d'autres
 *     via le CDN Edge Vercel (`s-maxage` + `stale-while-revalidate`) sans exposer aucune donnée privée ;
 *  3) `jsonWithEtag` (privé) : interdit strictement tout stockage CDN/proxy opérateur (`no-store` côté CDN,
 *     `Vary: Cookie`) tout en conservant la validation `304 Not Modified` locale du navigateur.
 */
export function computeWeakEtag(json: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const len = json.length;
  for (let i = 0; i < len; i++) {
    const c = json.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `W/"${len.toString(36)}-${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}"`;
}

export interface CachedJsonPayload {
  json: string;
  etag: string;
  at: number;
}

export interface EdgeCachePolicy {
  /** Durée navigateur locale très courte (par défaut 1 s). */
  maxAge?: number;
  /** Durée de fraîcheur partagée dans le CDN Edge Vercel (en secondes). */
  sMaxAge: number;
  /** Fenêtre pendant laquelle l'Edge sert instantanément le cache tout en revalidant 1 seule fois en tâche de fond. */
  staleWhileRevalidate: number;
}

const MATCHES_CACHE_TTL_MS = 3_500;
const HISTORY_CACHE_TTL_MS = 12_000;
const PREDICTIONS_CATALOG_TTL_MS = 15_000;

interface GlobalResponseCacheStore {
  matchesPayload: CachedJsonPayload | null;
  historyBasePayload: CachedJsonPayload | null;
  historyParsedItems: unknown[] | null;
  predictionsCatalogPayload: CachedJsonPayload | null;
  singleflight: Map<string, Promise<unknown>>;
}

const globalCache = globalThis as typeof globalThis & {
  __pulseResponseCacheStoreV2?: GlobalResponseCacheStore;
};

function store(): GlobalResponseCacheStore {
  if (!globalCache.__pulseResponseCacheStoreV2) {
    globalCache.__pulseResponseCacheStoreV2 = {
      matchesPayload: null,
      historyBasePayload: null,
      historyParsedItems: null,
      predictionsCatalogPayload: null,
      singleflight: new Map(),
    };
  }
  return globalCache.__pulseResponseCacheStoreV2;
}

/**
 * Exécute `factory` une seule fois même si 200 requêtes arrivent à la même milliseconde
 * (*Request Coalescing / Singleflight*).
 */
export async function runSingleflight<T>(
  key: string,
  factory: () => Promise<T>
): Promise<T> {
  const inflight = store().singleflight;
  const existing = inflight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  const p = factory().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

export function getMatchesPayloadCache(allowStaleFallback = false): CachedJsonPayload | null {
  const entry = store().matchesPayload;
  if (!entry) return null;
  if (allowStaleFallback || Date.now() - entry.at < MATCHES_CACHE_TTL_MS) {
    return entry;
  }
  return null;
}

export function setMatchesPayloadCache(data: unknown): CachedJsonPayload {
  const json = JSON.stringify(data);
  const entry: CachedJsonPayload = {
    json,
    etag: computeWeakEtag(json),
    at: Date.now(),
  };
  store().matchesPayload = entry;
  return entry;
}

export function getHistoryBaseCache<T>(): {
  payload: CachedJsonPayload;
  items: T[];
} | null {
  const s = store();
  if (
    s.historyBasePayload &&
    s.historyParsedItems &&
    Date.now() - s.historyBasePayload.at < HISTORY_CACHE_TTL_MS
  ) {
    return {
      payload: s.historyBasePayload,
      items: s.historyParsedItems as T[],
    };
  }
  return null;
}

export function setHistoryBaseCache<T>(items: T[]): CachedJsonPayload {
  const data = { matches: items, focusedMatch: null };
  const json = JSON.stringify(data);
  const entry: CachedJsonPayload = {
    json,
    etag: computeWeakEtag(json),
    at: Date.now(),
  };
  const s = store();
  s.historyBasePayload = entry;
  s.historyParsedItems = items as unknown[];
  return entry;
}

export function getPredictionsCatalogCache(
  allowStaleFallback = false
): CachedJsonPayload | null {
  const entry = store().predictionsCatalogPayload;
  if (!entry) return null;
  if (allowStaleFallback || Date.now() - entry.at < PREDICTIONS_CATALOG_TTL_MS) {
    return entry;
  }
  return null;
}

export function setPredictionsCatalogCache(data: unknown): CachedJsonPayload {
  const json = JSON.stringify(data);
  const entry: CachedJsonPayload = {
    json,
    etag: computeWeakEtag(json),
    at: Date.now(),
  };
  store().predictionsCatalogPayload = entry;
  return entry;
}

export function invalidatePredictionsCatalogCache(): void {
  store().predictionsCatalogPayload = null;
}

export function invalidatePublicApiCaches(): void {
  const s = store();
  s.matchesPayload = null;
  s.historyBasePayload = null;
  s.historyParsedItems = null;
  s.predictionsCatalogPayload = null;
}

/**
 * Réponse JSON strictement PRIVÉE (authentifiée par joueur) :
 * - Jamais stockée dans un CDN ou proxy partagé (`CDN-Cache-Control: private, no-store`, `Vary: Cookie`)
 * - Autorise la validation `ETag` / `304 Not Modified` uniquement dans le navigateur privé du joueur.
 */
export function jsonWithEtag(
  req: Request,
  data: unknown,
  precomputed?: CachedJsonPayload
): NextResponse {
  const json = precomputed ? precomputed.json : JSON.stringify(data);
  const etag = precomputed ? precomputed.etag : computeWeakEtag(json);
  const ifNoneMatch = req.headers.get("if-none-match");

  const privateHeaders: Record<string, string> = {
    ETag: etag,
    "Cache-Control": "private, max-age=0, must-revalidate",
    "CDN-Cache-Control": "private, no-store",
    "Vercel-CDN-Cache-Control": "private, no-store",
    Vary: "Cookie, Accept-Encoding",
    "X-Content-Type-Options": "nosniff",
  };

  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: privateHeaders,
    });
  }

  return new NextResponse(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...privateHeaders,
    },
  });
}

/**
 * Réponse JSON PUBLIQUE mutualisée sur le CDN Edge Vercel :
 * - 100 % exempte de données personnelles ou de cookies (`Vary: Accept-Encoding` uniquement)
 * - Partagée entre tous les visiteurs du monde pendant `sMaxAge` secondes, puis servie
 *   instantanément pendant `staleWhileRevalidate` secondes pendant qu'1 seule requête rafraîchit le cache.
 */
export function publicJsonWithEdgeCache(
  req: Request,
  data: unknown,
  precomputed: CachedJsonPayload | undefined,
  policy: EdgeCachePolicy
): NextResponse {
  const json = precomputed ? precomputed.json : JSON.stringify(data);
  const etag = precomputed ? precomputed.etag : computeWeakEtag(json);
  const ifNoneMatch = req.headers.get("if-none-match");

  const maxAge = Math.max(0, Math.floor(policy.maxAge ?? 1));
  const sMaxAge = Math.max(1, Math.floor(policy.sMaxAge));
  const swr = Math.max(1, Math.floor(policy.staleWhileRevalidate));

  const cdnDirective = `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`;
  const browserDirective = `public, max-age=${maxAge}, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`;

  const edgeHeaders: Record<string, string> = {
    ETag: etag,
    "Cache-Control": browserDirective,
    "CDN-Cache-Control": cdnDirective,
    "Vercel-CDN-Cache-Control": cdnDirective,
    Vary: "Accept-Encoding",
    "X-Content-Type-Options": "nosniff",
  };

  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: edgeHeaders,
    });
  }

  return new NextResponse(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...edgeHeaders,
    },
  });
}
