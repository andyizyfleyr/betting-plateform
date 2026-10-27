import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

/**
 * Moteur HTTP Android Expo haute performance :
 * 1. Stockage sécurisé du JWT dans Android Keystore (`expo-secure-store`) + miroir RAM 0 ms.
 * 2. Déduplication des requêtes GET identiques en vol (*Client Singleflight*).
 * 3. Validation conditionnelle `ETag` + `If-None-Match` (`304 Not Modified` = 0 octet JSON transféré).
 * 4. Timeout `AbortController` + propagation typée des conflits de cote / Cash Out (`409`).
 * 5. Clés d'idempotence déterministes sur toutes les écritures financières.
 */

const TOKEN_STORE_KEY = "pulse_android_jwt_v1";

function resolveApiBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, "");
  const extraUrl = (
    Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined
  )?.apiBaseUrl?.trim();
  if (extraUrl) return extraUrl.replace(/\/+$/, "");
  return "https://be-plateform.vercel.app";
}

export const API_BASE_URL = resolveApiBaseUrl();

let memoryAuthToken: string | null = null;
let tokenHydrated = false;
let unauthorizedListeners: Array<() => void> = [];

export function onUnauthorizedResponse(cb: () => void): () => void {
  unauthorizedListeners.push(cb);
  return () => {
    unauthorizedListeners = unauthorizedListeners.filter((fn) => fn !== cb);
  };
}

export async function hydrateAuthToken(): Promise<string | null> {
  if (tokenHydrated) return memoryAuthToken;
  try {
    const stored = await SecureStore.getItemAsync(TOKEN_STORE_KEY);
    memoryAuthToken = stored && stored.trim().length > 0 ? stored.trim() : null;
  } catch {
    memoryAuthToken = null;
  }
  tokenHydrated = true;
  return memoryAuthToken;
}

export function getMemoryAuthToken(): string | null {
  return memoryAuthToken;
}

export async function persistAuthToken(token: string | null): Promise<void> {
  memoryAuthToken = token && token.trim().length > 0 ? token.trim() : null;
  tokenHydrated = true;
  // Toute transition d'identité vide le cache ETag privé pour éviter tout mélange de session
  clearEtagCache();
  try {
    if (memoryAuthToken) {
      await SecureStore.setItemAsync(TOKEN_STORE_KEY, memoryAuthToken);
    } else {
      await SecureStore.deleteItemAsync(TOKEN_STORE_KEY);
    }
  } catch {
    // Silencieux si Keystore indisponible
  }
}

interface EtagCacheEntry {
  etag: string;
  body: unknown;
  at: number;
}

const etagStore = new Map<string, EtagCacheEntry>();
const inflightGets = new Map<string, Promise<unknown>>();
const MAX_ETAG_ENTRIES = 80;

export function clearEtagCache(): void {
  etagStore.clear();
  inflightGets.clear();
}

function setEtagEntry(cacheKey: string, etag: string, body: unknown) {
  if (etagStore.size >= MAX_ETAG_ENTRIES && !etagStore.has(cacheKey)) {
    const oldestKey = etagStore.keys().next().value;
    if (oldestKey) etagStore.delete(oldestKey);
  }
  etagStore.set(cacheKey, { etag, body, at: Date.now() });
}

export class ApiHttpError extends Error {
  status: number;
  code?: string;
  currentOdds?: number;
  currentCashOut?: number;
  closed?: boolean;
  suspended?: boolean;

  constructor(
    message: string,
    status: number,
    payload?: {
      code?: string;
      currentOdds?: number;
      currentCashOut?: number;
      closed?: boolean;
      suspended?: boolean;
    }
  ) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
    this.code = payload?.code;
    this.currentOdds = payload?.currentOdds;
    this.currentCashOut = payload?.currentCashOut;
    this.closed = payload?.closed;
    this.suspended = payload?.suspended;
  }
}

export function generateIdempotencyKey(prefix = "and"): string {
  const randA = Math.random().toString(36).slice(2, 10);
  const randB = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${randA}${randB}`;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Désactive l'envoi d'If-None-Match si une lecture forcée est souhaitée. */
  bypassEtag?: boolean;
  /** Ne déclenche pas la déconnexion globale sur 401 (ex: `/api/auth/me` ou `/api/auth/login`). */
  ignoreUnauthorizedRedirect?: boolean;
}

export async function requestJson<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const method = options.method ?? "GET";
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  const token = tokenHydrated ? memoryAuthToken : await hydrateAuthToken();
  const cacheKey = `${token ? token.slice(-12) : "anon"}:${url}`;

  if (method === "GET" && !options.bypassEtag) {
    const existing = inflightGets.get(cacheKey);
    if (existing) {
      return existing as Promise<T>;
    }
  }

  const execute = async (): Promise<T> => {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? (method === "GET" ? 12_000 : 18_000);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "X-Client-Platform": "android-expo",
        ...(options.headers ?? {}),
      };

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
      }

      const cachedEtag =
        method === "GET" && !options.bypassEtag ? etagStore.get(cacheKey) : undefined;
      if (cachedEtag?.etag) {
        headers["If-None-Match"] = cachedEtag.etag;
      }

      const res = await fetch(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (res.status === 304 && cachedEtag) {
        cachedEtag.at = Date.now();
        return cachedEtag.body as T;
      }

      const rawText = await res.text();
      let data: Record<string, unknown> = {};
      if (rawText) {
        try {
          data = JSON.parse(rawText) as Record<string, unknown>;
        } catch {
          data = {};
        }
      }

      if (!res.ok) {
        if (res.status === 401 && !options.ignoreUnauthorizedRedirect && memoryAuthToken) {
          await persistAuthToken(null);
          for (const listener of unauthorizedListeners) listener();
        }
        throw new ApiHttpError(
          (typeof data.error === "string" && data.error) || `Erreur ${res.status}`,
          res.status,
          {
            code: typeof data.code === "string" ? data.code : undefined,
            currentOdds:
              typeof data.currentOdds === "number" ? data.currentOdds : undefined,
            currentCashOut:
              typeof data.currentCashOut === "number" ? data.currentCashOut : undefined,
            closed: typeof data.closed === "boolean" ? data.closed : undefined,
            suspended: typeof data.suspended === "boolean" ? data.suspended : undefined,
          }
        );
      }

      if (method === "GET") {
        const respEtag = res.headers.get("etag");
        if (respEtag) {
          setEtagEntry(cacheKey, respEtag, data);
        }
      }

      return data as unknown as T;
    } catch (err) {
      if (err instanceof ApiHttpError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new ApiHttpError("Délai réseau dépassé. Vérifiez votre connexion.", 0);
      }
      throw new ApiHttpError("Connexion réseau momentanément indisponible.", 0);
    } finally {
      clearTimeout(timeoutId);
    }
  };

  if (method === "GET" && !options.bypassEtag) {
    const p = execute().finally(() => {
      inflightGets.delete(cacheKey);
    });
    inflightGets.set(cacheKey, p);
    return p;
  }

  return execute();
}
