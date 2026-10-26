import { invalidateByTag, waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";

/**
 * Empreinte ETag ultra-légère (double FNV-1a 32 bits + taille), caches mémoire, Singleflight
 * et diffusion CDN Edge Vercel avec purge par tags (`Vercel-Cache-Tag`).
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

export const EDGE_CACHE_TAGS = {
  matches: "api-matches",
  history: "api-matches-history",
  predictionsCatalog: "api-predictions-catalog",
} as const;

export interface CachedJsonPayload {
  json: string;
  etag: string;
  at: number;
}

export interface EdgeCachePolicy {
  /** Durée navigateur locale très courte (par défaut 1 s). */
  maxAge?: number;
  /** Durée de fraîcheur partagée dans chaque PoP régional du CDN Edge Vercel (en secondes). */
  sMaxAge: number;
  /** Fenêtre pendant laquelle l'Edge sert le cache tout en revalidant en tâche de fond. */
  staleWhileRevalidate: number;
  /** Tags `Vercel-Cache-Tag` permettant une purge ciblée lors d'actions Admin ou règlements. */
  tags?: readonly string[];
}

const MATCHES_CACHE_TTL_MS = 4_500;
const HISTORY_CACHE_TTL_MS = 12_000;
const PREDICTIONS_CATALOG_TTL_MS = 15_000;
const TAG_PURGE_COOLDOWN_MS = 2_500;

interface GlobalResponseCacheStore {
  matchesPayload: CachedJsonPayload | null;
  historyBasePayload: CachedJsonPayload | null;
  historyParsedItems: unknown[] | null;
  historyServerTime: string | null;
  predictionsCatalogPayload: CachedJsonPayload | null;
  singleflight: Map<string, Promise<unknown>>;
  lastTagPurgeAt: Map<string, number>;
}

const globalCache = globalThis as typeof globalThis & {
  __pulseResponseCacheStoreV3?: GlobalResponseCacheStore;
};

function store(): GlobalResponseCacheStore {
  if (!globalCache.__pulseResponseCacheStoreV3) {
    globalCache.__pulseResponseCacheStoreV3 = {
      matchesPayload: null,
      historyBasePayload: null,
      historyParsedItems: null,
      historyServerTime: null,
      predictionsCatalogPayload: null,
      singleflight: new Map(),
      lastTagPurgeAt: new Map(),
    };
  }
  return globalCache.__pulseResponseCacheStoreV3;
}

/**
 * Exécute `factory` une seule fois par instance Serverless même si des requêtes concurrentes
 * arrivent à la même milliseconde (*Request Coalescing / Singleflight*).
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
  serverTime: string;
} | null {
  const s = store();
  if (
    s.historyBasePayload &&
    s.historyParsedItems &&
    s.historyServerTime &&
    Date.now() - s.historyBasePayload.at < HISTORY_CACHE_TTL_MS
  ) {
    return {
      payload: s.historyBasePayload,
      items: s.historyParsedItems as T[],
      serverTime: s.historyServerTime,
    };
  }
  return null;
}

export function setHistoryBaseCache<T>(items: T[], serverTime: string): CachedJsonPayload {
  const data = { matches: items, focusedMatch: null, serverTime };
  const json = JSON.stringify(data);
  const entry: CachedJsonPayload = {
    json,
    etag: computeWeakEtag(json),
    at: Date.now(),
  };
  const s = store();
  s.historyBasePayload = entry;
  s.historyParsedItems = items as unknown[];
  s.historyServerTime = serverTime;
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

/**
 * Purge asynchrone non bloquante des tags CDN Edge Vercel (`invalidateByTag`).
 * Protégée par un anti-rebond de 2,5 s et un `try/catch` afin d'être 100 % tolérante
 * quel que soit le plan Vercel actif (Hobby / Pro) ou l'environnement local.
 */
export function purgeEdgeCacheTags(tags: readonly string[]): void {
  if (process.env.VERCEL !== "1" || tags.length === 0) return;
  const now = Date.now();
  const s = store();
  const dueTags: string[] = [];
  for (const t of tags) {
    const prev = s.lastTagPurgeAt.get(t) ?? 0;
    if (now - prev >= TAG_PURGE_COOLDOWN_MS) {
      s.lastTagPurgeAt.set(t, now);
      dueTags.push(t);
    }
  }
  if (dueTags.length === 0) return;

  try {
    waitUntil(
      invalidateByTag(dueTags).catch(() => {
        /* silencieux si le plan Vercel courant limite ou désactive la purge par tag */
      })
    );
  } catch {
    /* hors contexte de requête Vercel : aucun impact */
  }
}

/**
 * Purge synchrone avec rapport de statut (`"purged" | "cooldown" | "unsupported" | "local"`),
 * utilisée par `POST /api/admin` pour exposer l'en-tête de diagnostic `X-Edge-Tag-Purge`.
 */
export async function purgeEdgeCacheTagsWithReport(
  tags: readonly string[]
): Promise<"purged" | "cooldown" | "unsupported" | "local"> {
  if (process.env.VERCEL !== "1" || tags.length === 0) return "local";
  const now = Date.now();
  const s = store();
  const dueTags: string[] = [];
  for (const t of tags) {
    const prev = s.lastTagPurgeAt.get(t) ?? 0;
    if (now - prev >= TAG_PURGE_COOLDOWN_MS) {
      s.lastTagPurgeAt.set(t, now);
      dueTags.push(t);
    }
  }
  if (dueTags.length === 0) return "cooldown";

  try {
    await invalidateByTag([...dueTags]);
    return "purged";
  } catch {
    return "unsupported";
  }
}

export function invalidatePredictionsCatalogCache(purgeEdge = false): void {
  store().predictionsCatalogPayload = null;
  if (purgeEdge) {
    purgeEdgeCacheTags([EDGE_CACHE_TAGS.predictionsCatalog]);
  }
}

export function invalidatePublicApiCaches(purgeEdge = false): void {
  const s = store();
  s.matchesPayload = null;
  s.historyBasePayload = null;
  s.historyParsedItems = null;
  s.historyServerTime = null;
  s.predictionsCatalogPayload = null;
  if (purgeEdge) {
    purgeEdgeCacheTags([
      EDGE_CACHE_TAGS.matches,
      EDGE_CACHE_TAGS.history,
      EDGE_CACHE_TAGS.predictionsCatalog,
    ]);
  }
}

/**
 * Rejette immédiatement (`400 Bad Request`) tout paramètre d'URL non autorisé sur une route
 * publique canonique avant toute allocation mémoire ou appel base de données (défense en profondeur
 * derrière la règle Vercel Firewall).
 */
export function rejectUnexpectedQueryParams(message = "Paramètres d'URL non autorisés sur cette route publique"): NextResponse {
  return NextResponse.json(
    { error: message },
    {
      status: 400,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "CDN-Cache-Control": "private, no-store",
        "Vercel-CDN-Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}

/**
 * Réponse JSON strictement PRIVÉE (authentifiée par joueur).
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
 * Réponse JSON PUBLIQUE mutualisée par région sur le CDN Edge Vercel.
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

  if (policy.tags && policy.tags.length > 0) {
    edgeHeaders["Vercel-Cache-Tag"] = policy.tags.join(",");
  }

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
