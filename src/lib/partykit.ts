import { createHmac, timingSafeEqual } from "crypto";
import { waitUntil } from "@vercel/functions";

/**
 * Pont serveur Next.js -> PartyKit :
 * - Découverte dynamique de l'hôte (`PARTYKIT_HOST` ou `NEXT_PUBLIC_PARTYKIT_HOST`).
 * - Signature HMAC-SHA256 des jetons d'accès aux salons privés `user-<id>`.
 * - Publication asynchrone non bloquante (`waitUntil`) avec coalescence anti-rafale (100 ms)
 *   pour pousser instantanément les scores, cotes, Cash Out et règlements de paris.
 */

export const PARTY_LIVE_MATCHES_ROOM = "live-matches";
const DEFAULT_PRODUCTION_PARTYKIT_HOST = "pulse-bet.matiasanauld.workers.dev";
const DEFAULT_PARTYKIT_DEV_SECRET = "pulse-bet-dev-partykit-secret";
const USER_TOKEN_TTL_MS = 12 * 3600_000;
const PUBLISH_COALESCE_MS = 100;

export interface PartyKitConfig {
  enabled: boolean;
  host: string | null;
  httpProtocol: "http" | "https";
  wsProtocol: "ws" | "wss";
  secret: string;
}

function isLocalPartyHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h.startsWith("localhost") ||
    h.startsWith("127.0.0.1") ||
    h.startsWith("0.0.0.0")
  );
}

export function getPartyKitConfig(): PartyKitConfig {
  const explicitHost = (
    process.env.PARTYKIT_HOST ??
    process.env.NEXT_PUBLIC_PARTYKIT_HOST ??
    ""
  ).trim();
  const fallbackHost =
    process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL)
      ? DEFAULT_PRODUCTION_PARTYKIT_HOST
      : "";
  const rawHost = (explicitHost || fallbackHost)
    .replace(/^https?:\/\//i, "")
    .replace(/^wss?:\/\//i, "")
    .replace(/\/+$/, "");

  // Doit correspondre exactement au secret du Worker Cloudflare (`party/index.ts`) :
  // n'utilise jamais JWT_SECRET en repli implicite car Cloudflare ne possède pas JWT_SECRET.
  const secret =
    process.env.PARTYKIT_SECRET?.trim() || DEFAULT_PARTYKIT_DEV_SECRET;

  if (!rawHost) {
    return {
      enabled: false,
      host: null,
      httpProtocol: "https",
      wsProtocol: "wss",
      secret,
    };
  }

  const local = isLocalPartyHost(rawHost);
  return {
    enabled: true,
    host: rawHost,
    httpProtocol: local ? "http" : "https",
    wsProtocol: local ? "ws" : "wss",
    secret,
  };
}

export function signPartyUserToken(userId: number, nowMs = Date.now()): string {
  const { secret } = getPartyKitConfig();
  const exp = nowMs + USER_TOKEN_TTL_MS;
  const payload = `${userId}.${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyPartyBearerHeader(authHeader: string | null): boolean {
  if (!authHeader) return false;
  const candidates = new Set<string>();
  const explicitSecret = process.env.PARTYKIT_SECRET?.trim();
  if (explicitSecret) {
    candidates.add(`Bearer ${explicitSecret}`);
  } else {
    candidates.add(`Bearer ${DEFAULT_PARTYKIT_DEV_SECRET}`);
  }
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (jwtSecret) {
    candidates.add(`Bearer ${jwtSecret}`);
  }
  const a = Buffer.from(authHeader);
  let matched = false;
  for (const expected of candidates) {
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      matched = true;
    }
  }
  return matched;
}

export type PartyServerEvent =
  | {
      type: "MATCHES_SNAPSHOT";
      matches: unknown[];
      serverTime: string;
      ts: number;
    }
  | {
      type: "MATCHES_INVALIDATE";
      matchIds?: number[];
      ts: number;
    }
  | {
      type: "PREDICTIONS_INVALIDATE";
      ts: number;
    }
  | {
      type: "USER_PULSE_INVALIDATE";
      reason?: string;
      ts: number;
    };

const pendingRoomPayloads = new Map<
  string,
  {
    timer: ReturnType<typeof setTimeout>;
    payload: PartyServerEvent;
    cancelWait: () => void;
  }
>();

async function postToPartyRoom(
  cfg: PartyKitConfig,
  roomId: string,
  event: PartyServerEvent
): Promise<void> {
  if (!cfg.enabled || !cfg.host) return;
  const url = `${cfg.httpProtocol}://${cfg.host}/parties/main/${encodeURIComponent(
    roomId
  )}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
  } catch {
    /* Non bloquant : l'application continue sans erreur même si PartyKit est indisponible */
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Publie un événement vers un salon PartyKit avec coalescence courte (100 ms) et `waitUntil`
 * enregistré immédiatement dans le contexte de requête actif afin que Vercel Serverless
 * ne gèle jamais le conteneur avant l'envoi effectif vers le Durable Object.
 */
export function publishPartyRoomEvent(
  roomId: string,
  event: PartyServerEvent,
  immediate = false
): void {
  const cfg = getPartyKitConfig();
  if (!cfg.enabled || !cfg.host) return;

  if (immediate) {
    const existing = pendingRoomPayloads.get(roomId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.cancelWait();
      pendingRoomPayloads.delete(roomId);
    }
    const p = postToPartyRoom(cfg, roomId, event);
    try {
      waitUntil(p);
    } catch {
      void p;
    }
    return;
  }

  const existing = pendingRoomPayloads.get(roomId);
  if (existing) {
    existing.payload = event;
    return;
  }

  let resolveBackground!: () => void;
  const backgroundPromise = new Promise<void>((resolve) => {
    resolveBackground = resolve;
  });

  const timer = setTimeout(() => {
    const latest = pendingRoomPayloads.get(roomId);
    pendingRoomPayloads.delete(roomId);
    if (!latest) {
      resolveBackground();
      return;
    }
    void postToPartyRoom(cfg, roomId, latest.payload).finally(() => {
      resolveBackground();
    });
  }, PUBLISH_COALESCE_MS);

  pendingRoomPayloads.set(roomId, {
    payload: event,
    timer,
    cancelWait: resolveBackground,
  });

  try {
    waitUntil(backgroundPromise);
  } catch {
    void backgroundPromise;
  }
}

export function publishUserRealtimeInvalidation(
  userIds?: number[],
  reason = "mutation"
): void {
  const cfg = getPartyKitConfig();
  if (!cfg.enabled || !cfg.host) return;

  const ts = Date.now();
  if (!userIds || userIds.length === 0) {
    publishPartyRoomEvent(PARTY_LIVE_MATCHES_ROOM, {
      type: "USER_PULSE_INVALIDATE",
      reason,
      ts,
    });
    return;
  }

  const uniqueIds = [...new Set(userIds.filter((id) => Number.isInteger(id) && id > 0))];
  for (const uid of uniqueIds) {
    publishPartyRoomEvent(
      `user-${uid}`,
      {
        type: "USER_PULSE_INVALIDATE",
        reason,
        ts,
      },
      true
    );
  }
}
