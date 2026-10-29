import { sql } from "drizzle-orm";
import { waitUntil } from "@vercel/functions";
import { db } from "@/db";

/** Les événements sont dédoublonnés par appareil et par événement, jamais par l'état en mémoire. */
export async function enqueueRecentPushEvents(): Promise<void> {
  await db.execute(sql`
    INSERT INTO push_outbox (token, event_key, title, body, data)
    SELECT events.token, events.event_key, events.title, events.body, events.data FROM (
      SELECT d.token, 'bet:sport:' || b.id || ':' || b.status AS event_key,
        'Résultat de votre pari' AS title, 'Votre pari sportif a été réglé.' AS body,
        jsonb_build_object('path', '/paris/simple/sport-' || b.id) AS data
      FROM push_devices d JOIN app_user u ON u.id=d.user_id AND u.notifications=true
      JOIN bets b ON b.user_id=d.user_id AND b.status IN ('won','lost','void')
      WHERE b.settled_at >= GREATEST(d.created_at, now() - interval '1 day')
      UNION ALL
      SELECT d.token, 'bet:prediction:' || b.id || ':' || b.status,
        'Résultat de votre pari', 'Votre pronostic a été réglé.', jsonb_build_object('path', '/paris/simple/pred-' || b.id)
      FROM push_devices d JOIN app_user u ON u.id=d.user_id AND u.notifications=true
      JOIN prediction_bets b ON b.user_id=d.user_id AND b.status IN ('won','lost','void')
      WHERE b.settled_at >= GREATEST(d.created_at, now() - interval '1 day')
      UNION ALL
      SELECT d.token, 'bet:combo:' || b.id || ':' || b.status,
        'Résultat de votre combiné', 'Votre combiné a été réglé.', jsonb_build_object('path', '/paris/combine/' || b.id)
      FROM push_devices d JOIN app_user u ON u.id=d.user_id AND u.notifications=true
      JOIN combo_bets b ON b.user_id=d.user_id AND b.status IN ('won','lost','void')
      WHERE b.settled_at >= GREATEST(d.created_at, now() - interval '1 day')
      UNION ALL
      SELECT d.token, 'deposit:' || p.id || ':credited', 'Dépôt confirmé',
        'Votre dépôt a été confirmé.', jsonb_build_object('path', '/parametres/transactions')
      FROM push_devices d JOIN app_user u ON u.id=d.user_id AND u.notifications=true
      JOIN deposits p ON p.user_id=d.user_id AND p.status='credited'
      WHERE p.updated_at >= GREATEST(d.created_at, now() - interval '1 day')
      UNION ALL
      SELECT d.token, 'withdrawal:user:' || w.id || ':' || w.status, 'Suivi de votre retrait',
        CASE WHEN w.status='approved' THEN 'Votre retrait a été approuvé.'
             WHEN w.status='rejected' THEN 'Votre retrait a été refusé et remboursé.'
             ELSE 'Votre retrait a été annulé et remboursé.' END,
        jsonb_build_object('path', '/parametres/transactions')
      FROM push_devices d JOIN app_user u ON u.id=d.user_id AND u.notifications=true
      JOIN withdrawals w ON w.user_id=d.user_id AND w.status IN ('approved','rejected','cancelled')
      WHERE w.processed_at >= GREATEST(d.created_at, now() - interval '1 day')
      UNION ALL
      SELECT d.token, 'match:start:' || m.id, 'Match commencé',
        m.home_team || ' – ' || m.away_team, jsonb_build_object('path', '/matchs/' || m.id)
      FROM push_devices d JOIN app_user u ON u.id=d.user_id AND u.notifications=true
      JOIN favorite_teams f ON f.user_id=d.user_id
      JOIN matches m ON (m.home_team=f.team_name OR m.away_team=f.team_name) AND m.status='live'
      WHERE m.starts_at >= GREATEST(d.created_at, now() - interval '1 day')
      UNION ALL
      SELECT d.token, 'match:goal:' || m.id || ':' || COALESCE(m.home_score,0) || ':' || COALESCE(m.away_score,0),
        'But dans un match favori', m.home_team || ' ' || COALESCE(m.home_score,0) || ' – ' || COALESCE(m.away_score,0) || ' ' || m.away_team,
        jsonb_build_object('path', '/matchs/' || m.id)
      FROM push_devices d JOIN app_user u ON u.id=d.user_id AND u.notifications=true
      JOIN favorite_teams f ON f.user_id=d.user_id
      JOIN matches m ON (m.home_team=f.team_name OR m.away_team=f.team_name) AND m.status='live'
      WHERE m.last_goal_at >= GREATEST(d.created_at, now() - interval '1 day')
      UNION ALL
      SELECT d.token, 'match:start:' || m.id, 'Match commencé', m.home_team || ' – ' || m.away_team, jsonb_build_object('path', '/matchs/' || m.id)
      FROM push_devices d JOIN app_user u ON u.id=d.user_id AND u.notifications=true
      JOIN bets b ON b.user_id=d.user_id AND b.status='pending'
      JOIN matches m ON m.id=b.match_id AND m.status='live'
      WHERE m.starts_at >= GREATEST(d.created_at, now() - interval '1 day')
      UNION ALL
      SELECT d.token, 'match:goal:' || m.id || ':' || COALESCE(m.home_score,0) || ':' || COALESCE(m.away_score,0),
        'But dans votre match', m.home_team || ' ' || COALESCE(m.home_score,0) || ' – ' || COALESCE(m.away_score,0) || ' ' || m.away_team,
        jsonb_build_object('path', '/matchs/' || m.id)
      FROM push_devices d JOIN app_user u ON u.id=d.user_id AND u.notifications=true
      JOIN bets b ON b.user_id=d.user_id AND b.status='pending'
      JOIN matches m ON m.id=b.match_id AND m.status='live'
      WHERE m.last_goal_at >= GREATEST(d.created_at, now() - interval '1 day')
      UNION ALL
      SELECT d.token, 'match:start:' || m.id, 'Match commencé', m.home_team || ' – ' || m.away_team, jsonb_build_object('path', '/matchs/' || m.id)
      FROM push_devices d JOIN app_user u ON u.id=d.user_id AND u.notifications=true
      JOIN combo_bets cb ON cb.user_id=d.user_id AND cb.status='pending'
      JOIN LATERAL jsonb_array_elements(cb.legs) leg ON leg->>'kind'='sport'
      JOIN matches m ON (leg->>'matchId') ~ '^[0-9]+$' AND m.id=(leg->>'matchId')::integer AND m.status='live'
      WHERE m.starts_at >= GREATEST(d.created_at, now() - interval '1 day')
      UNION ALL
      SELECT d.token, 'match:goal:' || m.id || ':' || COALESCE(m.home_score,0) || ':' || COALESCE(m.away_score,0),
        'But dans votre match', m.home_team || ' ' || COALESCE(m.home_score,0) || ' – ' || COALESCE(m.away_score,0) || ' ' || m.away_team,
        jsonb_build_object('path', '/matchs/' || m.id)
      FROM push_devices d JOIN app_user u ON u.id=d.user_id AND u.notifications=true
      JOIN combo_bets cb ON cb.user_id=d.user_id AND cb.status='pending'
      JOIN LATERAL jsonb_array_elements(cb.legs) leg ON leg->>'kind'='sport'
      JOIN matches m ON (leg->>'matchId') ~ '^[0-9]+$' AND m.id=(leg->>'matchId')::integer AND m.status='live'
      WHERE m.last_goal_at >= GREATEST(d.created_at, now() - interval '1 day')
      UNION ALL
      SELECT d.token, 'dispute:admin:' || x.id, 'Nouvelle réclamation',
        'Une réclamation attend votre attention.', jsonb_build_object('path', '/admin')
      FROM push_devices d JOIN app_user u ON u.id=d.user_id AND u.role='admin' AND u.notifications=true
      JOIN bet_disputes x ON x.created_at >= GREATEST(d.created_at, now() - interval '1 day')
      UNION ALL
      SELECT d.token, 'dispute:reply:' || x.id || ':' || x.status || ':' || EXTRACT(EPOCH FROM x.updated_at),
        'Réponse à votre réclamation', 'Votre réclamation a été mise à jour.',
        jsonb_build_object('path', CASE WHEN x.bet_kind='combo' THEN '/paris/combine/' || x.bet_id ELSE '/paris/simple/' || CASE WHEN x.bet_kind='prediction' THEN 'pred-' ELSE 'sport-' END || x.bet_id END)
      FROM push_devices d JOIN app_user u ON u.id=d.user_id AND u.notifications=true
      JOIN bet_disputes x ON x.user_id=d.user_id AND x.status IN ('in_review','resolved')
      WHERE x.updated_at >= GREATEST(d.created_at, now() - interval '1 day')
      UNION ALL
      SELECT d.token, 'withdrawal:admin:' || w.id, 'Nouvelle demande de retrait', 'Une demande de retrait attend votre attention.', jsonb_build_object('path', '/admin')
      FROM push_devices d JOIN app_user u ON u.id=d.user_id AND u.role='admin' AND u.notifications=true
      JOIN withdrawals w ON w.status='pending' AND w.created_at >= GREATEST(d.created_at, now() - interval '1 day')
      UNION ALL
      SELECT d.token, 'deposit:admin:' || p.id, 'Nouveau dépôt', 'Un dépôt demande votre attention.', jsonb_build_object('path', '/admin')
      FROM push_devices d JOIN app_user u ON u.id=d.user_id AND u.role='admin' AND u.notifications=true
      JOIN deposits p ON p.status IN ('pending','pending_review') AND p.created_at >= GREATEST(d.created_at, now() - interval '1 day')
    ) events JOIN push_devices device ON device.token=events.token
    JOIN app_user preferences ON preferences.id=device.user_id
    WHERE CASE
      WHEN events.event_key LIKE 'match:%' THEN preferences.notify_matches
      WHEN events.event_key LIKE 'bet:%' THEN preferences.notify_bets
      WHEN events.event_key LIKE 'deposit:%' OR events.event_key LIKE 'withdrawal:%' THEN preferences.notify_payments
      WHEN events.event_key LIKE 'dispute:%' THEN preferences.notify_disputes
      ELSE true END
    AND NOT EXISTS (
      SELECT 1 FROM push_outbox existing WHERE existing.token=events.token AND existing.event_key=events.event_key
    ) LIMIT 1000 ON CONFLICT (token, event_key) DO NOTHING
  `);
}

