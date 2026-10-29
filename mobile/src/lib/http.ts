import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import {
  calibrateServerClockOffset,
  registerLiveClockMatch,
  registerLiveClockMatches,
  type LiveClockSource,
} from "./live-clock";

export const ODDS_CHANGED_CODE = "ODDS_CHANGED" as const;
export const CASHOUT_CHANGED_CODE = "CASHOUT_CHANGED" as const;

export interface OddsChangedLegDetail {
  kind: "sport" | "prediction";
  matchId?: number;
  questionId?: number;
  market: string;
  selection: string;
  previousOdds: number;
  currentOdds: number;
  direction: "up" | "down";
}

export interface OddsChangedDetails {
  previousOdds: number;
  currentOdds: number;
  direction: "up" | "down";
  updatedLegs?: OddsChangedLegDetail[];
}

export interface CashoutChangedDetails {
  previousCashout: number;
  currentCashout: number;
  previousValue?: number;
  currentValue?: number;
}

const TOKEN_STORE_KEY = "pulse_android_jwt_v1";
const BIOMETRIC_TOKEN_KEY = "pulse_android_jwt_biometric_v1";
const BIOMETRIC_ENABLED_KEY = "pulse_android_biometric_enabled_v1";
const BIOMETRIC_OPTIONS: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  authenticationPrompt: "Confirmez votre identité pour accéder à Pulse Bet",
};
let biometricMode = false;

export async function isBiometricLoginEnabled(): Promise<boolean> {
  try { return (await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY)) === "1"; }
  catch { return false; }
}

export function isBiometricModeActive(): boolean { return biometricMode; }
export async function verifyBiometricUnlock(): Promise<boolean> {
  if (!biometricMode || !memoryAuthToken) return false;
  const verified = await SecureStore.getItemAsync(BIOMETRIC_TOKEN_KEY, BIOMETRIC_OPTIONS);
  return !!verified && verified === memoryAuthToken;
}

export async function setBiometricLoginEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    if (!SecureStore.canUseBiometricAuthentication()) throw new Error("Aucune biométrie disponible ou configurée sur cet appareil.");
    if (!memoryAuthToken) throw new Error("Connectez-vous avant d’activer la biométrie.");
    // Créer et vérifier la clé protégée avant de supprimer le jeton non protégé.
    await SecureStore.setItemAsync(BIOMETRIC_TOKEN_KEY, memoryAuthToken, BIOMETRIC_OPTIONS);
    const verified = await SecureStore.getItemAsync(BIOMETRIC_TOKEN_KEY, BIOMETRIC_OPTIONS);
    if (verified !== memoryAuthToken) throw new Error("La vérification biométrique a échoué.");
    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, "1");
    biometricMode = true;
    await SecureStore.deleteItemAsync(TOKEN_STORE_KEY);
  } else {
    if (memoryAuthToken) await SecureStore.setItemAsync(TOKEN_STORE_KEY, memoryAuthToken);
    await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
    biometricMode = false;
    await SecureStore.deleteItemAsync(BIOMETRIC_TOKEN_KEY);
  }
}

function resolveApiBaseUrl(): string {
  const envUrl =
    typeof process !== "undefined" &&
    process.env &&
    typeof process.env.EXPO_PUBLIC_API_URL === "string"
      ? process.env.EXPO_PUBLIC_API_URL.trim()
      : "";
  if (envUrl.length > 0) {
    return envUrl.replace(/\/+$/, "");
  }

  const cAny = Constants as unknown as {
    expoConfig?: { extra?: { apiBaseUrl?: string } };
    manifest2?: { extra?: { expoClient?: { extra?: { apiBaseUrl?: string } } } };
    manifest?: { extra?: { apiBaseUrl?: string } };
  };
  const extra =
    cAny.expoConfig?.extra ??
    cAny.manifest2?.extra?.expoClient?.extra ??
    cAny.manifest?.extra ??
    {};
  if (extra.apiBaseUrl && extra.apiBaseUrl.trim().length > 0) {
    return extra.apiBaseUrl.trim().replace(/\/+$/, "");
  }
  return "https://be-plateform.vercel.app";
}

export const API_BASE_URL = resolveApiBaseUrl();

let memoryAuthToken: string | null = null;
let tokenHydrated = false;
let hydrationPromise: Promise<string | null> | null = null;
let unauthorizedListeners: Array<() => void> = [];

export function onUnauthorizedResponse(cb: () => void): () => void {
  unauthorizedListeners.push(cb);
  return () => {
    unauthorizedListeners = unauthorizedListeners.filter((fn) => fn !== cb);
  };
}

