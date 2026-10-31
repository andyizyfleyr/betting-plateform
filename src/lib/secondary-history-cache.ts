import { Pool } from "pg";
import type { ClientMatchHistoryItem } from "@/lib/api";

// Cache public facultatif : jamais une source de vérité pour les paris ou les soldes.
const TTL_MS = 10_000;
const MAX_BYTES = 512 * 1024;
type Page = { items: ClientMatchHistoryItem[]; serverTime: string };
let pool: Pool | null | undefined;

function endpoint(value: string): string | null {
  try {
    const u = new URL(value);
    if (!["postgres:", "postgresql:"].includes(u.protocol) || !u.hostname.endsWith(".neon.tech") || !["require", "verify-ca", "verify-full"].includes(u.searchParams.get("sslmode") ?? "")) return null;
    const id = u.hostname.split(".")[0].replace(/-pooler$/, "");
    return /^ep-[a-z0-9-]+$/.test(id) ? id : null;
  } catch { return null; }
}
function getPool(): Pool | null {
  if (pool !== undefined) return pool;
  const env = process.env;
  if (env.SECONDARY_HISTORY_CACHE_ENABLED !== "true" || env.VERCEL_ENV !== "production") return pool = null;
  const url = env.SECONDARY_HISTORY_URL?.trim();
  const target = url && endpoint(url);
  const sources = Object.entries(env).filter(([key]) => key !== "SECONDARY_HISTORY_URL" && (key === "DATABASE_URL_UNPOOLED" || key.endsWith("DATABASE_URL") || key.endsWith("POSTGRES_URL") || key.endsWith("POSTGRES_PRISMA_URL") || key === "POSTGRES_URL_NON_POOLING"));
  // Refuse toute ambiguïté : l'URL principale et tous les candidats configurés doivent
  // être des URL Neon distinctes de la cible. Pas de repli vers une base financière.
  if (!url || !target || !env.DATABASE_URL || sources.some(([, value]) => value?.trim() && (!endpoint(value.trim()) || endpoint(value.trim()) === target))) return pool = null;
  pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 1000, idleTimeoutMillis: 10000, query_timeout: 1500, allowExitOnIdle: true });
  pool.on("error", () => {});
  return pool;
}
function validPage(value: unknown): value is Page {
  if (!value || typeof value !== "object") return false;
  const page = value as Page;
  if (typeof page.serverTime !== "string" || !Number.isFinite(Date.parse(page.serverTime)) || !Array.isArray(page.items) || page.items.length > 240) return false;
  return page.items.every((m) => m && Number.isSafeInteger(m.id) && m.id > 0 && m.status === "finished" && typeof m.homeTeam === "string" && typeof m.awayTeam === "string");
}
export async function readSecondaryHistory(): Promise<Page | null> {
  const db = getPool();
  if (!db) return null;
  try {
    const result = await db.query("SELECT payload FROM public.pulse_public_history_cache WHERE cache_key = 'history-v1' AND updated_at > clock_timestamp() - interval '10 seconds' AND updated_at <= clock_timestamp()");
    const page: unknown = result.rows[0]?.payload;
    return validPage(page) && Buffer.byteLength(JSON.stringify(page)) <= MAX_BYTES ? page : null;
  } catch { return null; }
}
export async function writeSecondaryHistory(page: Page): Promise<void> {
  const db = getPool();
  if (!db || !validPage(page)) return;
  try {
    const json = JSON.stringify(page);
    if (Buffer.byteLength(json) > MAX_BYTES || Date.now() - Date.parse(page.serverTime) > TTL_MS) return;
    // Ne jamais écraser une réponse plus récente arrivée d'une autre instance.
    await db.query(`INSERT INTO public.pulse_public_history_cache (cache_key, payload, updated_at)
      VALUES ('history-v1', $1::jsonb, $2::timestamptz)
      ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
      WHERE pulse_public_history_cache.updated_at < EXCLUDED.updated_at`, [json, page.serverTime]);
  } catch { /* Repli Neon central. */ }
}