type PushRow = { id: number; token: string; title: string; body: string; data: Record<string, unknown> };
export async function flushPushNotifications(): Promise<void> {
  await enqueueRecentPushEvents();
  const claim = await db.execute(sql`
    WITH chosen AS (
      SELECT o.id FROM push_outbox o JOIN push_devices d ON d.token=o.token
      JOIN app_user u ON u.id=d.user_id AND u.notifications=true
      WHERE CASE
        WHEN o.event_key LIKE 'match:%' THEN u.notify_matches
        WHEN o.event_key LIKE 'bet:%' THEN u.notify_bets
        WHEN o.event_key LIKE 'deposit:%' OR o.event_key LIKE 'withdrawal:%' THEN u.notify_payments
        WHEN o.event_key LIKE 'dispute:%' THEN u.notify_disputes
        ELSE true END
      AND o.sent_at IS NULL AND o.attempts < 5 AND (o.claimed_until IS NULL OR o.claimed_until < now())
      ORDER BY o.id LIMIT 100 FOR UPDATE OF o SKIP LOCKED
    ) UPDATE push_outbox o SET claimed_until=now() + interval '2 minutes', attempts=o.attempts+1
      FROM chosen WHERE o.id=chosen.id RETURNING o.id, o.token, o.title, o.body, o.data
  `);
  const rows = claim.rows as unknown as PushRow[];
  if (!rows.length) return;
  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(rows.map((r) => ({ to: r.token, title: r.title, body: r.body, data: r.data, sound: "default", channelId: "default" }))),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Expo push HTTP ${response.status}`);
    const result = await response.json() as { data?: Array<{ status: string; details?: { error?: string } }> };
    if (!Array.isArray(result.data) || result.data.length !== rows.length) throw new Error("Réponse Expo incomplète");
    const accepted: number[] = [];
    const retry: number[] = [];
    const invalid: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i], receipt = result.data[i];
      if (receipt.status === "ok") accepted.push(row.id);
      else if (receipt.details?.error === "DeviceNotRegistered") invalid.push(row.token);
      else retry.push(row.id);
    }
    if (accepted.length) await db.execute(sql`UPDATE push_outbox SET sent_at=now(), claimed_until=NULL WHERE id IN (${sql.join(accepted.map((id) => sql`${id}`), sql`, `)})`);
    if (invalid.length) await db.execute(sql`DELETE FROM push_devices WHERE token IN (${sql.join(invalid.map((token) => sql`${token}`), sql`, `)})`);
    if (retry.length) await db.execute(sql`UPDATE push_outbox SET claimed_until=NULL WHERE id IN (${sql.join(retry.map((id) => sql`${id}`), sql`, `)})`);

  } catch (e) {
    console.error("[push] échec envoi", e);
    // Les claims expirent et seront réessayés par la prochaine exécution.
  }
}

let lastScheduledAt = 0;
/** Déclenche l'envoi en arrière-plan sans retarder les transactions de paris. */
export function schedulePushNotifications(): void {
  if (Date.now() - lastScheduledAt < 30_000) return;
  lastScheduledAt = Date.now();
  const task = flushPushNotifications().catch((e) => console.error("[push] arrière-plan", e));
  try { waitUntil(task); } catch { void task; }
}