export async function hydrateAuthToken(): Promise<string | null> {
  if (tokenHydrated) return memoryAuthToken;
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    try {
      biometricMode = await isBiometricLoginEnabled();
      const stored = biometricMode
        ? await SecureStore.getItemAsync(BIOMETRIC_TOKEN_KEY, BIOMETRIC_OPTIONS)
        : await SecureStore.getItemAsync(TOKEN_STORE_KEY);
      memoryAuthToken = stored && stored.trim().length > 0 ? stored.trim() : null;
    } catch {
      // Annulation ou biométrie changée : aucune session n'est restaurée ; mot de passe requis.
      memoryAuthToken = null;
    }
    tokenHydrated = true;
    return memoryAuthToken;
  })();
  try { return await hydrationPromise; } finally { hydrationPromise = null; }
}

export function getMemoryAuthToken(): string | null {
  return memoryAuthToken;
}

export async function persistAuthToken(token: string | null): Promise<void> {
  memoryAuthToken = token && token.trim().length > 0 ? token.trim() : null;
  tokenHydrated = true;
  clearEtagCache();
  try {
    if (memoryAuthToken) {
      if (biometricMode) {
        await SecureStore.setItemAsync(BIOMETRIC_TOKEN_KEY, memoryAuthToken, BIOMETRIC_OPTIONS);
        await SecureStore.deleteItemAsync(TOKEN_STORE_KEY);
      } else {
        await SecureStore.setItemAsync(TOKEN_STORE_KEY, memoryAuthToken);
      }
    } else {
      await SecureStore.deleteItemAsync(TOKEN_STORE_KEY);
      await SecureStore.deleteItemAsync(BIOMETRIC_TOKEN_KEY);
      await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
      biometricMode = false;
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

function stripRefreshParam(path: string): string {
  const qIdx = path.indexOf("?");
  if (qIdx === -1) return path;
  const base = path.slice(0, qIdx);
  const parts = path
    .slice(qIdx + 1)
    .split("&")
    .filter((p) => p && !p.startsWith("refresh="));
  return parts.length > 0 ? `${base}?${parts.join("&")}` : base;
}

function appendRefreshParam(path: string): string {
  const clean = stripRefreshParam(path);
  return clean.includes("?") ? `${clean}&refresh=1` : `${clean}?refresh=1`;
}

/**
 * Routes publiques mises en cache au CDN Edge Vercel :
 * Omet strictement l'en-tête `Authorization` pour bénéficier à 100 % du cache partagé Edge + `304 Not Modified`.
 */
function isPublicEdgeGetPath(path: string): boolean {
  const clean = stripRefreshParam(path);
  return (
    clean === "/api/matches/slim" ||
    clean === "/api/matches" ||
    /^\/api\/matches\/[1-9]\d{0,9}$/.test(clean) ||
    clean === "/api/matches/history" ||
    clean.startsWith("/api/matches/history?") ||
    clean === "/api/predictions/catalog"
  );
}

export class ApiHttpError extends Error {
  status: number;
  code?: string;
  details?: OddsChangedDetails;
  cashoutDetails?: CashoutChangedDetails;
  currentOdds?: number;
  currentCashOut?: number;
  closed?: boolean;
  suspended?: boolean;

  constructor(
    message: string,
    status: number,
    payload?: {
      code?: string;
      details?: OddsChangedDetails;
      cashoutDetails?: CashoutChangedDetails;
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
    this.details = payload?.details;
    this.cashoutDetails = payload?.cashoutDetails;
    this.currentOdds = payload?.currentOdds ?? payload?.details?.currentOdds;
    this.currentCashOut =
      payload?.currentCashOut ?? payload?.cashoutDetails?.currentCashout;
    this.closed = payload?.closed;
    this.suspended = payload?.suspended;
  }
}

export function generateIdempotencyKey(prefix = "idem"): string {
  const safePrefix = prefix.replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "idem";
  const randA = Math.random().toString(36).slice(2, 12);
  const randB = Math.random().toString(36).slice(2, 12);
  return `${safePrefix}_${Date.now().toString(36)}_${randA}${randB}`;
}

export function generateBetIdempotencyKey(): string {
  return generateIdempotencyKey("bet");
}

export const createIdempotencyKey = generateIdempotencyKey;

export function roundOdds2(odds: number): number {
  return Math.round(odds * 100) / 100;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  bypassEtag?: boolean;
  forceRefresh?: boolean;
  ignoreUnauthorizedRedirect?: boolean;
}

export async function requestJson<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const method = options.method ?? "GET";
  const isGet = method === "GET";
  const forceRefresh = Boolean(isGet && options.forceRefresh);
  const bypassCache = Boolean(options.bypassEtag || forceRefresh);
  const canonicalPath = stripRefreshParam(path);
  const effectivePath = forceRefresh ? appendRefreshParam(path) : path;
  const isPublicEdge = isGet && isPublicEdgeGetPath(canonicalPath);
  const canonicalUrl = canonicalPath.startsWith("http")
    ? canonicalPath
    : `${API_BASE_URL}${canonicalPath}`;
  const url = effectivePath.startsWith("http")
    ? effectivePath
    : `${API_BASE_URL}${effectivePath}`;
  const token = isPublicEdge
    ? null
    : tokenHydrated
      ? memoryAuthToken
      : await hydrateAuthToken();
  const cacheKey = isPublicEdge
    ? `public:${canonicalUrl}`
    : `${token ? token.slice(-12) : "anon"}:${canonicalUrl}`;

  if (isGet && !bypassCache) {
    const existing = inflightGets.get(cacheKey);
    if (existing) {
      return existing as Promise<T>;
    }
  } else if (!isGet) {
    // Toute mutation invalide les ETag clients pour refléter immédiatement le nouveau solde / ticket
    etagStore.clear();
  }

  const execute = async (): Promise<T> => {
    const timeoutMs = options.timeoutMs ?? (isGet ? 12_000 : 18_000);
    const abortController =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        abortController?.abort();
        reject(
          new ApiHttpError(
            "Le serveur met trop de temps à répondre — veuillez réessayer.",
            504
          )
        );
      }, timeoutMs);
    });

    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...(options.headers ?? {}),
      };

      if (!isPublicEdge) {
        headers["X-Client-Platform"] = "android-expo";
        if (forceRefresh) {
          headers["x-pulse-refresh"] = "1";
        }
      }

      if (token && !isPublicEdge) {
        headers.Authorization = `Bearer ${token}`;
      }

      if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
      }

      const cachedEtag =
        isGet && !bypassCache ? etagStore.get(cacheKey) : undefined;
      if (cachedEtag?.etag) {
        headers["If-None-Match"] = cachedEtag.etag;
      }

      // Important React Native (`whatwg-fetch`) : ne jamais passer `cache: "no-store"` ou `"no-cache"`
      // sur `GET`, car `whatwg-fetch` réécrit l'URL en ajoutant `?_=<timestamp>`, ce qui casse le cache
      // CDN Edge partagé et déclenchait un rejet `400` sur les routes publiques canoniques.
      const sentAtMs = Date.now();
      const res = await Promise.race([
        fetch(url, {
          method,
          headers,
          signal: abortController?.signal,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        }),
        timeoutPromise,
      ]);
      const rttMs = Math.max(0, Date.now() - sentAtMs);

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
        if (
          res.status === 401 &&
          !isPublicEdge &&
          !options.ignoreUnauthorizedRedirect &&
          memoryAuthToken
        ) {
          await persistAuthToken(null);
          for (const listener of unauthorizedListeners) listener();
        }
        const code = typeof data.code === "string" ? data.code : undefined;
        const rawDetails =
          data.details && typeof data.details === "object"
            ? (data.details as OddsChangedDetails & CashoutChangedDetails)
            : undefined;
        const isCashoutChanged = code === CASHOUT_CHANGED_CODE;
        const fallbackMsg =
          res.status === 504
            ? "Le serveur met trop de temps à répondre — veuillez réessayer."
            : "Service temporairement indisponible — veuillez réessayer.";

        throw new ApiHttpError(
          (typeof data.error === "string" && data.error) || fallbackMsg,
          res.status,
          {
            code,
            details: isCashoutChanged ? undefined : rawDetails,
            cashoutDetails: isCashoutChanged && rawDetails
              ? {
                  ...rawDetails,
                  previousValue: rawDetails.previousValue ?? rawDetails.previousCashout,
                  currentValue: rawDetails.currentValue ?? rawDetails.currentCashout,
                }
              : undefined,
            currentOdds:
              typeof data.currentOdds === "number" ? data.currentOdds : undefined,
            currentCashOut:
              typeof data.currentCashOut === "number" ? data.currentCashOut : undefined,
            closed: typeof data.closed === "boolean" ? data.closed : undefined,
            suspended: typeof data.suspended === "boolean" ? data.suspended : undefined,
          }
        );
      }

      const serverTimeStr =
        typeof data.serverTime === "string" ? data.serverTime : null;
      if (serverTimeStr || res.headers.get("date")) {
        calibrateServerClockOffset({
          serverTimeIso: serverTimeStr,
          ageHeader: res.headers.get("age"),
          dateHeader: res.headers.get("date"),
          rttMs,
        });
      }
      if (Array.isArray(data.matches)) {
        registerLiveClockMatches(data.matches as LiveClockSource[]);
      }
      if (data.match && typeof data.match === "object") {
        registerLiveClockMatch(data.match as LiveClockSource);
      }

      if (isGet) {
        const respEtag = res.headers.get("etag");
        if (respEtag) {
          setEtagEntry(cacheKey, respEtag, data);
        }
      }

      return data as unknown as T;
    } catch (err) {
      if (err instanceof ApiHttpError) throw err;
      throw new ApiHttpError("Connexion réseau momentanément indisponible.", 0);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  };

  if (isGet && !bypassCache) {
    const p = execute().finally(() => {
      inflightGets.delete(cacheKey);
    });
    inflightGets.set(cacheKey, p);
    return p;
  }

  return execute();
}
