-- À exécuter uniquement sur la base secondaire explicitement identifiée, jamais sur Bet2.
-- Cache public éphémère : aucune donnée financière ou privée.
CREATE TABLE IF NOT EXISTS public.pulse_public_history_cache (
  cache_key text PRIMARY KEY CHECK (cache_key = 'history-v1'),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);
