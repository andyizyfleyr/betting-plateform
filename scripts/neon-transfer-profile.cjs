#!/usr/bin/env node
// Diagnostic ponctuel : agrégats uniquement, aucune donnée utilisateur ni URL.
const SQL = `WITH sample AS (
  (SELECT * FROM matches WHERE status <> 'finished'
   ORDER BY CASE status WHEN 'live' THEN 0 ELSE 1 END, starts_at, id DESC LIMIT 120)
  UNION ALL
  (SELECT * FROM matches WHERE status = 'finished' AND source = 'manual'
   ORDER BY finished_at DESC NULLS LAST, id DESC LIMIT 20)
  UNION ALL
  (SELECT * FROM matches WHERE status = 'finished' AND source <> 'manual'
   ORDER BY finished_at DESC NULLS LAST, id DESC LIMIT 12)
)
SELECT CASE WHEN status = 'finished' THEN 'finished' ELSE 'active' END AS category,
       count(*)::int AS rows,
       coalesce(sum(pg_column_size(markets)), 0)::bigint AS markets_bytes,
       coalesce(sum(pg_column_size(scripted_events)), 0)::bigint AS scripted_events_bytes,
       coalesce(sum(pg_column_size(tick_history)), 0)::bigint AS tick_history_bytes,
       coalesce(sum(pg_column_size(events)), 0)::bigint AS events_bytes,
       coalesce(sum(pg_column_size(real_stats)), 0)::bigint AS real_stats_bytes
FROM sample GROUP BY 1 ORDER BY 1`;

async function main() {
  const mode = process.env.NEON_TRANSFER_PROFILE;
  if (!mode) return;
  if (mode !== 'sample-v1' || process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production' || !process.env.DATABASE_URL) {
    throw new Error('configuration invalide');
  }
  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const result = await client.query(SQL);
    await client.query('ROLLBACK');
    for (const row of result.rows) {
      if (!['active', 'finished'].includes(row.category) || !Number.isInteger(row.rows) || row.rows < 0 || row.rows > 152) throw new Error('résultat invalide');
      const fields = ['markets_bytes', 'scripted_events_bytes', 'tick_history_bytes', 'events_bytes', 'real_stats_bytes'];
      if (fields.some(k => !/^\d{1,16}$/.test(String(row[k])))) throw new Error('résultat invalide');
      console.log(`Profil Neon ${row.category} : ${row.rows} matchs ; ${fields.map(k => `${k}=${row[k]}`).join(' ')} octets stockés estimés.`);
    }
  } finally { await client.end().catch(() => {}); }
}
if (require.main === module) main().catch(() => { console.error('Profil Neon indisponible ; aucune donnée ni configuration affichée.'); process.exitCode = 1; });
module.exports = { SQL, main };
