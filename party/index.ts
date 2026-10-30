import { getPublicResults } from "./public-results";
import { buildLiveDelta, isLiveSnapshot, type LiveSnapshot } from "./live-delta";
import {
  routePartykitRequest,
  Server,
  type Connection,
  type WSMessage,
} from "partyserver";

/**
 * Serveur temps réel PartyServer officiel (Cloudflare PartyKit v2 / Durable Objects SQLite)
 * — Pulse Bet (Web Next.js + Android Expo Go SDK 52)
 *
 * Routage 100 % compatible `PartySocket` : `/parties/main/<salon>` (binding `Main` -> `main`).
 *
 * Salons pris en charge :
 * - `live-matches` (public) : conserve le dernier snapshot des matchs/cotes en RAM pour un
 *   envoi immédiat (`0 ms`) à chaque `onConnect`, diffuse les deltas cotes/scores/Cash Out en
 *   `< 50 ms`, et pilote l'avancement continu via `onAlarm` uniquement tant qu'au moins 1
 *   joueur est connecté (hibernation WebSocket à 0 % CPU dès que le salon est vide).
 * - `user-<id>` (privé, protégé par jeton HMAC-SHA256 dans `onBeforeConnect`) : notifie
 *   instantanément le joueur dès qu'un pari est placé, vendu (Cash Out) ou réglé (Gagné/Perdu/Remboursé).
 */

export interface Env {
  Main: DurableObjectNamespace<Main>;
  HYPERDRIVE?: Hyperdrive;
  PARTYKIT_SECRET?: string;
  APP_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
}

const LIVE_ROOM_ID = "live-matches";
const ALARM_INTERVAL_MS = 3_500;
const SNAPSHOT_MAX_AGE_MS = 15_000;

function getSecret(env: Env): string {
  const s = env.PARTYKIT_SECRET;
  if (typeof s === "string" && s.trim().length > 0) return s.trim();
  return "pulse-bet-dev-partykit-secret";
}

