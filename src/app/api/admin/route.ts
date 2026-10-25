import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import {
  backdateStartsAtForMinute,
  demoteOtherLiveMatches,
  forceMatchFinalScore,
  getAdminMatchForecasts,
  lockMatchScenario,
  rerollMatchScenario,
  runLiveEngine,
  setScenarioMode,
  unlockMatchScenario,
} from "@/db/engine";
import { hasVerifiedGoalTimeline, liveOddsFor, pickScorerName } from "@/db/fixtures";
import {
  appUser,
  bets,
  comboBets,
  deposits,
  matches,
  predictionBets,
  predictionQuestions,
  walletAdjustments,
  withdrawals,
  type PredictionOption,
} from "@/db/schema";
import { publicUser } from "@/lib/auth";
import { settlePendingCombos } from "@/lib/combo";
import { invalidateHouseHealthCache } from "@/lib/house-brain";
import { isKnownMarket, marketLabelFor, marketOutcomeSettled, minuteNumber } from "@/lib/markets";
import { getAdminMlOverview, retrainAllMlModels } from "@/lib/ml-engine";
import {
  reopenSettledQuestion,
  round2,
  settleQuestion,
  settleResolvedQuestions,
  slugifyOptionKey,
} from "@/lib/predictions";
import { STALE_LATENCY_MS } from "@/lib/risk";
import { getAuthUserId } from "@/lib/session";
import { settleFinishedBets, settleMatchBets } from "@/lib/settle";
import { resetSyncThrottle, syncPlatformStateThrottled } from "@/lib/sync-throttle";
import { teamLogo } from "@/lib/team-logos";

export const dynamic = "force-dynamic";

async function requireAdmin(req: NextRequest): Promise<number | NextResponse> {
  await ensureSeeded();
  const uid = await getAuthUserId(req);
  if (!uid) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const [user] = await db.select().from(appUser).where(eq(appUser.id, uid));
  if (!user || (user.role ?? "user") !== "admin") {
    return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
  }
  return uid;
}

