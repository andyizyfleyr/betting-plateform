import { NextResponse } from "next/server";

/**
 * Empreinte ETag ultra-légère (double FNV-1a 32 bits + taille) et cache mémoire
 * court-terme pour éviter :
 *  1) de ré-interroger PostgreSQL plusieurs fois dans la même fenêtre de 2,5 s sur les flux publics ;
 *  2) de renvoyer tout le JSON au navigateur lorsque rien n'a changé (`304 Not Modified`, 0 octet).
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

const MATCHES_CACHE_TTL_MS = 2_500;
let matchesPayloadCache: CachedJsonPayload | null = null;

export function getMatchesPayloadCache(): CachedJsonPayload | null {
  if (
    matchesPayloadCache &&
    Date.now() - matchesPayloadCache.at < MATCHES_CACHE_TTL_MS
  ) {
    return matchesPayloadCache;
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
  matchesPayloadCache = entry;
  return entry;
}

export function invalidatePublicApiCaches(): void {
  matchesPayloadCache = null;
}

export function jsonWithEtag(
  req: Request,
  data: unknown,
  precomputed?: CachedJsonPayload
): NextResponse {
  const json = precomputed ? precomputed.json : JSON.stringify(data);
  const etag = precomputed ? precomputed.etag : computeWeakEtag(json);
  const ifNoneMatch = req.headers.get("if-none-match");

  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "private, no-cache",
      },
    });
  }

  return new NextResponse(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ETag: etag,
      "Cache-Control": "private, no-cache",
    },
  });
}
