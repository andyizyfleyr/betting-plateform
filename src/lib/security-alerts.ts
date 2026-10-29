import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { schedulePushNotifications } from "@/lib/push-notifications";

/** Alerte générique : aucun identifiant, adresse IP ou secret dans la notification. */
export async function recordSecurityAlert(userId: number, kind: "login" | "password_reset") {
  const eventKey = `security:${kind}:${randomUUID()}`;
  const title = kind === "login" ? "Connexion à votre compte" : "Mot de passe modifié";
  const body = kind === "login"
    ? "Une connexion à votre compte vient d'avoir lieu. Si ce n'est pas vous, sécurisez votre compte."
    : "Votre mot de passe a été réinitialisé. Si ce n'est pas vous, sécurisez votre compte.";
  try {
    await db.execute(sql`INSERT INTO push_outbox (token, event_key, title, body, data)
      SELECT d.token, ${eventKey}, ${title}, ${body}, jsonb_build_object('path', '/parametres')
      FROM push_devices d JOIN app_user u ON u.id=d.user_id
      WHERE d.user_id=${userId} AND u.notifications=true
      ON CONFLICT (token, event_key) DO NOTHING`);
    schedulePushNotifications();
  } catch (error) {
    // Une panne d'alerte ne doit jamais empêcher la connexion ou la réinitialisation.
    console.error("[security] alerte non enregistrée", error);
  }
}
