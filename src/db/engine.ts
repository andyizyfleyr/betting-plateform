import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { settleMatchBets } from "@/lib/settle";
import { appUser, matches, type MatchRow } from "@/db/schema";
import { liveOddsFor } from "@/db/fixtures";

/** Blocage du marché en temps réel : 3 s après un but (anti-triche, réouverture avec cotes ajustées). */
const GOAL_SUSPEND_MS = 3000;

/** 1 minute de match réel = 20 secondes réelles → 90' ≈ 30 minutes de temps réel. */
export const MANUAL_MINUTE_REAL_MS = 20_000;

/**
 * Moteur des matchs réels (source "manual") : cycle de vie automatique.
 * - Auto-démarrage : un match « upcoming » devient live à son heure de coup d'envoi.
 * - Minute qui avance : 1 minute de match = MANUAL_MINUTE_REAL_MS de temps réel.
 * - Auto-fin : le match se termine à 90' et les paris en cours sont réglés.
 * - Recotation live : oddsHome/Draw/Away recalculés à chaque tick.
 */
export async function runLiveEngine() {
  await ensureSeeded();

  const [user] = await db
    .select({ liveSim: appUser.liveSim })
    .from(appUser)
    .where(eq(appUser.id, 1));
  if (user && !user.liveSim) return;

  const now = Date.now();

  await tickManualMatches(now);
}

/** Cycle de vie automatique des matchs réels (source "manual"). */
async function tickManualMatches(now: number) {
  const manual = await db.select().from(matches).where(eq(matches.source, "manual"));

  for (const m of manual) {
    // Auto-démarrage au coup d'envoi.
    if (m.status === "upcoming" && now >= m.startsAt.getTime()) {
      await db
        .update(matches)
        .set({ status: "live", minute: "1'", startsAt: new Date(now) })
        .where(eq(matches.id, m.id));
      m.status = "live";
      m.minute = "1'";
      m.startsAt = new Date(now);
    }

    if (m.status === "finished") continue;

    if (m.status === "live") {
      await tickLiveManualMatch(m, now);
    }
  }
}

/** Fait avancer un match réel en cours : minute, cotes, suspension, fin automatique. */
async function tickLiveManualMatch(m: MatchRow, now: number) {
  const kickoff = m.startsAt.getTime();
  const elapsedMs = Math.max(0, now - kickoff);
  const gameMinute = Math.min(90, Math.max(1, Math.floor(elapsedMs / MANUAL_MINUTE_REAL_MS) + 1));
  const isOver = gameMinute >= 90;

  const home = m.homeScore ?? 0;
  const away = m.awayScore ?? 0;

  // Suspension du marché sur les buts : blocage 3 s après le dernier but enregistré.
  const lastGoalAt = m.lastGoalAt ? m.lastGoalAt.getTime() : null;
  const recentGoal = lastGoalAt != null && now - lastGoalAt < GOAL_SUSPEND_MS;
  // Marché fermé en fin de rencontre (dernières minutes) comme en vrai temps réel.
  const suspended = recentGoal || (!isOver && gameMinute >= 88) || isOver;

  // Recotation live : même modèle que la validation serveur des paris.
  const dynamicOdds = liveOddsFor(
    m.homeTeam,
    m.awayTeam,
    home,
    away,
    gameMinute,
    {
      homeForm: m.homeForm ?? 1,
      awayForm: m.awayForm ?? 1,
      redHome: m.redHome ?? 0,
      redAway: m.redAway ?? 0,
    }
  );

  const tickHistory = [...(m.tickHistory ?? [])];
  if (dynamicOdds.oddsHome !== m.oddsHome) {
    tickHistory.push({ minute: gameMinute, market: "result", selection: "home", from: m.oddsHome, to: dynamicOdds.oddsHome });
  }
  if (dynamicOdds.oddsDraw !== m.oddsDraw && m.oddsDraw != null) {
    tickHistory.push({ minute: gameMinute, market: "result", selection: "draw", from: m.oddsDraw, to: dynamicOdds.oddsDraw });
  }
  if (dynamicOdds.oddsAway !== m.oddsAway) {
    tickHistory.push({ minute: gameMinute, market: "result", selection: "away", from: m.oddsAway, to: dynamicOdds.oddsAway });
  }

  // Recotation du marché « result » stocké (saisi par l'admin) pour que la
  // feuille de marchés, la carte et la validation serveur restent alignées.
  let markets = m.markets;
  if (markets && markets.length > 0) {
    markets = markets.map((g) => {
      if (g.key !== "result" || g.rows) return g;
      return {
        ...g,
        outcomes: g.outcomes.map((o) => {
          if (o.key === "home") return { ...o, odds: dynamicOdds.oddsHome };
          if (o.key === "draw") return { ...o, odds: dynamicOdds.oddsDraw };
          if (o.key === "away") return { ...o, odds: dynamicOdds.oddsAway };
          return o;
        }),
      };
    });
  }

  await db
    .update(matches)
    .set({
      homeScore: home,
      awayScore: away,
      minute: isOver ? "Terminé" : `${gameMinute}'`,
      status: isOver ? "finished" : "live",
      oddsHome: dynamicOdds.oddsHome,
      oddsDraw: dynamicOdds.oddsDraw,
      oddsAway: dynamicOdds.oddsAway,
      lastGoalAt: m.lastGoalAt,
      suspended,
      tickHistory,
      markets,
      ...(isOver ? { finishedAt: new Date() } : {}),
    })
    .where(eq(matches.id, m.id));

  // Auto-fin : règlement immédiat des paris en cours du match.
  if (isOver) {
    await settleMatchBets(m.id);
  }
}
