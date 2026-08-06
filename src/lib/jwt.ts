/**
 * Cœur JWT (HS256) compatible Edge runtime (middleware) ET Node (route handlers).
 * Utilise uniquement WebCrypto + Buffer + TextEncoder, sans dépendance node:crypto.
 */

export const AUTH_COOKIE = "__pulse_session";

const SECRET = process.env.JWT_SECRET ?? "pulse-demo-secret-change-in-production";

const TTL_SECONDS = 7 * 24 * 3600; // 7 jours

export interface JwtPayload {
  sub: number;
  jti?: string; // JWT ID pour révocation
  [key: string]: unknown;
}

// Blacklist des tokens révoqués (en mémoire, pour production utiliser Redis/DB)
const revokedTokens = new Set<string>();

export function revokeToken(jti: string): void {
  revokedTokens.add(jti);
}

export function isTokenRevoked(jti: string): boolean {
  return revokedTokens.has(jti);
}

function b64url(data: string | Buffer): string {
  return Buffer.from(data).toString("base64url");
}

async function hmacKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signJwt(payload: JwtPayload): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const jti = payload.jti ?? crypto.randomUUID();
  const body = b64url(
    JSON.stringify({ ...payload, jti, iat: now, exp: now + TTL_SECONDS })
  );
  const data = `${header}.${body}`;
  const key = await hmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${Buffer.from(sig).toString("base64url")}`;
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b = Buffer.from(s, "base64url");
  const out = new Uint8Array(b.length);
  out.set(b);
  return out;
}

/** Vérifie la signature (WebCrypto, fonctionne en Node ET en edge/middleware). */
export async function verifyJwt(token: string): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  try {
    const key = await hmacKey();
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlToBytes(s),
      new TextEncoder().encode(`${h}.${b}`)
    );
    if (!ok) return null;
    const payload = JSON.parse(Buffer.from(b, "base64url").toString()) as JwtPayload;
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000))
      return null;
    if (typeof payload.sub !== "number") return null;
    if (payload.jti && isTokenRevoked(payload.jti)) return null;
    return payload;
  } catch {
    return null;
  }
}