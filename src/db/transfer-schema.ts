import { sql } from "drizzle-orm";
import { db } from "@/db";

let promise: Promise<void> | undefined;
/** Migration atomique sérialisée entre instances, indépendante des anciens marqueurs. */
export function ensureTransferSchema(): Promise<void> {
  if (!promise) promise = db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(82498712)`);
    const marker = await tx.execute(sql`SELECT 1 FROM admin_settings WHERE setting_key='transfer_codes_schema_v1'`);
    if (marker.rows.length) {
      const v2 = await tx.execute(sql`SELECT 1 FROM admin_settings WHERE setting_key='transfer_codes_schema_v2'`);
      if (!v2.rows.length) {
        await tx.execute(sql`ALTER TABLE transfer_codes ADD COLUMN IF NOT EXISTS code_ciphertext text`);
        await tx.execute(sql`INSERT INTO admin_settings (setting_key,value,updated_at) VALUES ('transfer_codes_schema_v2', '{"ready":true}'::jsonb, now()) ON CONFLICT (setting_key) DO NOTHING`);
      }
      return;
    }
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS transfer_codes (
      id bigserial PRIMARY KEY, owner_id integer NOT NULL REFERENCES app_user(id), code_hash text NOT NULL UNIQUE, code_ciphertext text,
      create_key text NOT NULL, amount numeric(20,6) NOT NULL CHECK (amount > 0),
      status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','used','cancelled')),
      redeemed_by integer REFERENCES app_user(id), redeem_key text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id, create_key))`);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS transfer_codes_owner_idx ON transfer_codes(owner_id, created_at DESC)`);
    await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS transfer_codes_redeem_key_idx ON transfer_codes(redeemed_by, redeem_key) WHERE redeemed_by IS NOT NULL AND redeem_key IS NOT NULL`);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS transfer_codes_redeemer_idx ON transfer_codes(redeemed_by, created_at DESC)`);
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS transfer_code_attempts (user_id integer PRIMARY KEY REFERENCES app_user(id), failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0), blocked_until timestamptz)`);
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS transfer_code_audit (id bigserial PRIMARY KEY, transfer_id bigint REFERENCES transfer_codes(id), actor_id integer NOT NULL REFERENCES app_user(id), action text NOT NULL CHECK (action IN ('created','redeemed','cancelled','failed','blocked')), amount numeric(20,6), created_at timestamptz NOT NULL DEFAULT now())`);
    await tx.execute(sql`ALTER TABLE transfer_codes ADD COLUMN IF NOT EXISTS code_ciphertext text`);
    await tx.execute(sql`INSERT INTO admin_settings (setting_key,value,updated_at) VALUES ('transfer_codes_schema_v2', '{"ready":true}'::jsonb, now()) ON CONFLICT (setting_key) DO NOTHING`);
    await tx.execute(sql`INSERT INTO admin_settings (setting_key,value,updated_at) VALUES ('transfer_codes_schema_v1', '{"ready":true}'::jsonb, now()) ON CONFLICT (setting_key) DO NOTHING`);
  }).catch(error => { promise = undefined; throw error; });
  return promise;
}
