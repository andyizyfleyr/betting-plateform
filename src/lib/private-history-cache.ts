import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Cache de courte durée, distinct d'une archive durable. Aucun solde ni pari actif.
const TTL_MS = 10_000;
const MAX_BYTES = 512 * 1024;
const AAD = Buffer.from("pulsebet-private-history-cache-v1");
type HistoryPage = { bets: unknown[]; nextCursor: string | null };
type CacheConfig = { key: Buffer; bucket: string; client: S3Client };
let cachedConfig: CacheConfig | null | undefined;

function config(): CacheConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const e = process.env;
  if (e.R2_HISTORY_CACHE_ENABLED !== "true" || e.R2_ACCOUNT_ID !== "6f3e2c1a84617db0da9cb4bf594446f2" || e.R2_PRIVATE_BUCKET !== "pulsebet" || !e.R2_PRIVATE_ACCESS_KEY_ID || !e.R2_PRIVATE_SECRET_ACCESS_KEY || !/^[a-fA-F0-9]{64}$/.test(e.R2_ARCHIVE_ENCRYPTION_KEY ?? "")) return cachedConfig = null;
  return cachedConfig = {
    key: Buffer.from(e.R2_ARCHIVE_ENCRYPTION_KEY!, "hex"), bucket: e.R2_PRIVATE_BUCKET,
    client: new S3Client({ region: "auto", endpoint: `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: e.R2_PRIVATE_ACCESS_KEY_ID, secretAccessKey: e.R2_PRIVATE_SECRET_ACCESS_KEY }, maxAttempts: 1 }),
  };
}
function objectKey(key: Buffer, uid: number, cursor: string): string {
  const digest = createHmac("sha256", key).update("history-cache-v1\0").update(String(uid)).update("\0").update(cursor).digest("hex");
  return `cache/history/v1/${digest}`;
}
function isCacheable(page: HistoryPage): boolean {
  if (!Array.isArray(page.bets) || page.bets.length > 20 || (page.nextCursor !== null && typeof page.nextCursor !== "string")) return false;
  return page.bets.every((item) => {
    if (!item || typeof item !== "object") return false;
    const bet = item as { status?: unknown; matchStatus?: unknown; cashOut?: unknown; legs?: unknown };
    if (!["won", "lost", "cashed", "void"].includes(String(bet.status)) || bet.cashOut != null || bet.matchStatus === "live" || bet.matchStatus === "upcoming") return false;
    if (bet.legs !== undefined) {
      if (!Array.isArray(bet.legs)) return false;
      if (bet.legs.some((leg: { status?: unknown; matchStatus?: unknown }) => !leg || !["won", "lost", "void"].includes(String(leg.status)) || leg.matchStatus === "live" || leg.matchStatus === "upcoming")) return false;
    }
    return true;
  });
}
export async function readPrivateHistoryCache(uid: number, cursor: string): Promise<HistoryPage | null> {
  const c = config();
  if (!c) return null;
  const key = objectKey(c.key, uid, cursor);
  try {
    const res = await c.client.send(new GetObjectCommand({ Bucket: c.bucket, Key: key }), { abortSignal: AbortSignal.timeout(1500) });
    if (!res.Body || (res.ContentLength !== undefined && res.ContentLength > MAX_BYTES)) return null;
    const raw = Buffer.from(await res.Body.transformToByteArray());
    if (raw.length > MAX_BYTES || raw.length < 29 || raw[0] !== 1) return null;
    const decipher = createDecipheriv("aes-256-gcm", c.key, raw.subarray(1, 13));
    decipher.setAAD(Buffer.concat([AAD, Buffer.from(key)])); decipher.setAuthTag(raw.subarray(13, 29));
    const parsed = JSON.parse(Buffer.concat([decipher.update(raw.subarray(29)), decipher.final()]).toString("utf8"));
    if (parsed.uid !== uid || parsed.cursor !== cursor || typeof parsed.at !== "number" || parsed.at > Date.now() || Date.now() - parsed.at >= TTL_MS || !parsed.page || !isCacheable(parsed.page)) return null;
    return parsed.page;
  } catch { return null; }
}
export async function writePrivateHistoryCache(uid: number, cursor: string, page: HistoryPage): Promise<void> {
  const c = config();
  if (!c || !isCacheable(page)) return;
  try {
    const key = objectKey(c.key, uid, cursor);
    const plaintext = Buffer.from(JSON.stringify({ uid, cursor, at: Date.now(), page }));
    if (plaintext.length > MAX_BYTES - 29) return;
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", c.key, iv);
    cipher.setAAD(Buffer.concat([AAD, Buffer.from(key)]));
    const body = Buffer.concat([Buffer.from([1]), iv, cipher.update(plaintext), cipher.final()]);
    const bytes = Buffer.concat([body.subarray(0, 13), cipher.getAuthTag(), body.subarray(13)]);
    await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: key, Body: bytes, ContentType: "application/octet-stream", CacheControl: "no-store" }), { abortSignal: AbortSignal.timeout(1500) });
  } catch { /* Neon reste la source de repli. */ }
}
