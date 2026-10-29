-- Schéma de référence : les codes sont chiffrés, jamais stockés en clair.
CREATE TABLE IF NOT EXISTS transfer_codes (
  id bigserial PRIMARY KEY,
  owner_id integer NOT NULL REFERENCES app_user(id),
  code_hash text NOT NULL UNIQUE,
  code_ciphertext text,
  create_key text NOT NULL,
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','used','cancelled')),
  redeemed_by integer REFERENCES app_user(id),
  redeem_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, create_key)
);
CREATE INDEX IF NOT EXISTS transfer_codes_owner_idx ON transfer_codes(owner_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS transfer_codes_redeem_key_idx ON transfer_codes(redeemed_by, redeem_key) WHERE redeemed_by IS NOT NULL AND redeem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS transfer_codes_redeemer_idx ON transfer_codes(redeemed_by, created_at DESC);
CREATE TABLE IF NOT EXISTS transfer_code_attempts (
  user_id integer PRIMARY KEY REFERENCES app_user(id),
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  blocked_until timestamptz
);
CREATE TABLE IF NOT EXISTS transfer_code_audit (
  id bigserial PRIMARY KEY,
  transfer_id bigint REFERENCES transfer_codes(id),
  actor_id integer NOT NULL REFERENCES app_user(id),
  action text NOT NULL CHECK (action IN ('created','redeemed','cancelled','failed','blocked')),
  amount numeric(20,6),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE transfer_codes ADD COLUMN IF NOT EXISTS code_ciphertext text;
