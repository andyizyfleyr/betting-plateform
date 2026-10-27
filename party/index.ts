import type * as Party from "partykit/server";

/**
 * Serveur temps réel PartyKit — Pulse Bet (Web Next.js + Android Expo Go SDK 52)
 *
 * Salons pris en charge :
 * - `live-matches` (public) : conserve le dernier snapshot des matchs/cotes en RAM pour un
 *   envoi immédiat (`0 ms`) à chaque `onConnect`, diffuse les deltas cotes/scores/Cash Out en
 *   `< 50 ms`, et pilote l'avancement continu via `onAlarm` uniquement tant qu'au moins 1
 *   joueur est connecté (hibernation WebSocket à 0 % CPU dès que le salon est vide).
 * - `user-<id>` (privé, protégé par jeton HMAC-SHA256 dans `onBeforeConnect`) : notifie
 *   instantanément le joueur dès qu'un pari est placé, vendu (Cash Out) ou réglé (Gagné/Perdu/Remboursé).
 */

const LIVE_ROOM_ID = "live-matches";
const ALARM_INTERVAL_MS = 3_500;
const SNAPSHOT_MAX_AGE_MS = 15_000;

function getSecret(env: Record<string, unknown>): string {
  const s = env.PARTYKIT_SECRET;
  if (typeof s === "string" && s.trim().length > 0) return s.trim();
  return "pulse-bet-dev-partykit-secret";
}

function getAppUrl(env: Record<string, unknown>): string | null {
  const raw = env.APP_URL ?? env.NEXT_PUBLIC_APP_URL;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim().replace(/\/+$/, "");
  }
  return null;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function timingSafeHexEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifyUserRoomToken(
  token: string | null,
  expectedUserId: string,
  secret: string
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [uid, expStr, sigHex] = parts;
  if (uid !== expectedUserId) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expectedSig = await hmacSha256Hex(secret, `${uid}.${expStr}`);
  return timingSafeHexEquals(sigHex.toLowerCase(), expectedSig.toLowerCase());
}

export default class PulseBetRealtimeServer implements Party.Server {
  readonly options: Party.ServerOptions = {
    hibernate: true,
  };

  private lastSnapshotJson: string | null = null;
  private lastSnapshotAt = 0;

  constructor(readonly room: Party.Room) {}

  static async onBeforeConnect(req: Party.Request, lobby: Party.Lobby) {
    // Les salons privés `user-<id>` exigent un jeton HMAC valide signé par Next.js
    if (lobby.id.startsWith("user-")) {
      const expectedUid = lobby.id.slice("user-".length);
      const url = new URL(req.url);
      const token = url.searchParams.get("token");
      const secret = getSecret(lobby.env);
      const ok = await verifyUserRoomToken(token, expectedUid, secret);
      if (!ok) {
        return new Response("Accès temps réel non autorisé", { status: 401 });
      }
    }
    return req;
  }

  private hasActiveConnections(): boolean {
    for (const _ of this.room.getConnections()) {
      return true;
    }
    return false;
  }

  private async ensureLiveAlarmScheduled(): Promise<void> {
    if (this.room.id !== LIVE_ROOM_ID) return;
    if (!getAppUrl(this.room.env)) return;
    const currentAlarm = await this.room.storage.getAlarm();
    if (currentAlarm === null) {
      await this.room.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }

  async onConnect(conn: Party.Connection): Promise<void> {
    if (this.room.id === LIVE_ROOM_ID) {
      // Hydratation instantanée (0 ms, 0 requête SQL) si un snapshot frais est en mémoire
      if (
        this.lastSnapshotJson &&
        Date.now() - this.lastSnapshotAt < SNAPSHOT_MAX_AGE_MS
      ) {
        conn.send(this.lastSnapshotJson);
      } else {
        conn.send(
          JSON.stringify({
            type: "CONNECTED",
            room: this.room.id,
            ts: Date.now(),
          })
        );
      }
      await this.ensureLiveAlarmScheduled();
      return;
    }

    conn.send(
      JSON.stringify({
        type: "CONNECTED",
        room: this.room.id,
        ts: Date.now(),
      })
    );
  }

  async onClose(): Promise<void> {
    if (this.room.id === LIVE_ROOM_ID && !this.hasActiveConnections()) {
      await this.room.storage.deleteAlarm();
    }
  }

  onMessage(message: string | ArrayBuffer, sender: Party.Connection): void {
    if (typeof message !== "string") return;
    if (message === "PING" || message === '{"type":"PING"}') {
      sender.send(JSON.stringify({ type: "PONG", ts: Date.now() }));
    }
  }

  /**
   * Réveil périodique léger uniquement tant qu'au moins 1 client WebSocket écoute `live-matches`.
   * Dès que le dernier joueur quitte l'app, l'alarme s'arrête et le salon hiberne à 0 % CPU.
   */
  async onAlarm(): Promise<void> {
    if (this.room.id !== LIVE_ROOM_ID || !this.hasActiveConnections()) {
      return;
    }

    const appUrl = getAppUrl(this.room.env);
    if (!appUrl) return;

    const secret = getSecret(this.room.env);
    try {
      const res = await fetch(`${appUrl}/api/realtime/tick`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          matches?: unknown[];
          serverTime?: string;
        };
        if (Array.isArray(data.matches)) {
          const msg = JSON.stringify({
            type: "MATCHES_SNAPSHOT",
            matches: data.matches,
            serverTime: data.serverTime ?? new Date().toISOString(),
            ts: Date.now(),
          });
          if (msg !== this.lastSnapshotJson) {
            this.lastSnapshotJson = msg;
            this.lastSnapshotAt = Date.now();
            this.room.broadcast(msg);
          } else {
            this.lastSnapshotAt = Date.now();
          }
        }
      }
    } catch {
      /* Tolérance réseau : la prochaine alarme reprendra automatiquement */
    } finally {
      if (this.hasActiveConnections()) {
        await this.room.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
      }
    }
  }

  /**
   * Réception directe des événements poussés par les Route Handlers Next.js (`POST` authentifié).
   */
  async onRequest(req: Party.Request): Promise<Response> {
    if (req.method === "GET") {
      let connections = 0;
      for (const _ of this.room.getConnections()) connections++;
      return Response.json({
        ok: true,
        room: this.room.id,
        connections,
        hasSnapshot: Boolean(this.lastSnapshotJson),
      });
    }

    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const expected = `Bearer ${getSecret(this.room.env)}`;
    if (!timingSafeHexEquals(authHeader, expected)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const rawBody = await req.text();
    if (!rawBody) {
      return Response.json({ ok: false, error: "Empty payload" }, { status: 400 });
    }

    try {
      const parsed = JSON.parse(rawBody) as { type?: string };
      if (this.room.id === LIVE_ROOM_ID && parsed.type === "MATCHES_SNAPSHOT") {
        this.lastSnapshotJson = rawBody;
        this.lastSnapshotAt = Date.now();
      }
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    this.room.broadcast(rawBody);
    return Response.json({ ok: true });
  }
}
