import { invalidateByTag, waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { PARTY_LIVE_MATCHES_ROOM, publishPartyRoomEvent } from "@/lib/partykit";

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

const MATCHES_CACHE_TTL_MS = 1_000;
const HISTORY_CACHE_TTL_MS = 2_000;
const PREDICTIONS_CATALOG_TTL_MS = 2_500;
const TAG_PURGE_COOLDOWN_MS = 1_500;

interface GlobalResponseCacheStore {
  matchesPayload: CachedJsonPayload | null;
  matchesSlimPayload: CachedJsonPayload | null;
  lastPublishedSlimEtag: string | null;
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
      matchesSlimPayload: null,
      lastPublishedSlimEtag: null,
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

export function getMatchesSlimPayloadCache(allowStaleFallback = false): CachedJsonPayload | null {
  const entry = store().matchesSlimPayload;
  if (!entry) return null;
  if (allowStaleFallback || Date.now() - entry.at < MATCHES_CACHE_TTL_MS) {
    return entry;
  }
  return null;
}

export function setMatchesSlimPayloadCache(data: unknown): CachedJsonPayload {
  const json = JSON.stringify(data);
  const entry: CachedJsonPayload = {
    json,
    etag: computeWeakEtag(json),
    at: Date.now(),
  };
  const s = store();
  s.matchesSlimPayload = entry;
  if (s.lastPublishedSlimEtag !== entry.etag && data && typeof data === "object") {
    s.lastPublishedSlimEtag = entry.etag;
    const candidate = data as { matches?: unknown[]; serverTime?: string };
    if (Array.isArray(candidate.matches)) {
      publishPartyRoomEvent(PARTY_LIVE_MATCHES_ROOM, {
        type: "MATCHES_SNAPSHOT",
        matches: candidate.matches,
        serverTime: candidate.serverTime ?? new Date(entry.at).toISOString(),
        ts: entry.at,
      });
    }
  }
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
 * Note d'architecture : `@vercel/functions` `invalidateByTag` renvoie `Promise<void>` sans exposer
 * d'acquittement synchrone de propagation PoP (et résout silencieusement si `getContext().purge`
 * n'est pas injecté par le plan/runtime actif). Aucun en-tête trompeur n'est donc émis côté HTTP ;
 * en cas d'absence de purge par tag, le TTL court (`s-maxage=5`) borne la fraîcheur maximale.
 */
export function purgeEdgeCacheTags(
  tags: readonly string[],
  force = false
): void {
  if (process.env.VERCEL !== "1" || tags.length === 0) return;
  const now = Date.now();
  const s = store();
  const dueTags: string[] = [];
  for (const t of tags) {
    const prev = s.lastTagPurgeAt.get(t) ?? 0;
    if (force || now - prev >= TAG_PURGE_COOLDOWN_MS) {
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

export function invalidatePredictionsCatalogCache(
  purgeEdge = false,
  forceEdgePurge = false
): void {
  store().predictionsCatalogPayload = null;
  if (purgeEdge) {
    purgeEdgeCacheTags([EDGE_CACHE_TAGS.predictionsCatalog], forceEdgePurge);
  }
}

export function invalidatePublicApiCaches(
  purgeEdge = false,
  forceEdgePurge = false
): void {
  const s = store();
  s.matchesPayload = null;
  s.matchesSlimPayload = null;
  s.historyBasePayload = null;
  s.historyParsedItems = null;
  s.historyServerTime = null;
  s.predictionsCatalogPayload = null;
  if (purgeEdge) {
    purgeEdgeCacheTags(
      [
        EDGE_CACHE_TAGS.matches,
        EDGE_CACHE_TAGS.history,
        EDGE_CACHE_TAGS.predictionsCatalog,
      ],
      forceEdgePurge
    );
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
 * Détecte un rafraîchissement manuel explicite du joueur (`?refresh=1` ou `x-pulse-refresh: 1`).
 */
export function isManualRefreshRequest(req: Request): boolean {
  if (req.headers.get("x-pulse-refresh") === "1") return true;
  try {
    const url = new URL(req.url);
    return url.searchParams.get("refresh") === "1";
  } catch {
    return false;
  }
}

/**
 * Vérifie que seuls les paramètres d'URL explicitement autorisés (plus `refresh=1`) sont présents.
 */
export function hasUnexpectedSearchParams(
  searchParams: URLSearchParams,
  allowedKeys: readonly string[] = []
): boolean {
  const allowed = new Set<string>(allowedKeys);
  for (const [key, value] of searchParams.entries()) {
    if (key === "refresh" && value === "1") continue;
    if (!allowed.has(key)) return true;
  }
  return false;
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
  const manualRefresh = isManualRefreshRequest(req);
  const ifNoneMatch = manualRefresh ? null : req.headers.get("if-none-match");

  const privateHeaders: Record<string, string> = {
    ETag: etag,
    "Cache-Control": manualRefresh
      ? "private, no-store, max-age=0"
      : "private, max-age=0, must-revalidate",
    "CDN-Cache-Control": "private, no-store",
    "Vercel-CDN-Cache-Control": "private, no-store",
    Vary: "Cookie, Authorization, Accept-Encoding",
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
 * Réponse JSON PUBLIQUE mutualisée par région sur le CDN Edge Vercel
 * (ou strictement `no-store` lors d'un rafraîchissement manuel `?refresh=1`).
 */
export function publicJsonWithEdgeCache(
  req: Request,
  data: unknown,
  precomputed: CachedJsonPayload | undefined,
  policy: EdgeCachePolicy
): NextResponse {
  const json = precomputed ? precomputed.json : JSON.stringify(data);
  const etag = precomputed ? precomputed.etag : computeWeakEtag(json);
  const manualRefresh = isManualRefreshRequest(req);
  const ifNoneMatch = manualRefresh ? null : req.headers.get("if-none-match");

  if (manualRefresh) {
    return new NextResponse(json, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ETag: etag,
        "Cache-Control": "private, no-store, max-age=0",
        "CDN-Cache-Control": "private, no-store",
        "Vercel-CDN-Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const maxAge = Math.max(0, Math.floor(policy.maxAge ?? 0));
  const sMaxAge = Math.max(1, Math.floor(policy.sMaxAge));
  const swr = Math.max(1, Math.floor(policy.staleWhileRevalidate));

  const cdnDirective = `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`;
  const browserDirective =
    maxAge > 0
      ? `public, max-age=${maxAge}, stale-while-revalidate=${Math.min(2, swr)}`
      : "public, max-age=0, must-revalidate";

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
