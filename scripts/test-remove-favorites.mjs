import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('src/db/seed.ts', 'utf8');
assert.match(source, /SCHEMA_SEED_MARKER_KEY = "schema_seed_v20"/);
const migration = source.match(/sql`(DROP TABLE IF EXISTS "favorite_teams")`/);
assert(migration, 'Migration de suppression introuvable');
assert(!/CASCADE/i.test(migration[1]));
const db = new PGlite();
await db.exec(`
  CREATE TABLE favorite_teams (user_id integer, team_name text);
  CREATE TABLE unrelated_data (value text);
  INSERT INTO favorite_teams VALUES (1, 'Test club');
  INSERT INTO unrelated_data VALUES ('preserved');
`);
await db.exec(migration[1]);
await db.exec(migration[1]); // L'opération doit aussi fonctionner sur une base neuve ou déjà migrée.
const result = await db.query("SELECT to_regclass('public.favorite_teams') AS table_name");
assert.equal(result.rows[0].table_name, null);
const other = await db.query('SELECT value FROM unrelated_data');
assert.equal(other.rows[0].value, 'preserved');
// Si une dépendance existe, la suppression échoue sans effacer d'autres données ni marquer la migration comme réussie.
await db.exec(`CREATE TABLE favorite_teams (user_id integer); CREATE VIEW favorite_view AS SELECT * FROM favorite_teams;
  CREATE TABLE admin_settings (setting_key text primary key);`);
await assert.rejects(db.transaction(async tx => {
  await tx.exec(migration[1]);
  await tx.exec("INSERT INTO admin_settings VALUES ('schema_seed_v20')");
}));
const marker = await db.query("SELECT count(*)::int AS n FROM admin_settings WHERE setting_key='schema_seed_v20'");
assert.equal(marker.rows[0].n, 0);
assert.notEqual((await db.query("SELECT to_regclass('public.favorite_teams') AS name")).rows[0].name, null);
await db.close();
console.log('Suppression des favoris : idempotence et conservation des autres données OK');
