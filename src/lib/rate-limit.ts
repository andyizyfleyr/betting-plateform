import type { NextRequest } from "next/server";

const buckets = new Map<string, number[]>();

export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "local";
}

/**
 * Limiteur de débit par fenêtre glissante (anti-bruteforce login & anti-farming inscription).
 */
export function checkRateLimit(
  key: string,
  maxHits: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const prev = buckets.get(key) ?? [];
  const recent = prev.filter((ts) => ts > cutoff);

  if (recent.length >= maxHits) {
    buckets.set(key, recent);
    const oldest = recent[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }

  recent.push(now);
  buckets.set(key, recent);

  // Nettoyage léger périodique
  if (buckets.size > 500) {
    for (const [k, arr] of buckets.entries()) {
      if (arr.every((ts) => ts <= cutoff)) buckets.delete(k);
    }
  }

  return { allowed: true, retryAfterSec: 0 };
}
