import { NextRequest, NextResponse } from "next/server";
import {
  getPartyKitConfig,
  PARTY_LIVE_MATCHES_ROOM,
  signPartyUserToken,
} from "@/lib/partykit";
import { getAuthUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/realtime — Découverte dynamique de la configuration PartyKit pour le Web et Android :
 * - Renvoie `enabled: false` proprement tant que `PARTYKIT_HOST` n'est pas configuré (0 erreur console).
 * - Dès que `PARTYKIT_HOST` est renseigné sur Vercel, active instantanément les WebSockets
 *   sur le Web ET sur l'application Android Expo Go SDK 52 sans avoir à recompiler le bundle.
 * - Si le joueur est connecté, génère son jeton HMAC signé pour son salon privé `user-<id>`.
 */
export async function GET(req: NextRequest) {
  const cfg = getPartyKitConfig();
  const uid = await getAuthUserId(req).catch(() => null);

  const userRoom = cfg.enabled && uid ? `user-${uid}` : null;
  const userToken = cfg.enabled && uid ? signPartyUserToken(uid) : null;

  return NextResponse.json(
    {
      enabled: cfg.enabled,
      host: cfg.host,
      protocol: cfg.wsProtocol,
      publicRoom: PARTY_LIVE_MATCHES_ROOM,
      userRoom,
      userToken,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "CDN-Cache-Control": "private, no-store",
        "Vercel-CDN-Cache-Control": "private, no-store",
      },
    }
  );
}
