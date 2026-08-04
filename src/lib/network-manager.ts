"use client";

import { useEffect, useState } from "react";

/**
 * Gestion réseau du client :
 * - moniteur de qualité (latence, pertes, en ligne/hors ligne),
 * - fetch avec timeout (AbortController) pour ne jamais bloquer le jeu,
 * - post avec retries + backoff exponentiel pour les actions critiques (cashout).
 */

export type NetQuality = "good" | "fair" | "poor" | "offline";

export interface NetState {
  online: boolean;
  quality: NetQuality;
  rttMs: number | null;
  avgRttMs: number | null;
  lossPct: number;
  samples: number;
}

export const NET_CONFIG = {
  measureIntervalMs: 5000,
  timeoutMs: 4000,
  maxSamples: 8,
  goodMs: 250,
  fairMs: 600,
  poorMs: 1200,
  retryableStatuses: [0, 408, 429, 500, 502, 503, 504],
} as const;

const initialState: NetState = {
  online: true,
  quality: "good",
  rttMs: null,
  avgRttMs: null,
  lossPct: 0,
  samples: 0,
};

function classify(online: boolean, avg: number | null, lossPct: number): NetQuality {
  if (!online) return "offline";
  if (lossPct >= 50) return "poor";
  if (avg == null) return "good";
  if (avg < NET_CONFIG.goodMs) return "good";
  if (avg < NET_CONFIG.fairMs) return "fair";
  return "poor";
}

type Listener = (s: NetState) => void;

class NetworkManager {
  private listeners = new Set<Listener>();
  private state: NetState = { ...initialState };
  private rtts: number[] = [];
  private failures = 0;
  private total = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  getState(): NetState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(next: NetState) {
    this.state = next;
    for (const fn of this.listeners) fn(next);
  }

  private recompute(rtt: number | null, success: boolean) {
    if (typeof navigator === "undefined") return;
    this.total += 1;
    if (success && rtt != null) {
      this.rtts.push(rtt);
      if (this.rtts.length > NET_CONFIG.maxSamples) this.rtts.shift();
    } else {
      this.failures += 1;
    }
    const lossPct = this.total ? Math.round((this.failures / this.total) * 100) : 0;
    const avg = this.rtts.length
      ? this.rtts.reduce((a, b) => a + b, 0) / this.rtts.length
      : null;
    this.emit({
      online: navigator.onLine,
      quality: classify(navigator.onLine, avg, lossPct),
      rttMs: rtt,
      avgRttMs: avg,
      lossPct,
      samples: this.rtts.length,
    });
  }

  async measure() {
    if (typeof window === "undefined") return;
    if (!navigator.onLine) {
      this.emit({ ...this.state, online: false, quality: "offline" });
      return;
    }
    const started = performance.now();
    const ok = await fetchWithTimeout(NET_CONFIG.timeoutMs, "/api/health", {
      cache: "no-store",
    })
      .then((r) => r.ok)
      .catch(() => false);
    this.recompute(Math.round(performance.now() - started), ok);
  }

  /** Appelé par la couche API après une requête applicative. */
  reportSuccess(rttMs?: number) {
    this.recompute(rttMs ?? null, true);
  }

  reportFailure() {
    this.recompute(null, false);
  }

  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    window.addEventListener("online", () => {
      this.emit({ ...this.state, online: true, quality: classify(true, this.state.avgRttMs, this.state.lossPct) });
    });
    window.addEventListener("offline", () => {
      this.emit({ ...this.state, online: false, quality: "offline" });
    });
    void this.measure();
    this.timer = setInterval(() => void this.measure(), NET_CONFIG.measureIntervalMs);
  }
}

export const networkManager = new NetworkManager();

/** Hook React : état réseau courant (rendu côté client uniquement). */
export function useNetwork(): NetState {
  const [state, setState] = useState<NetState>(() => networkManager.getState());
  useEffect(() => {
    networkManager.start();
    return networkManager.subscribe(setState);
  }, []);
  return state;
}

export interface FetchResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  rttMs: number;
}

/** fetch avec timeout : un réseau lent ne bloque jamais le jeu. */
export async function fetchWithTimeout<T = unknown>(
  timeoutMs: number,
  url: string,
  init: RequestInit = {}
): Promise<FetchResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const rttMs = Math.round(performance.now() - started);
    const isJson = (res.headers.get("content-type") || "").toLowerCase().includes("application/json");
    const data = isJson ? ((await res.json()) as T) : (null as T | null);
    return { ok: res.ok, status: res.status, data, rttMs };
  } catch {
    return { ok: false, status: 0, data: null, rttMs: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

export interface PostOptions {
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  retryableStatuses?: readonly number[];
}

/**
 * POST JSON résilient : timeout + retries avec backoff exponentiel.
 * Les erreurs réseau (status 0) et 5xx/408/429 sont retentées ; les 4xx non.
 */
export async function postJson<T = unknown>(
  url: string,
  body: Record<string, unknown>,
  opts: PostOptions = {}
): Promise<FetchResult<T>> {
  const {
    timeoutMs = NET_CONFIG.timeoutMs,
    retries = 0,
    baseDelayMs = 500,
    retryableStatuses = NET_CONFIG.retryableStatuses,
  } = opts;

  let attempt = 0;
  for (;;) {
    const res = await fetchWithTimeout<T>(timeoutMs, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (res.ok || !retryableStatuses.includes(res.status) || attempt >= retries) {
      if (res.ok) networkManager.reportSuccess(res.rttMs);
      else networkManager.reportFailure();
      return res;
    }
    attempt += 1;
    networkManager.reportFailure();
    await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
  }
}
