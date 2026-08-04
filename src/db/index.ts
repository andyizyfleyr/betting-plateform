import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

function getDb(): typeof db {
  if (!globalForDb.__arenaNextJsPostgresqlPool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    globalForDb.__arenaNextJsPostgresqlPool = new Pool({
      connectionString: databaseUrl,
    });
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
