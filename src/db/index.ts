import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

type Db = ReturnType<typeof drizzle>;

export interface CandidateDbEnv {
  envName: string;
  url: string;
  usesPooler: boolean;
}

/**
 * Taille stricte du pool TCP `pg` par instance Vercel Serverless (1 à 2 connexions max).
 * Évite toute saturation des connexions PostgreSQL lors des pics de concurrence multi-instances,
 * tout en s'appuyant sur le pooler côté hébergeur (Prisma Postgres / PgBouncer).
 */
const parsedPoolMax = Number(process.env.PG_POOL_MAX ?? "2");
export const PG_SERVERLESS_POOL_MAX =
  Number.isInteger(parsedPoolMax) && parsedPoolMax >= 1 && parsedPoolMax <= 2
    ? parsedPoolMax
    : 2;

export function isPooledDatabaseUrl(connectionString: string): boolean {
  try {
    const u = new URL(connectionString);
    return (
      /-pooler\./i.test(u.hostname) ||
      /\.pooler\./i.test(u.hostname) ||
      /^pooled\./i.test(u.hostname) ||
      u.searchParams.get("pgbouncer") === "true"
    );
  } catch {
    return /-pooler\.|\.pooler\.|^pooled\.|pgbouncer=true/i.test(connectionString);
  }
}

/**
 * Source de vérité unique : `DATABASE_URL` (URL poolée Prisma Postgres).
 * Aucune découverte automatique d'autres variables : évite toute bascule silencieuse
 * vers une ancienne base (Neon) après le cutover.
 */
export function getDatabaseUrl(): string | null {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw || !/^postgres(?:ql)?:\/\//i.test(raw)) return null;
  return raw;
}

export function getCandidateDatabaseUrls(): CandidateDbEnv[] {
  const url = getDatabaseUrl();
  return url
    ? [{ envName: "DATABASE_URL", url, usesPooler: isPooledDatabaseUrl(url) }]
    : [];
}

function createPoolForUrl(connectionString: string): Pool {
  const needsPermissiveSsl =
    /supabase\.co|pooler\.supabase\.com/i.test(connectionString) &&
    !/uselibpqcompat=true/i.test(connectionString);

  const pool = new Pool({
    connectionString,
    max: PG_SERVERLESS_POOL_MAX,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 15_000,
    allowExitOnIdle: true,
    ...(needsPermissiveSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  // Empêche la fermeture d'une connexion inactive de lever un événement `error`
  // non intercepté qui tue l'instance serverless Node.
  pool.on("error", (err) => {
    console.error("[db pool idle client error]", err.message);
  });

  return pool;
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsPostgresqlActiveUrl?: string;
  __arenaNextJsPostgresqlActiveEnv?: string;
  __arenaNextJsPostgresqlVerified?: boolean;
};

let dbInstance: Db | undefined;

function getDb(): Db {
  if (!globalForDb.__arenaNextJsPostgresqlPool) {
    const candidates = getCandidateDatabaseUrls();
    if (candidates.length === 0) {
      throw new Error("DATABASE_URL is required");
    }
    const primary = candidates[0];
    globalForDb.__arenaNextJsPostgresqlPool = createPoolForUrl(primary.url);
    globalForDb.__arenaNextJsPostgresqlActiveUrl = primary.url;
    globalForDb.__arenaNextJsPostgresqlActiveEnv = primary.envName;
  }
  return drizzle(globalForDb.__arenaNextJsPostgresqlPool);
}

export function getActiveDbPoolInfo(): {
  activeEnvKey: string | null;
  usesPooler: boolean;
  poolMax: number;
} {
  const candidates = getCandidateDatabaseUrls();
  const activeUrl =
    globalForDb.__arenaNextJsPostgresqlActiveUrl ?? candidates[0]?.url ?? "";
  const activeEnvKey =
    globalForDb.__arenaNextJsPostgresqlActiveEnv ??
    candidates[0]?.envName ??
    null;
  return {
    activeEnvKey,
    usesPooler: activeUrl ? isPooledDatabaseUrl(activeUrl) : false,
    poolMax: PG_SERVERLESS_POOL_MAX,
  };
}

/**
 * Vérifie la connexion PostgreSQL active. Aucun repli automatique : une URL absente
 * ou injoignable doit échouer explicitement plutôt que d'écrire dans une autre base.
 */
export async function ensureHealthyDbConnection(): Promise<void> {
  if (!globalForDb.__arenaNextJsPostgresqlPool) {
    dbInstance = getDb();
  }

  if (globalForDb.__arenaNextJsPostgresqlVerified) {
    return;
  }

  await globalForDb.__arenaNextJsPostgresqlPool!.query("SELECT 1");
  globalForDb.__arenaNextJsPostgresqlVerified = true;
}

export const db = new Proxy({} as Db, {
  get(_target, prop) {
    if (!dbInstance) {
      dbInstance = getDb();
    }
    const value = (dbInstance as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(dbInstance) : value;
  },
});
