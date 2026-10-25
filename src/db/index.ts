import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

function getDb(): typeof db {
  if (!globalForDb.__arenaNextJsPostgresqlPool) {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 20_000,
    });
    // Empêche la fermeture d'une connexion inactive (ex. auto-suspend Neon après 5 min)
    // de lever un événement `error` non intercepté qui tue l'instance serverless Node.
    pool.on("error", (err) => {
      console.error("[db pool idle client error]", err.message);
    });
    globalForDb.__arenaNextJsPostgresqlPool = pool;
  }
  return drizzle(globalForDb.__arenaNextJsPostgresqlPool);
}

type Db = ReturnType<typeof drizzle>;

let dbInstance: Db | undefined;

export const db = new Proxy({} as Db, {
  get(_target, prop) {
    if (!dbInstance) {
      dbInstance = getDb();
    }
    const value = (dbInstance as any)[prop];
    return typeof value === "function" ? value.bind(dbInstance) : value;
  },
});
