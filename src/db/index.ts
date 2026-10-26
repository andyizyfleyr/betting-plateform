import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

type Db = ReturnType<typeof drizzle>;

export interface CandidateDbEnv {
  envName: string;
  url: string;
  usesPooler: boolean;
}

const PRIORITY_ENV_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "NEON_DATABASE_URL",
  "STORAGE_DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
] as const;

/**
 * Taille stricte du pool TCP `pg` par instance Vercel Serverless (1 à 2 connexions max).
 * Évite toute saturation des connexions PostgreSQL lors des pics de concurrence multi-instances,
 * tout en s'appuyant sur PgBouncer (`-pooler`) côté Neon.
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
      u.searchParams.get("pgbouncer") === "true"
    );
  } catch {
    return /-pooler\.|\.pooler\.|pgbouncer=true/i.test(connectionString);
  }
}

export function getCandidateDatabaseUrls(): CandidateDbEnv[] {
  const seen = new Set<string>();
  const rawList: CandidateDbEnv[] = [];

  const pushIfValid = (envName: string, raw: string | undefined) => {
    const val = raw?.trim();
    if (!val) return;
    if (!/^postgres(?:ql)?:\/\//i.test(val)) return;
    if (seen.has(val)) return;
    seen.add(val);
    rawList.push({
      envName,
      url: val,
      usesPooler: isPooledDatabaseUrl(val),
    });
  };

  for (const key of PRIORITY_ENV_KEYS) {
    pushIfValid(key, process.env[key]);
  }

  for (const [key, val] of Object.entries(process.env)) {
    if (
      key.endsWith("DATABASE_URL") ||
      key.endsWith("POSTGRES_URL") ||
      key.endsWith("POSTGRES_PRISMA_URL")
    ) {
      pushIfValid(key, val);
    }
  }

  // Priorise systématiquement les URL `-pooler` (PgBouncer Neon) devant les URL directes
  // afin de mutualiser les connexions TCP entre toutes les fonctions Vercel Serverless.
  const pooled = rawList.filter((c) => c.usesPooler);
  const direct = rawList.filter((c) => !c.usesPooler);
  return [...pooled, ...direct];
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

  // Empêche la fermeture d'une connexion inactive (ex. auto-suspend Neon après 5 min)
  // de lever un événement `error` non intercepté qui tue l'instance serverless Node.
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
 * Vérifie la connexion PostgreSQL active et bascule automatiquement sur une autre
 * variable PostgreSQL valide de `process.env` (`POSTGRES_URL`, `STORAGE_DATABASE_URL`, etc.)
 * si `DATABASE_URL` pointe encore vers une ancienne base supprimée ou désactivée.
 */
export async function ensureHealthyDbConnection(): Promise<void> {
  const candidates = getCandidateDatabaseUrls();
  if (candidates.length === 0) {
    throw new Error("DATABASE_URL is required");
  }

  // Initialise le pool principal s'il ne l'est pas encore
  if (!globalForDb.__arenaNextJsPostgresqlPool) {
    dbInstance = getDb();
  }

  if (globalForDb.__arenaNextJsPostgresqlVerified && candidates.length === 1) {
    return;
  }

  try {
    await globalForDb.__arenaNextJsPostgresqlPool!.query("SELECT 1");
    globalForDb.__arenaNextJsPostgresqlVerified = true;
    return;
  } catch (primaryErr) {
    globalForDb.__arenaNextJsPostgresqlVerified = false;
    if (candidates.length <= 1) {
      throw primaryErr;
    }

    // Teste les autres variables PostgreSQL présentes dans l'environnement Vercel
    for (const cand of candidates) {
      if (cand.url === globalForDb.__arenaNextJsPostgresqlActiveUrl) continue;
      const altPool = createPoolForUrl(cand.url);
      try {
        await altPool.query("SELECT 1");
        const oldPool = globalForDb.__arenaNextJsPostgresqlPool;
        globalForDb.__arenaNextJsPostgresqlPool = altPool;
        globalForDb.__arenaNextJsPostgresqlActiveUrl = cand.url;
        globalForDb.__arenaNextJsPostgresqlActiveEnv = cand.envName;
        globalForDb.__arenaNextJsPostgresqlVerified = true;
        dbInstance = drizzle(altPool);
        if (oldPool) {
          void oldPool.end().catch(() => undefined);
        }
        console.info(`[db] Bascule automatique sur ${cand.envName}`);
        return;
      } catch {
        void altPool.end().catch(() => undefined);
      }
    }

    throw primaryErr;
  }
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