/** Statistiques synchronisées du tableau de bord + listes de pilotage. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (typeof auth !== "number") return auth;

  // Synchronise le moteur live et les règlements pour afficher l'état exact en temps réel
  await syncPlatformStateThrottled(true);

  const [
    [totalUsers],
    [totalBets],
    [totalPredBets],
    [totalComboBets],
    [totalDeposits],
    [pendingWdCount],
    [sportTotals],
    [predTotals],
    [comboTotals],
    [liveMatch],
    [openQuestions],
    [totalBalance],
  ] = await Promise.all([
    db.select({ value: count() }).from(appUser),
    db.select({ value: count() }).from(bets),
    db.select({ value: count() }).from(predictionBets),
    db.select({ value: count() }).from(comboBets),
    db.select({ value: count() }).from(deposits),
    db.select({ value: count() }).from(withdrawals).where(eq(withdrawals.status, "pending")),
    db
      .select({
        stake: sql<number>`COALESCE(SUM(${bets.stake}), 0)::float8`,
        payouts: sql<number>`COALESCE(SUM(CASE WHEN ${bets.status} = 'won' THEN ${bets.potentialWin} WHEN ${bets.status} = 'cashed' THEN COALESCE(${bets.cashOutAmount}, 0) WHEN ${bets.status} = 'void' THEN ${bets.stake} ELSE 0 END), 0)::float8`,
      })
      .from(bets),
    db
      .select({
        stake: sql<number>`COALESCE(SUM(${predictionBets.stake}), 0)::float8`,
        payouts: sql<number>`COALESCE(SUM(CASE WHEN ${predictionBets.status} = 'won' THEN ${predictionBets.potentialWin} WHEN ${predictionBets.status} = 'cashed' THEN COALESCE(${predictionBets.cashOutAmount}, 0) WHEN ${predictionBets.status} = 'void' THEN ${predictionBets.stake} ELSE 0 END), 0)::float8`,
      })
      .from(predictionBets),
    db
      .select({
        stake: sql<number>`COALESCE(SUM(${comboBets.stake}), 0)::float8`,
        payouts: sql<number>`COALESCE(SUM(CASE WHEN ${comboBets.status} = 'won' THEN ${comboBets.potentialWin} WHEN ${comboBets.status} = 'cashed' THEN COALESCE(${comboBets.cashOutAmount}, 0) WHEN ${comboBets.status} = 'void' THEN ${comboBets.stake} ELSE 0 END), 0)::float8`,
      })
      .from(comboBets),
    db.select({ n: count() }).from(matches).where(eq(matches.status, "live")),
    db.select({ n: count() }).from(predictionQuestions).where(eq(predictionQuestions.status, "open")),
    db.select({ value: sql<number>`COALESCE(SUM(${appUser.balance}), 0)::float8` }).from(appUser),
  ]);

  const stake = round2(
    (sportTotals?.stake ?? 0) + (predTotals?.stake ?? 0) + (comboTotals?.stake ?? 0)
  );
  const payouts = round2(
    (sportTotals?.payouts ?? 0) + (predTotals?.payouts ?? 0) + (comboTotals?.payouts ?? 0)
  );

  const [
    users,
    betsRows,
    depRows,
    wdRows,
    manualMatchRows,
    virtualMatchRows,
    questionRows,
    predBetsRows,
    comboRows,
  ] = await Promise.all([
    db.select().from(appUser).orderBy(desc(appUser.id)),
    db.select().from(bets).orderBy(desc(bets.placedAt)).limit(300),
    db.select().from(deposits).orderBy(desc(deposits.createdAt)).limit(200),
    db.select().from(withdrawals).orderBy(desc(withdrawals.createdAt)).limit(200),
    db
      .select()
      .from(matches)
      .where(eq(matches.source, "manual"))
      .orderBy(
        sql`CASE ${matches.status} WHEN 'live' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END`,
        desc(matches.id)
      )
      .limit(150),
    db
      .select()
      .from(matches)
      .where(ne(matches.source, "manual"))
      .orderBy(
        sql`CASE ${matches.status} WHEN 'live' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END`,
        desc(matches.id)
      )
      .limit(100),
    db.select().from(predictionQuestions).orderBy(desc(predictionQuestions.id)).limit(200),
    db.select().from(predictionBets).orderBy(desc(predictionBets.placedAt)).limit(300),
    db.select().from(comboBets).orderBy(desc(comboBets.placedAt)).limit(200),
  ]);
  const matchRows = [...manualMatchRows, ...virtualMatchRows];

  const userNameMap = new Map(users.map((u) => [u.id, u.name]));

  const seenQ = new Set<string>();
  const uniqueQuestions = questionRows.filter((q) => {
    const k = q.question.trim().toLowerCase();
    if (seenQ.has(k)) return false;
    seenQ.add(k);
    return true;
  });

  const pendingDepCount = depRows.filter((d) => d.status === "pending_review").length;
  const [ml, scenarioInfo] = await Promise.all([
    getAdminMlOverview(),
    getAdminMatchForecasts(matchRows),
  ]);

  return NextResponse.json({
    ml,
    scenarioMode: scenarioInfo.mode,
    matchForecasts: scenarioInfo.forecasts,
    stats: {
      totalUsers: totalUsers?.value ?? 0,
      totalBets:
        (totalBets?.value ?? 0) + (totalPredBets?.value ?? 0) + (totalComboBets?.value ?? 0),
      sportsBets: totalBets?.value ?? 0,
      predBets: totalPredBets?.value ?? 0,
      comboBets: totalComboBets?.value ?? 0,
      deposits: Number(totalDeposits?.value ?? 0),
      pendingDeposits: pendingDepCount,
      pendingWithdrawals: Number(pendingWdCount?.value ?? 0),
      stake,
      payouts,
      balance: round2(Number(totalBalance?.value ?? 0)),
      liveMatches: liveMatch?.n ?? 0,
      openQuestions: openQuestions?.n ?? 0,
      netRevenue: round2(stake - payouts),
    },
    users: users.map(publicUser),
    bets: betsRows.map((b) => ({
      ...b,
      selectionLabel: isKnownMarket(b.market)
        ? (marketLabelFor(b.market, b.selection, b.homeTeam, b.awayTeam) ?? b.selectionLabel)
        : b.selectionLabel,
    })),
    predictionBets: predBetsRows,
    comboBets: comboRows.map((cb) => ({
      ...cb,
      legs: (cb.legs ?? []).map((l) =>
        l.kind === "sport" && l.homeTeam && l.awayTeam && isKnownMarket(l.market)
          ? {
              ...l,
              selectionLabel:
                marketLabelFor(l.market, l.selection, l.homeTeam, l.awayTeam) ??
                l.selectionLabel,
            }
          : l
      ),
    })),
    deposits: depRows.map((d) => ({
      ...d,
      userName: userNameMap.get(d.userId) ?? `Joueur #${d.userId}`,
    })),
    withdrawals: wdRows.map((w) => ({
      ...w,
      userName: userNameMap.get(w.userId) ?? `Joueur #${w.userId}`,
    })),
    matches: matchRows.map((m) => ({
      ...m,
      homeLogo: teamLogo(m.homeTeam) || m.homeLogo,
      awayLogo: teamLogo(m.awayTeam) || m.awayLogo,
    })),
    questions: uniqueQuestions.map((q) => ({
      ...q,
      resolvesAt: q.resolvesAt.toISOString(),
      resolvedAt: q.resolvedAt ? q.resolvedAt.toISOString() : null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (typeof auth !== "number") return auth;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const action = String(body.action ?? "");

  try {
    resetSyncThrottle();
    if (action === "setBalance") {
      const userId = Number(body.userId);
      const amount = roundNumber(body.amount);
      if (!userId || amount == null || amount < 0) {
        return NextResponse.json({ error: "Montant valide requis (≥ 0 €)" }, { status: 400 });
      }
      const [prevUser] = await db
        .select({ balance: appUser.balance })
        .from(appUser)
        .where(eq(appUser.id, userId));
      if (!prevUser) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });

      const delta = round2(amount - (prevUser.balance ?? 0));
      const [u] = await db
        .update(appUser)
        .set({ balance: amount })
        .where(eq(appUser.id, userId))
        .returning();
      if (Math.abs(delta) >= 0.01) {
        await db.insert(walletAdjustments).values({
          userId,
          amount: delta,
          reason: `Mise à jour manuelle du solde (${amount.toFixed(2)} €)`,
        });
      }
      return NextResponse.json({ ok: true, user: publicUser(u) });
    }

    if (action === "addMatch") {
      const home = String(body.home ?? "").trim();
      const away = String(body.away ?? "").trim();
      if (!home || !away) {
        return NextResponse.json({ error: "Les deux équipes sont requises" }, { status: 400 });
      }
      if (home.toLowerCase() === away.toLowerCase()) {
        return NextResponse.json({ error: "Les deux équipes doivent être différentes" }, { status: 400 });
      }
      const league = String(body.league ?? "Football").trim() || "Football";
      const oddsHome = Math.max(1.02, roundNumber(body.oddsHome) ?? 1.9);
      const oddsDraw = Math.max(1.02, roundNumber(body.oddsDraw) ?? 3.3);
      const oddsAway = Math.max(1.02, roundNumber(body.oddsAway) ?? 3.1);
      const status = body.status === "live" ? "live" : "upcoming";
      const source = body.source === "virtual" ? "virtual" : "manual";

      let startsAt = new Date(status === "live" ? Date.now() : Date.now() + 10 * 60_000);
      if (typeof body.startsAt === "string" && body.startsAt.trim()) {
        const parsed = new Date(body.startsAt);
        if (!Number.isNaN(parsed.getTime())) startsAt = parsed;
      }

      const rawMarkets = Array.isArray(body.markets) ? (body.markets as unknown[]) : null;
      const markets =
        rawMarkets && rawMarkets.length > 0
          ? rawMarkets.map((mm) => {
              const g = mm as {
                key?: string;
                label?: string;
                short?: string;
                outcomes?: unknown[];
                rows?: unknown[];
              };
              return {
                key: String(g.key ?? ""),
                label: String(g.label ?? ""),
                short: String(g.short ?? ""),
                outcomes: Array.isArray(g.outcomes)
                  ? g.outcomes.map((oo) => {
                      const o = oo as { key?: string; label?: string; short?: string; odds?: number };
                      return {
                        key: String(o.key ?? ""),
                        label: String(o.label ?? ""),
                        short: String(o.short ?? ""),
                        odds: Math.max(1.02, roundNumber(o.odds) ?? 2),
                      };
                    })
                  : [],
                rows: Array.isArray(g.rows)
                  ? g.rows.map((rr) => {
                      const r = rr as { label?: string; outcomes?: unknown[] };
                      return {
                        label: String(r.label ?? ""),
                        outcomes: Array.isArray(r.outcomes)
                          ? r.outcomes.map((oo) => {
                              const o = oo as { key?: string; label?: string; short?: string; odds?: number };
                              return {
                                key: String(o.key ?? ""),
                                label: String(o.label ?? ""),
                                short: String(o.short ?? ""),
                                odds: Math.max(1.02, roundNumber(o.odds) ?? 2),
                              };
                            })
                          : [],
                      };
                    })
                  : undefined,
              };
            })
          : null;

      let h = oddsHome;
      let d = oddsDraw;
      let a = oddsAway;
      if (markets) {
        const res = markets.find((m) => m.key === "result");
        const pick = (k: string) => res?.outcomes.find((o) => o.key === k)?.odds;
        const vh = pick("home");
        const vd = pick("draw");
        const va = pick("away");
        if (vh) h = vh;
        if (vd) d = vd;
        if (va) a = va;
      }

      const customHomeLogo =
        typeof body.homeLogo === "string" && body.homeLogo.trim() ? body.homeLogo.trim() : null;
      const customAwayLogo =
        typeof body.awayLogo === "string" && body.awayLogo.trim() ? body.awayLogo.trim() : null;

      const [m] = await db
        .insert(matches)
        .values({
          sport: "football",
          league,
          homeTeam: home,
          awayTeam: away,
          homeLogo: customHomeLogo ?? teamLogo(home),
          awayLogo: customAwayLogo ?? teamLogo(away),
          homeScore: status === "live" ? 0 : null,
          awayScore: status === "live" ? 0 : null,
          status,
          minute: status === "live" ? "1'" : null,
          startsAt,
          oddsHome: h,
          oddsDraw: d,
          oddsAway: a,
          suspended: false,
          redHome: 0,
          redAway: 0,
          events: [],
          tickHistory: [],
          regime: "balanced",
          homeForm: 1,
          awayForm: 1,
          markets,
          source,
        })
        .returning();
      return NextResponse.json({ ok: true, match: m });
    }

    if (action === "editMatch") {
      const matchId = Number(body.matchId);
      if (!matchId) return NextResponse.json({ error: "matchId requis" }, { status: 400 });
      const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
      if (!m) return NextResponse.json({ error: "Match introuvable" }, { status: 404 });

      const homeTeam = String(body.home ?? m.homeTeam).trim() || m.homeTeam;
      const awayTeam = String(body.away ?? m.awayTeam).trim() || m.awayTeam;
      const league = String(body.league ?? m.league).trim() || m.league;
      const oddsHome = Math.max(1.02, roundNumber(body.oddsHome) ?? m.oddsHome);
      const oddsDraw = Math.max(1.02, roundNumber(body.oddsDraw) ?? m.oddsDraw ?? 3.2);
      const oddsAway = Math.max(1.02, roundNumber(body.oddsAway) ?? m.oddsAway);

      let updatedMarkets = m.markets;
      if (updatedMarkets && updatedMarkets.length > 0) {
        updatedMarkets = updatedMarkets.map((g) => {
          if (g.key !== "result" || g.rows) return g;
          return {
            ...g,
            outcomes: g.outcomes.map((o) => {
              if (o.key === "home") return { ...o, odds: oddsHome };
              if (o.key === "draw") return { ...o, odds: oddsDraw };
              if (o.key === "away") return { ...o, odds: oddsAway };
              return o;
            }),
          };
        });
      }

      const [updated] = await db
        .update(matches)
        .set({
          homeTeam,
          awayTeam,
          league,
          oddsHome,
          oddsDraw,
          oddsAway,
          homeLogo: teamLogo(homeTeam) || m.homeLogo,
          awayLogo: teamLogo(awayTeam) || m.awayLogo,
          markets: updatedMarkets,
        })
        .where(eq(matches.id, matchId))
        .returning();

      return NextResponse.json({ ok: true, match: updated });
    }

    if (action === "deleteMatch") {
      const matchId = Number(body.matchId);
      if (!matchId) return NextResponse.json({ error: "matchId requis" }, { status: 400 });

      await db.transaction(async (tx) => {
        const pendingBets = await tx
          .select({ id: bets.id, userId: bets.userId, stake: bets.stake })
          .from(bets)
          .where(and(eq(bets.matchId, matchId), eq(bets.status, "pending")));

        for (const pb of pendingBets) {
          await tx
            .update(appUser)
            .set({ balance: sql`${appUser.balance} + ${round2(pb.stake)}` })
            .where(eq(appUser.id, pb.userId));
        }

        await tx.delete(bets).where(eq(bets.matchId, matchId));
        await tx.delete(matches).where(eq(matches.id, matchId));
      });
      await settlePendingCombos();
      invalidateHouseHealthCache();
      return NextResponse.json({ ok: true });
    }

    if (action === "toggleMatch") {
      const matchId = Number(body.matchId);
      const suspended = Boolean(body.suspended);
      await db.update(matches).set({ suspended }).where(eq(matches.id, matchId));
      return NextResponse.json({ ok: true });
    }

    if (action === "markGoal") {
      const matchId = Number(body.matchId);
      const team = body.team === "away" ? "away" : "home";
      if (!matchId) return NextResponse.json({ error: "matchId requis" }, { status: 400 });

      const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
      if (!m) return NextResponse.json({ error: "Match introuvable" }, { status: 404 });
      if (m.status === "finished") {
        return NextResponse.json(
          { error: "Impossible de marquer un but : match déjà terminé" },
          { status: 400 }
        );
      }

      const currentHome = m.homeScore ?? 0;
      const currentAway = m.awayScore ?? 0;
      const homeScore = team === "home" ? currentHome + 1 : currentHome;
      const awayScore = team === "away" ? currentAway + 1 : currentAway;

      let gameMinute = minuteNumber(m.minute);
      if (typeof body.minute === "number" && Number.isFinite(body.minute)) {
        gameMinute = body.minute;
      }
      gameMinute = Math.max(1, Math.min(90, Math.round(gameMinute || 1)));

      const isReal = m.source === "manual";
      const scorer = isReal
        ? undefined
        : pickScorerName(
            team === "home" ? m.homeTeam : m.awayTeam,
            matchId * 37 + homeScore + awayScore
          );
      const events = [...(m.events ?? [])];
      events.push({
        type: "goal",
        team,
        minute: gameMinute,
        ...(scorer ? { player: scorer } : {}),
      });

      // Pour un match réel, on conserve les cotes de l'admin et l'heure officielle de coup d'envoi
      // (le match passe en `suspended: true` pour permettre à l'admin d'ajuster ses cotes live avant réouverture).
      const dynOdds = isReal
        ? { oddsHome: m.oddsHome, oddsDraw: m.oddsDraw, oddsAway: m.oddsAway }
        : liveOddsFor(m.homeTeam, m.awayTeam, homeScore, awayScore, gameMinute, {
            homeForm: m.homeForm ?? 1,
            awayForm: m.awayForm ?? 1,
            redHome: m.redHome ?? 0,
            redAway: m.redAway ?? 0,
          });

      const reprice = await db
        .update(matches)
        .set({
          homeScore,
          awayScore,
          minute: `${gameMinute}'`,
          status: "live",
          oddsHome: dynOdds.oddsHome,
          oddsDraw: dynOdds.oddsDraw,
          oddsAway: dynOdds.oddsAway,
          lastGoalAt: new Date(),
          ...(isReal
            ? {}
            : { startsAt: backdateStartsAtForMinute(gameMinute, Date.now(), m.source, m.id) }),
          suspended: true,
          events,
        })
        .where(eq(matches.id, matchId))
        .returning();

      const staleCutoff = new Date(Date.now() - STALE_LATENCY_MS);
      const staleBets = await db
        .select({ id: bets.id, market: bets.market, selection: bets.selection })
        .from(bets)
        .where(
          and(
            eq(bets.matchId, matchId),
            eq(bets.status, "pending"),
            sql`${bets.placedAt} >= ${staleCutoff}`
          )
        );
      for (const sb of staleBets) {
        const settledAfterGoal = marketOutcomeSettled(
          sb.market,
          sb.selection,
          homeScore,
          awayScore,
          gameMinute
        );
        const settledBeforeGoal = marketOutcomeSettled(
          sb.market,
          sb.selection,
          currentHome,
          currentAway,
          gameMinute
        );
        if (settledAfterGoal && !settledBeforeGoal) {
          await db.update(bets).set({ riskFlag: "stale_mark_goal" }).where(eq(bets.id, sb.id));
        }
      }

      await demoteOtherLiveMatches(matchId);
      return NextResponse.json({ ok: true, match: reprice[0] });
    }

    if (action === "setMinute") {
      const matchId = Number(body.matchId);
      const minuteText = String(body.minute ?? "").trim();
      if (!matchId) return NextResponse.json({ error: "matchId requis" }, { status: 400 });
      const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
      if (!m) return NextResponse.json({ error: "Match introuvable" }, { status: 404 });
      if (m.status === "finished") {
        return NextResponse.json({ error: "Rouvrir d'abord le match avant de modifier la minute" }, { status: 400 });
      }

      const isReal = m.source === "manual";
      const upper = minuteText.toUpperCase();
      const formattedMinute =
        upper === "MT" || upper === "HT"
          ? "MT"
          : /^\d+\+\d+'?$/.test(minuteText)
            ? minuteText.endsWith("'")
              ? minuteText
              : `${minuteText}'`
            : `${Math.max(1, Math.min(90, minuteNumber(minuteText) || 1))}'`;

      const target = formattedMinute === "MT" ? 45 : Math.max(1, Math.min(90, minuteNumber(formattedMinute) || 1));
      const dynOdds = isReal
        ? { oddsHome: m.oddsHome, oddsDraw: m.oddsDraw, oddsAway: m.oddsAway }
        : liveOddsFor(
            m.homeTeam,
            m.awayTeam,
            m.homeScore ?? 0,
            m.awayScore ?? 0,
            target,
            {
              homeForm: m.homeForm ?? 1,
              awayForm: m.awayForm ?? 1,
              redHome: m.redHome ?? 0,
              redAway: m.redAway ?? 0,
            }
          );

      const [updated] = await db
        .update(matches)
        .set({
          minute: formattedMinute,
          status: "live",
          homeScore: m.homeScore ?? 0,
          awayScore: m.awayScore ?? 0,
          oddsHome: dynOdds.oddsHome,
          oddsDraw: dynOdds.oddsDraw,
          oddsAway: dynOdds.oddsAway,
          ...(isReal
            ? {}
            : { startsAt: backdateStartsAtForMinute(target, Date.now(), m.source, m.id) }),
        })
        .where(eq(matches.id, matchId))
        .returning();
      await demoteOtherLiveMatches(matchId);
      return NextResponse.json({ ok: true, match: updated });
    }

    if (action === "setScore") {
      const matchId = Number(body.matchId);
      if (!matchId) return NextResponse.json({ error: "matchId requis" }, { status: 400 });
      const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
      if (!m) return NextResponse.json({ error: "Match introuvable" }, { status: 404 });
      if (m.status === "finished") {
        return NextResponse.json({ error: "Le match est déjà terminé" }, { status: 400 });
      }
      const homeScore = Math.max(0, Math.round(roundNumber(body.homeScore) ?? m.homeScore ?? 0));
      const awayScore = Math.max(0, Math.round(roundNumber(body.awayScore) ?? m.awayScore ?? 0));
      const [updated] = await db
        .update(matches)
        .set({
          homeScore,
          awayScore,
          status: "live",
          minute: m.minute ?? "1'",
        })
        .where(eq(matches.id, matchId))
        .returning();
      return NextResponse.json({ ok: true, match: updated });
    }

    if (action === "startMatch") {
      const matchId = Number(body.matchId);
      if (!matchId) return NextResponse.json({ error: "matchId requis" }, { status: 400 });
      const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
      if (!m) return NextResponse.json({ error: "Match introuvable" }, { status: 404 });
      const isReal = m.source === "manual";
      const [updated] = await db
        .update(matches)
        .set({
          status: "live",
          homeScore: m.homeScore ?? 0,
          awayScore: m.awayScore ?? 0,
          minute: "1'",
          suspended: false,
          ...(isReal ? {} : { startsAt: new Date() }),
          lastGoalAt: null,
        })
        .where(eq(matches.id, matchId))
        .returning();
      await demoteOtherLiveMatches(matchId);
      return NextResponse.json({ ok: true, match: updated });
    }

    if (action === "finishMatch") {
      const matchId = Number(body.matchId);
      if (!matchId) return NextResponse.json({ error: "matchId requis" }, { status: 400 });
      const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
      if (!m) return NextResponse.json({ error: "Match introuvable" }, { status: 404 });
      if (m.status === "finished") {
        return NextResponse.json({ error: "Le match est déjà terminé" }, { status: 400 });
      }

      const givenHome = roundNumber(body.homeScore);
      const givenAway = roundNumber(body.awayScore);
      const homeScore = givenHome != null ? Math.max(0, Math.round(givenHome)) : m.homeScore ?? 0;
      const awayScore = givenAway != null ? Math.max(0, Math.round(givenAway)) : m.awayScore ?? 0;

      const givenHtHome = roundNumber(body.htHomeScore);
      const givenHtAway = roundNumber(body.htAwayScore);
      let nextEvents = m.events ?? [];
      if (
        m.source === "manual" &&
        givenHtHome != null &&
        givenHtAway != null &&
        !hasVerifiedGoalTimeline(homeScore, awayScore, nextEvents)
      ) {
        const htH = Math.max(0, Math.min(homeScore, Math.round(givenHtHome)));
        const htA = Math.max(0, Math.min(awayScore, Math.round(givenHtAway)));
        const synth: Array<{ type: string; team: string; minute: number }> = [];
        for (let i = 0; i < htH; i++) synth.push({ type: "goal", team: "home", minute: 20 + i * 5 });
        for (let i = 0; i < htA; i++) synth.push({ type: "goal", team: "away", minute: 22 + i * 5 });
        for (let i = 0; i < homeScore - htH; i++) synth.push({ type: "goal", team: "home", minute: 60 + i * 5 });
        for (let i = 0; i < awayScore - htA; i++) synth.push({ type: "goal", team: "away", minute: 62 + i * 5 });
        nextEvents = synth;
      }

      const [updated] = await db
        .update(matches)
        .set({
          status: "finished",
          minute: "Terminé",
          suspended: false,
          homeScore,
          awayScore,
          events: nextEvents,
          finishedAt: new Date(),
        })
        .where(eq(matches.id, matchId))
        .returning();

      await settleMatchBets(matchId);
      invalidateHouseHealthCache();

      return NextResponse.json({ ok: true, match: updated, settled: true });
    }

    if (action === "reopenMatch") {
      const matchId = Number(body.matchId);
      if (!matchId) return NextResponse.json({ error: "matchId requis" }, { status: 400 });
      const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
      if (!m) return NextResponse.json({ error: "Match introuvable" }, { status: 404 });
      if (m.status !== "finished") {
        return NextResponse.json({ error: "Seul un match terminé peut être rouvert" }, { status: 400 });
      }

      const isReal = m.source === "manual";
      const reopenMin = 75;
      let updatedMatch = m;

      await db.transaction(async (tx) => {
        const settled = await tx
          .select()
          .from(bets)
          .where(and(eq(bets.matchId, matchId), inArray(bets.status, ["won", "lost", "void"])));

        for (const b of settled) {
          if (b.status === "won" || b.status === "void") {
            const clawback =
              b.status === "void"
                ? round2(b.stake)
                : round2(b.stake * b.odds * (b.payoutMultiplier ?? 1) + (b.stakeReturned ?? 0));
            await tx
              .update(appUser)
              .set({ balance: sql`GREATEST(0, ${appUser.balance} - ${clawback})` })
              .where(eq(appUser.id, b.userId));
          }
          await tx
            .update(bets)
            .set({
              status: "pending",
              potentialWin: round2(b.stake * b.odds),
            })
            .where(eq(bets.id, b.id));
        }

        const [u] = await tx
          .update(matches)
          .set({
            status: "live",
            minute: `${reopenMin}'`,
            finishedAt: null,
            suspended: false,
            ...(isReal
              ? {}
              : { startsAt: backdateStartsAtForMinute(reopenMin, Date.now(), m.source, m.id) }),
          })
          .where(eq(matches.id, matchId))
          .returning();
        if (u) updatedMatch = u;
      });

      await demoteOtherLiveMatches(matchId);
      invalidateHouseHealthCache();
      return NextResponse.json({ ok: true, match: updatedMatch });
    }

    if (action === "addQuestion") {
      const question = String(body.question ?? "").trim();
      if (!question) {
        return NextResponse.json({ error: "La question est requise" }, { status: 400 });
      }

      const [dup] = await db
        .select({ id: predictionQuestions.id })
        .from(predictionQuestions)
        .where(sql`LOWER(TRIM(${predictionQuestions.question})) = LOWER(TRIM(${question}))`)
        .limit(1);
      if (dup) {
        return NextResponse.json({ error: "Cette question existe déjà" }, { status: 400 });
      }

      const category = String(body.category ?? "Sport").trim() || "Sport";
      const isMultiMode = body.mode === "multi" || Array.isArray(body.options);
      const parsedOptions = isMultiMode ? parseQuestionOptions(body.options) : null;
      if (isMultiMode && (!parsedOptions || parsedOptions.length < 2)) {
        return NextResponse.json(
          { error: "Ajoutez au moins 2 choix avec un nom et une cote valide (> 1,01)" },
          { status: 400 }
        );
      }

      const oddsYes = Math.max(1.02, roundNumber(body.oddsYes) ?? 1.9);
      const oddsNo = Math.max(1.02, roundNumber(body.oddsNo) ?? 1.8);
      const hours = Math.max(0.1, Number(body.resolvesAt) || 72);
      const resolvesAt = new Date(Date.now() + hours * 3_600_000);

      const existingSeeds = await db
        .select({ seedValue: predictionQuestions.seedValue })
        .from(predictionQuestions);
      const usedSeeds = new Set(existingSeeds.map((s) => s.seedValue));
      let seedValue = Math.floor(Math.random() * 10000) + 1;
      let attempts = 0;
      while (usedSeeds.has(seedValue) && attempts < 100) {
        seedValue = Math.floor(Math.random() * 10000) + 1;
        attempts++;
      }

      const [q] = await db
        .insert(predictionQuestions)
        .values({
          question,
          category,
          status: "open",
          resolution: null,
          seedValue,
          oddsYes,
          oddsNo,
          options: parsedOptions,
          volume: 0,
          yesCount: 0,
          noCount: 0,
          resolvesAt,
        })
        .returning();
      return NextResponse.json({ ok: true, question: q });
    }

    if (action === "editQuestion") {
      const questionId = Number(body.questionId);
      if (!questionId) return NextResponse.json({ error: "questionId requis" }, { status: 400 });
      const question = String(body.question ?? "").trim();
      const category = String(body.category ?? "Sport").trim() || "Sport";
      const oddsYes = Math.max(1.02, roundNumber(body.oddsYes) ?? 1.9);
      const oddsNo = Math.max(1.02, roundNumber(body.oddsNo) ?? 1.8);
      const hasOptionsField = Array.isArray(body.options);
      const parsedOptions = hasOptionsField ? parseQuestionOptions(body.options) : undefined;
      if (hasOptionsField && (!parsedOptions || parsedOptions.length < 2)) {
        return NextResponse.json(
          { error: "Une question à choix multiples doit comporter au moins 2 choix valides" },
          { status: 400 }
        );
      }

      const hoursRaw = roundNumber(body.hours);
      const nextResolvesAt =
        hoursRaw != null && hoursRaw > 0
          ? new Date(Date.now() + hoursRaw * 3_600_000)
          : undefined;

      const [updated] = await db
        .update(predictionQuestions)
        .set({
          ...(question ? { question } : {}),
          category,
          oddsYes,
          oddsNo,
          ...(parsedOptions !== undefined ? { options: parsedOptions } : {}),
          ...(nextResolvesAt ? { resolvesAt: nextResolvesAt } : {}),
        })
        .where(eq(predictionQuestions.id, questionId))
        .returning();
      if (!updated) return NextResponse.json({ error: "Question introuvable" }, { status: 404 });
      return NextResponse.json({ ok: true, question: updated });
    }

    if (action === "resolveQuestion") {
      const questionId = Number(body.questionId);
      const rawRes = String(body.resolution ?? "").trim();
      const [q] = await db
        .select()
        .from(predictionQuestions)
        .where(eq(predictionQuestions.id, questionId));
      if (!q) return NextResponse.json({ error: "Question introuvable" }, { status: 404 });

      let resolution: string;
      if (Array.isArray(q.options) && q.options.length >= 2) {
        const matched = q.options.find((o) => o.key === rawRes);
        if (!matched) {
          return NextResponse.json({ error: "Choix gagnant invalide" }, { status: 400 });
        }
        resolution = matched.key;
      } else {
        resolution = rawRes === "yes" ? "yes" : "no";
      }

      await settleQuestion(questionId, resolution);
      return NextResponse.json({ ok: true });
    }

    if (action === "reopenQuestion") {
      const questionId = Number(body.questionId);
      if (!questionId) return NextResponse.json({ error: "questionId requis" }, { status: 400 });
      const found = await reopenSettledQuestion(questionId);
      if (!found) return NextResponse.json({ error: "Question introuvable" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    if (action === "deleteQuestion") {
      const questionId = Number(body.questionId);
      if (!questionId) return NextResponse.json({ error: "questionId requis" }, { status: 400 });

      await db.transaction(async (tx) => {
        // Rembourse proprement toute mise en attente avant suppression en cascade
        const pendingBets = await tx
          .select({ id: predictionBets.id, userId: predictionBets.userId, stake: predictionBets.stake })
          .from(predictionBets)
          .where(and(eq(predictionBets.questionId, questionId), eq(predictionBets.status, "pending")));

        for (const pb of pendingBets) {
          await tx
            .update(appUser)
            .set({ balance: sql`${appUser.balance} + ${round2(pb.stake)}` })
            .where(eq(appUser.id, pb.userId));
        }

        await tx.delete(predictionBets).where(eq(predictionBets.questionId, questionId));
        await tx.delete(predictionQuestions).where(eq(predictionQuestions.id, questionId));
      });
      await settlePendingCombos();
      invalidateHouseHealthCache();
      return NextResponse.json({ ok: true });
    }

    if (action === "approveWithdrawal") {
      const wid = Number(body.withdrawalId);
      const note = body.note ? String(body.note).trim() : null;
      if (!wid) return NextResponse.json({ error: "withdrawalId requis" }, { status: 400 });

      const [updated] = await db
        .update(withdrawals)
        .set({
          status: "approved",
          processedAt: new Date(),
          ...(note ? { adminNote: note } : {}),
        })
        .where(and(eq(withdrawals.id, wid), eq(withdrawals.status, "pending")))
        .returning();

      if (!updated) {
        return NextResponse.json({ error: "Ce retrait a déjà été traité" }, { status: 400 });
      }
      return NextResponse.json({ ok: true, withdrawal: updated });
    }

    if (action === "rejectWithdrawal") {
      const wid = Number(body.withdrawalId);
      const note = body.note ? String(body.note).trim() : null;
      if (!wid) return NextResponse.json({ error: "withdrawalId requis" }, { status: 400 });

      const updated = await db.transaction(async (tx) => {
        const [rejected] = await tx
          .update(withdrawals)
          .set({
            status: "rejected",
            processedAt: new Date(),
            ...(note ? { adminNote: note } : {}),
          })
          .where(and(eq(withdrawals.id, wid), eq(withdrawals.status, "pending")))
          .returning();

        if (!rejected) return null;

        await tx
          .update(appUser)
          .set({
            balance: sql`ROUND((${appUser.balance} + ${round2(rejected.amount)})::numeric, 2)::float8`,
          })
          .where(eq(appUser.id, rejected.userId));

        return rejected;
      });

      if (!updated) {
        return NextResponse.json({ error: "Ce retrait a déjà été traité" }, { status: 400 });
      }
      return NextResponse.json({ ok: true, withdrawal: updated });
    }

    if (action === "approveDeposit") {
      const did = Number(body.depositId);
      if (!did) return NextResponse.json({ error: "depositId requis" }, { status: 400 });

      const updated = await db.transaction(async (tx) => {
        const [credited] = await tx
          .update(deposits)
          .set({ status: "credited", updatedAt: new Date() })
          .where(and(eq(deposits.id, did), eq(deposits.status, "pending_review")))
          .returning();

        if (!credited) return null;

        await tx
          .update(appUser)
          .set({
            balance: sql`ROUND((${appUser.balance} + ${round2(credited.amount)})::numeric, 2)::float8`,
          })
          .where(eq(appUser.id, credited.userId));

        return credited;
      });

      if (!updated) {
        return NextResponse.json({ error: "Ce dépôt a déjà été traité" }, { status: 400 });
      }
      return NextResponse.json({ ok: true, deposit: updated });
    }

    if (action === "rejectDeposit") {
      const did = Number(body.depositId);
      if (!did) return NextResponse.json({ error: "depositId requis" }, { status: 400 });

      const [rejected] = await db
        .update(deposits)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(and(eq(deposits.id, did), eq(deposits.status, "pending_review")))
        .returning();

      if (!rejected) {
        return NextResponse.json({ error: "Ce dépôt a déjà été traité" }, { status: 400 });
      }
      return NextResponse.json({ ok: true, deposit: rejected });
    }

    if (action === "retrainMl") {
      await retrainAllMlModels();
      const ml = await getAdminMlOverview();
      return NextResponse.json({ ok: true, ml });
    }

    if (action === "setScenarioMode") {
      const nextMode = body.mode === "locked" ? "locked" : "dynamic";
      const applied = await setScenarioMode(nextMode);
      return NextResponse.json({ ok: true, scenarioMode: applied });
    }

    if (action === "lockMatchScenario") {
      const mid = Number(body.matchId);
      if (!Number.isFinite(mid)) {
        return NextResponse.json({ error: "matchId invalide" }, { status: 400 });
      }
      const forecast = await lockMatchScenario(mid);
      if (!forecast) {
        return NextResponse.json({ error: "Match introuvable ou déjà terminé" }, { status: 400 });
      }
      return NextResponse.json({ ok: true, forecast });
    }

    if (action === "unlockMatchScenario") {
      const mid = Number(body.matchId);
      if (!Number.isFinite(mid)) {
        return NextResponse.json({ error: "matchId invalide" }, { status: 400 });
      }
      await unlockMatchScenario(mid);
      return NextResponse.json({ ok: true });
    }

    if (action === "rerollMatchScenario") {
      const mid = Number(body.matchId);
      if (!Number.isFinite(mid)) {
        return NextResponse.json({ error: "matchId invalide" }, { status: 400 });
      }
      const forecast = await rerollMatchScenario(mid);
      if (!forecast) {
        return NextResponse.json({ error: "Match introuvable ou déjà terminé" }, { status: 400 });
      }
      return NextResponse.json({ ok: true, forecast });
    }

    if (action === "forceMatchFinalScore") {
      const mid = Number(body.matchId);
      const hs = Number(body.homeScore);
      const as = Number(body.awayScore);
      if (!Number.isFinite(mid) || !Number.isFinite(hs) || !Number.isFinite(as)) {
        return NextResponse.json({ error: "Paramètres de score invalides" }, { status: 400 });
      }
      const forecast = await forceMatchFinalScore(mid, hs, as);
      if (!forecast) {
        return NextResponse.json({ error: "Match introuvable ou déjà terminé" }, { status: 400 });
      }
      return NextResponse.json({ ok: true, forecast });
    }

    return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
  } catch (err) {
    console.error("[admin API error]", err);
    const msg = err instanceof Error ? err.message : "Erreur interne lors de l'opération";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function roundNumber(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function parseQuestionOptions(raw: unknown): PredictionOption[] | null {
  if (!Array.isArray(raw)) return null;
  const used = new Set<string>();
  const out: PredictionOption[] = [];
  raw.forEach((item, idx) => {
    const obj = item as { key?: unknown; label?: unknown; odds?: unknown };
    const label = String(obj?.label ?? "").trim();
    const odds = roundNumber(obj?.odds);
    if (!label || odds == null || odds <= 1.01) return;
    let key =
      typeof obj?.key === "string" && obj.key.trim()
        ? slugifyOptionKey(obj.key, idx)
        : slugifyOptionKey(label, idx);
    let suffix = 2;
    while (used.has(key)) {
      key = `${slugifyOptionKey(label, idx)}_${suffix++}`;
    }
    used.add(key);
    out.push({ key, label, odds });
  });
  return out.length >= 2 ? out : null;
}