function getAppUrl(env: Env): string | null {
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

export class Main extends Server<Env> {
  static options = {
    hibernate: true,
  };

  private lastSnapshotJson: string | null = null;
  private lastSnapshotAt = 0;
  private snapshotSequence = 0;

  /** Les anciens clients reçoivent toujours les snapshots ; delta = opt-in. */
  private publishSnapshot(snapshot: LiveSnapshot): void {
    const previous = this.lastSnapshotJson ? JSON.parse(this.lastSnapshotJson) as LiveSnapshot : null;
    const base = this.snapshotSequence;
    const seq = ++this.snapshotSequence;
    const raw = JSON.stringify(snapshot);
    const fullV2 = JSON.stringify({ ...snapshot, seq });
    const delta = previous && isLiveSnapshot(previous)
      ? JSON.stringify(buildLiveDelta(previous, snapshot, base, seq)) : null;
    this.lastSnapshotJson = raw;
    this.lastSnapshotAt = Date.now();
    for (const conn of this.getConnections<{ deltaV1?: boolean; ready?: boolean }>()) {
      try {
        if (!conn.state?.deltaV1) conn.send(raw);
        else if (!conn.state.ready || !delta || delta.length >= fullV2.length) {
          conn.send(fullV2);
          conn.setState({ deltaV1: true, ready: true });
        } else conn.send(delta);
      } catch { /* une connexion morte ne doit pas bloquer les autres */ }
    }
  }

  private hasActiveConnections(): boolean {
    for (const _ of this.getConnections()) {
      return true;
    }
    return false;
  }

  private async ensureLiveAlarmScheduled(): Promise<void> {
    if (this.name !== LIVE_ROOM_ID) return;
    if (!getAppUrl(this.env)) return;
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }

  async onConnect(conn: Connection): Promise<void> {
    if (this.name === LIVE_ROOM_ID) {
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
            room: this.name,
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
        room: this.name,
        ts: Date.now(),
      })
    );
  }

  async onClose(): Promise<void> {
    if (this.name === LIVE_ROOM_ID && !this.hasActiveConnections()) {
      await this.ctx.storage.deleteAlarm();
    }
  }

  onMessage(sender: Connection, message: WSMessage): void {
    if (typeof message !== "string") return;
    if (message === "PING" || message === '{"type":"PING"}') {
      sender.send(JSON.stringify({ type: "PONG", ts: Date.now() }));
      return;
    }
    if (this.name !== LIVE_ROOM_ID) return;
    try {
      const msg = JSON.parse(message) as { type?: string };
      if (msg.type !== "LIVE_DELTA_V1" && msg.type !== "LIVE_RESYNC_V1") return;
      const conn = sender as Connection<{ deltaV1?: boolean; ready?: boolean }>;
      const ready = Boolean(this.lastSnapshotJson && Date.now() - this.lastSnapshotAt < SNAPSHOT_MAX_AGE_MS);
      conn.setState({ deltaV1: true, ready });
      if (ready && this.lastSnapshotJson) {
        conn.send(JSON.stringify({ ...JSON.parse(this.lastSnapshotJson), seq: this.snapshotSequence }));
      }
    } catch { /* ignorer les messages malformés */ }
  }

  /**
   * Réveil périodique léger uniquement tant qu'au moins 1 client WebSocket écoute `live-matches`.
   * Dès que le dernier joueur quitte l'app, l'alarme s'arrête et le salon hiberne à 0 % CPU.
   */
  async onAlarm(): Promise<void> {
    if (this.name !== LIVE_ROOM_ID || !this.hasActiveConnections()) {
      return;
    }

    const appUrl = getAppUrl(this.env);
    if (!appUrl) return;

    const secret = getSecret(this.env);
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
          this.publishSnapshot({
            type: "MATCHES_SNAPSHOT",
            matches: data.matches as LiveSnapshot["matches"],
            serverTime: data.serverTime ?? new Date().toISOString(),
            ts: Date.now(),
          });
        }
      }
    } catch {
      /* Tolérance réseau : la prochaine alarme reprendra automatiquement */
    } finally {
      if (this.hasActiveConnections()) {
        await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
      }
    }
  }

  /**
   * Réception directe des événements poussés par les Route Handlers Next.js (`POST` authentifié).
   */
  async onRequest(req: Request): Promise<Response> {
    if (req.method === "GET") {
      let connections = 0;
      for (const _ of this.getConnections()) connections++;
      return Response.json({
        ok: true,
        room: this.name,
        connections,
        hasSnapshot: Boolean(this.lastSnapshotJson),
      });
    }

    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const expected = `Bearer ${getSecret(this.env)}`;
    if (!timingSafeHexEquals(authHeader, expected)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const rawBody = await req.text();
    if (!rawBody) {
      return Response.json(
        { ok: false, error: "Empty payload" },
        { status: 400 }
      );
    }

    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (this.name === LIVE_ROOM_ID && isLiveSnapshot(parsed)) {
        this.publishSnapshot(parsed);
      } else {
        this.broadcast(rawBody);
      }
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    return Response.json({ ok: true });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/public/hyperdrive/results") return getPublicResults(request, env.HYPERDRIVE, ctx);
    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "pulse-bet-partyserver",
      });
    }

    const partyResponse = await routePartykitRequest(request, env, {
      cors: true,
      onBeforeConnect: async (req, lobby) => {
        if (lobby.name.startsWith("user-")) {
          const expectedUid = lobby.name.slice("user-".length);
          const reqUrl = new URL(req.url);
          const token = reqUrl.searchParams.get("token");
          const secret = getSecret(env);
          const ok = await verifyUserRoomToken(token, expectedUid, secret);
          if (!ok) {
            return new Response("Accès temps réel non autorisé", {
              status: 401,
            });
          }
        }
      },
    });

    return partyResponse ?? new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
