-- À exécuter hors transaction pendant une fenêtre surveillée.
-- CONCURRENTLY limite les blocages d'écriture ; vérifier les index invalides en cas d'interruption.
CREATE INDEX CONCURRENTLY IF NOT EXISTS bets_user_history_cursor_idx
  ON bets (user_id, (COALESCE(settled_at, placed_at)) DESC, placed_at DESC, id DESC)
  WHERE status <> 'pending';
CREATE INDEX CONCURRENTLY IF NOT EXISTS prediction_bets_user_history_cursor_idx
  ON prediction_bets (user_id, (COALESCE(settled_at, placed_at)) DESC, placed_at DESC, id DESC)
  WHERE status <> 'pending';
CREATE INDEX CONCURRENTLY IF NOT EXISTS combo_bets_user_history_cursor_idx
  ON combo_bets (user_id, (COALESCE(settled_at, placed_at)) DESC, placed_at DESC, id DESC)
  WHERE status <> 'pending';
