#!/usr/bin/env node
// Diagnostic lecture seule de la base Prisma Postgres cible.
// N'affiche jamais l'URL ni le mot de passe.
const { Client } = require("pg");
const { config } = require("dotenv");

config({ path: ".env.local" });

async function main() {
  const url = (process.env.DIRECT_URL || process.env.DATABASE_URL || "").trim();
  if (!url) throw new Error("DIRECT_URL ou DATABASE_URL requis");
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 10_000,
    query_timeout: 10_000,
  });
  try {
    await client.connect();
    const info = await client.query(`
      SELECT current_database() AS database,
             current_user AS "user",
             current_setting('server_version') AS version,
             (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS tables
    `);
    const marker = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'admin_settings'
      ) AS has_admin_settings
    `);
    let seedMarker = null;
    if (marker.rows[0]?.has_admin_settings) {
      const result = await client.query(
        `SELECT value FROM admin_settings WHERE setting_key LIKE 'schema_seed_v%' ORDER BY setting_key DESC LIMIT 1`
      );
      seedMarker = result.rows[0]?.value ?? null;
    }
    console.log(JSON.stringify({ ...info.rows[0], seedMarker }, null, 2));
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("CHECK_FAILED:", err.message);
  process.exitCode = 1;
});
