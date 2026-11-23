-- Suppression des jeux casino (Tap Win + Accelerator Pro) et de toutes leurs dépendances
-- 1) tables, 2) index, 3) données en cascade via FK (le cas échéant)

DROP TABLE IF EXISTS "accelerator_rounds" CASCADE;
DROP TABLE IF EXISTS "tap_history" CASCADE;

-- Index dépendants déjà supprimés par CASCADE ; ré-affichage des clés de cette migration.
