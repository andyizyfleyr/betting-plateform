import { waitUntil } from "@vercel/functions";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminSettings } from "@/db/schema";

/**
 * Fenêtre pendant laquelle la présence d'au moins 1 visiteur actif met le Cron en attente :
 * tant qu'un visiteur est sur le site, ses propres requêtes (toutes les 5 à 15 s) font déjà
 * tourner la synchronisation et les règlements en temps réel. Le Cron ne démarre donc que
 * lorsque le site est à 0 visiteur depuis au moins 3 minutes.
 */
export const VISITOR_ACTIVE_WINDOW_MS = 3 * 60_000;

/**
 * Fréquence maximale d'écriture du battement de cœur inter-instances dans `admin_settings`
 * pendant que des visiteurs naviguent (1 ligne minuscule toutes les 90 s max, uniquement
 * quand Neon est déjà réveillée par un visiteur).
 */
const HEARTBEAT_PERSIST_INTERVAL_MS = 90_000;
const HEARTBEAT_KEY = "visitor_heartbeat";

interface VisitorActivityMemory {
  lastVisitorSeenMs: number;
  lastPersistedMs: number;
  persistInFlight: boolean;
}

const globalVisitor = globalThis as typeof globalThis & {
  __pulseVisitorActivityV1?: VisitorActivityMemory;
};

function getVisitorStore(): VisitorActivityMemory {
  if (!globalVisitor.__pulseVisitorActivityV1) {
    globalVisitor.__pulseVisitorActivityV1 = {
      lastVisitorSeenMs: 0,
      lastPersistedMs: 0,
      persistInFlight: false,
    };
  }
  return globalVisitor.__pulseVisitorActivityV1;
}

/**
 * Appelé par les routes visiteurs (jamais par `/api/cron/tick`).
 * Met à jour instantanément l'horodatage RAM (0 ms) et, au plus une fois toutes les 90 s,
 * persiste de façon non-bloquante l'empreinte inter-instances Serverless.
 */
export function recordVisitorActivity(nowMs = Date.now()): void {
  const st = getVisitorStore();
  st.lastVisitorSeenMs = nowMs;

  if (
    st.persistInFlight ||
    nowMs - st.lastPersistedMs < HEARTBEAT_PERSIST_INTERVAL_MS
  ) {
    return;
  }

  st.persistInFlight = true;
  st.lastPersistedMs = nowMs;
  const nowDate = new Date(nowMs);

  const task = db
    .insert(adminSettings)
    .values({
      settingKey: HEARTBEAT_KEY,
      value: { ts: nowMs },
      updatedAt: nowDate,
    })
    .onConflictDoUpdate({
      target: adminSettings.settingKey,
      set: {
        value: { ts: nowMs },
        updatedAt: nowDate,
      },
    })
    .catch(() => {
      /* non bloquant si la table n'est pas encore initialisée au tout 1er démarrage */
    })
    .finally(() => {
      st.persistInFlight = false;
    });

  try {
    waitUntil(task);
  } catch {
    void task;
  }
}

/**
 * Vérifie si au moins un visiteur est présent sur le site (< 3 min) :
 *  1) Court-circuit 0-SQL en RAM (< 0,1 ms, zéro réveil Neon) si l'instance chaude a vu un visiteur.
 *  2) Sinon, lecture clé primaire d'une seule ligne (`visitor_heartbeat`) pour couvrir le cas
 *     où Vercel a routé l'appel Cron sur une autre instance Serverless que celle des visiteurs.
 */
export async function checkActiveVisitorsForCron(nowMs = Date.now()): Promise<{
  hasActiveVisitors: boolean;
  lastVisitorAgoSec: number | null;
  detectedVia: "ram" | "db" | "none";
}> {
  const st = getVisitorStore();

  if (
    st.lastVisitorSeenMs > 0 &&
    nowMs - st.lastVisitorSeenMs < VISITOR_ACTIVE_WINDOW_MS
  ) {
    return {
      hasActiveVisitors: true,
      lastVisitorAgoSec: Math.max(0, Math.round((nowMs - st.lastVisitorSeenMs) / 1_000)),
      detectedVia: "ram",
    };
  }

  try {
    const [row] = await db
      .select({ updatedAt: adminSettings.updatedAt, value: adminSettings.value })
      .from(adminSettings)
      .where(eq(adminSettings.settingKey, HEARTBEAT_KEY))
      .limit(1);

    const rawTs = (row?.value as { ts?: unknown } | undefined)?.ts;
    const dbSeenMs =
      typeof rawTs === "number" && Number.isFinite(rawTs)
        ? rawTs
        : row?.updatedAt
          ? new Date(row.updatedAt).getTime()
          : 0;

    if (dbSeenMs > 0) {
      if (dbSeenMs > st.lastVisitorSeenMs) {
        st.lastVisitorSeenMs = dbSeenMs;
      }
      const ageMs = nowMs - dbSeenMs;
      if (ageMs < VISITOR_ACTIVE_WINDOW_MS) {
        return {
          hasActiveVisitors: true,
          lastVisitorAgoSec: Math.max(0, Math.round(ageMs / 1_000)),
          detectedVia: "db",
        };
      }
      return {
        hasActiveVisitors: false,
        lastVisitorAgoSec: Math.max(0, Math.round(ageMs / 1_000)),
        detectedVia: "none",
      };
    }
  } catch {
    /* table absente au tout premier boot : considère 0 visiteur pour laisser le cron initialiser */
  }

  return {
    hasActiveVisitors: false,
    lastVisitorAgoSec:
      st.lastVisitorSeenMs > 0
        ? Math.max(0, Math.round((nowMs - st.lastVisitorSeenMs) / 1_000))
        : null,
    detectedVia: "none",
  };
}
