import { and, desc, eq, ne, sql } from "drizzle-orm";
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
  setScenarioMode,
  unlockMatchScenario,
} from "@/db/engine";
import { liveOddsFor, pickScorerName, type MatchTimelineEvent } from "@/db/fixtures";
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
  type RealMatchStats,
} from "@/db/schema";
import { publicUser } from "@/lib/auth";
import { invalidateAllActiveCaches } from "@/lib/active-state-cache";
import { settlePendingCombos } from "@/lib/combo";
import { invalidateHouseHealthCache } from "@/lib/house-brain";
import { invalidatePublicApiCaches } from "@/lib/response-cache";
import { isKnownMarket, marketLabelFor, marketOutcomeSettled, minuteNumber } from "@/lib/markets";
import { reconcileRedCardCounts, sanitizeMatchEvents } from "@/lib/match-events";
import { getAdminMlOverview, retrainAllMlModels } from "@/lib/ml-engine";
import {
  reopenSettledQuestion,
  round2,
  settleQuestion,
  slugifyOptionKey,
} from "@/lib/predictions";
import { OFFICIAL_SOCCER_LEAGUES } from "@/lib/real-leagues";
import {
  discoverUpcomingRealMatches,
  getRealMatchSettlementMode,
  setRealMatchSettlementMode,
  syncRealMatchesThrottled,
  syncSingleRealMatchNow,
} from "@/lib/real-sports-feed";
import { STALE_LATENCY_MS } from "@/lib/risk";
import { clearAuthCookie, getAuthUserId } from "@/lib/session";
import { settleFinishedBets, settleMatchBets, voidMatchBets } from "@/lib/settle";
import { resetSyncThrottle, syncPlatformStateThrottled } from "@/lib/sync-throttle";
import { teamLogo } from "@/lib/team-logos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADMIN_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  "CDN-Cache-Control": "private, no-store",
  "Vercel-CDN-Cache-Control": "private, no-store",
  Vary: "Cookie, Accept-Encoding",
  "X-Content-Type-Options": "nosniff",
} as const;

async function requireAdmin(req: NextRequest): Promise<number | NextResponse> {
  await ensureSeeded();
  const uid = await getAuthUserId(req);
  if (!uid) {
    const res = NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    clearAuthCookie(res);
    return res;
  }
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

  // Synchronise le moteur live et les règlements sans forcer les appels externes à chaque poll
  await syncPlatformStateThrottled(false);

  // 1 seule requête SQL CTE pour agréger les 12 indicateurs globaux du dashboard admin (au lieu de 12 allers-retours SQL)
  const aggRes = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM "app_user") AS total_users,
      (SELECT COALESCE(SUM("balance"), 0)::float8 FROM "app_user") AS total_balance,
      (SELECT COUNT(*)::int FROM "bets") AS total_bets,
      (SELECT COUNT(*)::int FROM "prediction_bets") AS total_pred_bets,
      (SELECT COUNT(*)::int FROM "combo_bets") AS total_combo_bets,
      (SELECT COUNT(*)::int FROM "deposits") AS total_deposits,
      (SELECT COUNT(*)::int FROM "withdrawals" WHERE "status" = 'pending') AS pending_wd_count,
      (SELECT COUNT(*)::int FROM "matches" WHERE "status" = 'live') AS live_matches,
      (SELECT COUNT(*)::int FROM "prediction_questions" WHERE "status" = 'open') AS open_questions,
      (SELECT COALESCE(SUM("stake"), 0)::float8 FROM "bets") AS sport_stake,
      (SELECT COALESCE(SUM(CASE
        WHEN "status" = 'won' THEN "potential_win"
        WHEN "status" = 'cashed' THEN COALESCE("cash_out_amount", 0)
        WHEN "status" = 'void' THEN "stake"
        ELSE 0 END), 0)::float8 FROM "bets") AS sport_payouts,
      (SELECT COALESCE(SUM("stake"), 0)::float8 FROM "prediction_bets") AS pred_stake,
      (SELECT COALESCE(SUM(CASE
        WHEN "status" = 'won' THEN "potential_win"
        WHEN "status" = 'cashed' THEN COALESCE("cash_out_amount", 0)
        WHEN "status" = 'void' THEN "stake"
        ELSE 0 END), 0)::float8 FROM "prediction_bets") AS pred_payouts,
      (SELECT COALESCE(SUM("stake"), 0)::float8 FROM "combo_bets") AS combo_stake,
      (SELECT COALESCE(SUM(CASE
        WHEN "status" = 'won' THEN "potential_win"
        WHEN "status" = 'cashed' THEN COALESCE("cash_out_amount", 0)
        WHEN "status" = 'void' THEN "stake"
        ELSE 0 END), 0)::float8 FROM "combo_bets") AS combo_payouts
  `);

  const agg = (aggRes.rows?.[0] ?? {}) as Record<string, number | string | null>;
  const totalUsers = { value: Number(agg.total_users ?? 0) };
  const totalBets = { value: Number(agg.total_bets ?? 0) };
  const totalPredBets = { value: Number(agg.total_pred_bets ?? 0) };
  const totalComboBets = { value: Number(agg.total_combo_bets ?? 0) };
  const totalDeposits = { value: Number(agg.total_deposits ?? 0) };
  const pendingWdCount = { value: Number(agg.pending_wd_count ?? 0) };
  const liveMatch = { n: Number(agg.live_matches ?? 0) };
  const openQuestions = { n: Number(agg.open_questions ?? 0) };
  const totalBalance = { value: Number(agg.total_balance ?? 0) };

  const stake = round2(
    Number(agg.sport_stake ?? 0) + Number(agg.pred_stake ?? 0) + Number(agg.combo_stake ?? 0)
  );
  const payouts = round2(
    Number(agg.sport_payouts ?? 0) + Number(agg.pred_payouts ?? 0) + Number(agg.combo_payouts ?? 0)
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
      .limit(50),
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
  const [ml, scenarioInfo, realSettlementMode] = await Promise.all([
    getAdminMlOverview(),
    getAdminMatchForecasts(matchRows),
    getRealMatchSettlementMode(),
  ]);

  return NextResponse.json({
    ml,
    scenarioMode: scenarioInfo.mode,
    realSettlementMode,
    officialLeagues: OFFICIAL_SOCCER_LEAGUES,
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
    bets: (() => {
      const mById = new Map(matchRows.map((m) => [m.id, m]));
      return betsRows.map((b) => {
        const m = b.matchId ? mById.get(b.matchId) : undefined;
        return {
          ...b,
          homeLogo: teamLogo(b.homeTeam, m?.homeLogo),
          awayLogo: teamLogo(b.awayTeam, m?.awayLogo),
          selectionLabel: isKnownMarket(b.market)
            ? (marketLabelFor(b.market, b.selection, b.homeTeam, b.awayTeam) ?? b.selectionLabel)
            : b.selectionLabel,
        };
      });
    })(),
    predictionBets: predBetsRows,
    comboBets: (() => {
      const mById = new Map(matchRows.map((m) => [m.id, m]));
      return comboRows.map((cb) => ({
        ...cb,
        legs: (cb.legs ?? []).map((l) => {
          if (l.kind !== "sport") return l;
          const m = l.matchId ? mById.get(l.matchId) : undefined;
          const homeTeam = l.homeTeam || m?.homeTeam;
          const awayTeam = l.awayTeam || m?.awayTeam;
          return {
            ...l,
            homeTeam,
            awayTeam,
            homeLogo: teamLogo(homeTeam, l.homeLogo ?? m?.homeLogo),
            awayLogo: teamLogo(awayTeam, l.awayLogo ?? m?.awayLogo),
            selectionLabel:
              homeTeam && awayTeam && isKnownMarket(l.market)
                ? (marketLabelFor(l.market, l.selection, homeTeam, awayTeam) ?? l.selectionLabel)
                : l.selectionLabel,
          };
        }),
      }));
    })(),
    deposits: depRows.map((d) => ({
      ...d,
      userName: userNameMap.get(d.userId) ?? `Joueur #${d.userId}`,
    })),
    withdrawals: wdRows.map((w) => ({
      ...w,
      userName: userNameMap.get(w.userId) ?? `Joueur #${w.userId}`,
    })),
    matches: matchRows.map((m) => {
      const cleanEvents = sanitizeMatchEvents(m.events, m.homeScore, m.awayScore);
      const { redHome, redAway } = reconcileRedCardCounts(
        m.events,
        cleanEvents,
        m.redHome,
        m.redAway
      );
      return {
        ...m,
        events: cleanEvents,
        redHome,
        redAway,
        homeLogo: teamLogo(m.homeTeam, m.homeLogo),
        awayLogo: teamLogo(m.awayTeam, m.awayLogo),
      };
    }),
    questions: uniqueQuestions.map((q) => ({
      ...q,
      resolvesAt: q.resolvesAt.toISOString(),
      resolvedAt: q.resolvedAt ? q.resolvedAt.toISOString() : null,
    })),
  }, { headers: ADMIN_NO_STORE_HEADERS });
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
      const externalId =
        source === "manual" && typeof body.externalId === "string" && body.externalId.trim()
          ? body.externalId.trim()
          : null;
      const externalLeague =
        source === "manual" &&
        typeof body.externalLeague === "string" &&
        body.externalLeague.trim()
          ? body.externalLeague.trim()
          : null;
      const autoSync =
        source === "manual"
          ? body.autoSync === undefined
            ? true
            : Boolean(body.autoSync)
          : false;

      if (externalId) {
        const [dup] = await db
          .select({ id: matches.id })
          .from(matches)
          .where(eq(matches.externalId, externalId))
          .limit(1);
        if (dup) {
          return NextResponse.json(
            { error: "Cette affiche officielle est déjà importée dans les matchs réels" },
            { status: 400 }
          );
        }
      }

      const [m] = await db
        .insert(matches)
        .values({
          sport: "football",
          league,
          homeTeam: home,
          awayTeam: away,
          homeLogo: teamLogo(home, customHomeLogo),
          awayLogo: teamLogo(away, customAwayLogo),
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
          externalId,
          externalLeague,
          autoSync,
        })
        .returning();

      let syncedMatch = m;
      if (m && source === "manual" && autoSync) {
        const refreshed = await syncSingleRealMatchNow(m.id).catch(() => null);
        if (refreshed) syncedMatch = refreshed;
      }
      return NextResponse.json({ ok: true, match: syncedMatch });
    }

    if (action === "discoverRealMatches") {
      const rawSlug =
        typeof body.leagueSlug === "string" && body.leagueSlug.trim()
          ? body.leagueSlug.trim()
          : "top";
      const leagueSlug = rawSlug === "all" ? "top" : rawSlug;
      const daysAhead =
        typeof body.daysAhead === "number" && Number.isFinite(body.daysAhead)
          ? Math.max(1, Math.min(14, Math.round(body.daysAhead)))
          : 7;

      const { fixtures, reachable, extendedWindow } = await discoverUpcomingRealMatches(
        leagueSlug,
        daysAhead
      );
      return NextResponse.json({
        ok: true,
        reachable,
        extendedWindow,
        fixtures,
      });
    }

    if (action === "importRealMatches") {
      const rawFixtures = Array.isArray(body.fixtures) ? body.fixtures : [];
      if (rawFixtures.length === 0) {
        return NextResponse.json({ error: "Aucune affiche sélectionnée" }, { status: 400 });
      }

      const existingRows = await db
        .select({ externalId: matches.externalId })
        .from(matches)
        .where(eq(matches.source, "manual"));
      const importedSet = new Set(
        existingRows
          .map((r) => r.externalId)
          .filter((x): x is string => typeof x === "string" && x.length > 0)
      );

      const rowsToInsert: Array<typeof matches.$inferInsert> = [];
      const liveExternalIds = new Set<string>();
      let skipped = 0;

      for (const item of rawFixtures.slice(0, 30)) {
        const f = item as Record<string, unknown>;
        const externalId = String(f.externalId ?? "").trim();
        const externalLeague = String(f.leagueSlug ?? f.externalLeague ?? "").trim() || null;
        const league = String(f.leagueLabel ?? f.league ?? "Football").trim() || "Football";
        const homeTeam = String(f.homeTeam ?? "").trim();
        const awayTeam = String(f.awayTeam ?? "").trim();
        if (!externalId || !homeTeam || !awayTeam) continue;
        if (importedSet.has(externalId)) {
          skipped++;
          continue;
        }
        importedSet.add(externalId);

        const startsAtParsed =
          typeof f.startsAt === "string" ? new Date(f.startsAt) : new Date();
        const startsAt = Number.isNaN(startsAtParsed.getTime())
          ? new Date(Date.now() + 3600_000)
          : startsAtParsed;

        const oddsHome = Math.max(1.04, roundNumber(f.oddsHome ?? f.suggestedOddsHome) ?? 2.1);
        const oddsDraw = Math.max(1.04, roundNumber(f.oddsDraw ?? f.suggestedOddsDraw) ?? 3.3);
        const oddsAway = Math.max(1.04, roundNumber(f.oddsAway ?? f.suggestedOddsAway) ?? 3.2);
        const isLive = f.status === "live";
        if (isLive) liveExternalIds.add(externalId);
        const homeLogo =
          typeof f.homeLogo === "string" && f.homeLogo.trim()
            ? f.homeLogo.trim()
            : teamLogo(homeTeam);
        const awayLogo =
          typeof f.awayLogo === "string" && f.awayLogo.trim()
            ? f.awayLogo.trim()
            : teamLogo(awayTeam);

        const htHomeScore =
          isLive && typeof f.htHomeScore === "number" ? Math.max(0, Math.round(f.htHomeScore)) : null;
        const htAwayScore =
          isLive && typeof f.htAwayScore === "number" ? Math.max(0, Math.round(f.htAwayScore)) : null;
        const redHome =
          isLive && typeof f.redHome === "number" ? Math.max(0, Math.round(f.redHome)) : 0;
        const redAway =
          isLive && typeof f.redAway === "number" ? Math.max(0, Math.round(f.redAway)) : 0;
        const liveHomeScore = isLive ? Math.max(0, Number(f.homeScore ?? 0)) : null;
        const liveAwayScore = isLive ? Math.max(0, Number(f.awayScore ?? 0)) : null;
        const initialEvents =
          isLive && Array.isArray(f.events)
            ? sanitizeMatchEvents(
                f.events as MatchTimelineEvent[],
                liveHomeScore,
                liveAwayScore
              )
            : [];
        const initialStats =
          isLive && f.realStats && typeof f.realStats === "object"
            ? (f.realStats as RealMatchStats)
            : null;
        const liveMinute =
          isLive && typeof f.minute === "string" && f.minute.trim()
            ? f.minute.trim()
            : isLive
              ? "1'"
              : null;

        rowsToInsert.push({
          sport: "football",
          league,
          homeTeam,
          awayTeam,
          homeLogo,
          awayLogo,
          homeScore: liveHomeScore,
          awayScore: liveAwayScore,
          htHomeScore,
          htAwayScore,
          status: isLive ? "live" : "upcoming",
          minute: liveMinute,
          startsAt,
          oddsHome,
          oddsDraw,
          oddsAway,
          suspended: false,
          redHome,
          redAway,
          events: initialEvents,
          tickHistory: [],
          regime: "balanced",
          homeForm: 1,
          awayForm: 1,
          markets: null,
          source: "manual",
          externalId,
          externalLeague,
          autoSync: true,
          realStats: initialStats,
          feedSyncedAt: new Date(),
          feedStatusNote: isLive
            ? `Direct synchronisé (${liveMinute ?? "LIVE"})`
            : "Relié au flux officiel · En attente du coup d'envoi",
        });
      }

      // Insertion groupée en UNE SEULE requête multi-lignes `INSERT INTO matches VALUES (...), (...)`
      const createdRows =
        rowsToInsert.length > 0
          ? await db
              .insert(matches)
              .values(rowsToInsert)
              .returning({ id: matches.id, externalId: matches.externalId })
          : [];

      const liveCreated = createdRows.filter(
        (c) => c.externalId && liveExternalIds.has(c.externalId)
      );
      if (liveCreated.length > 0) {
        await Promise.all(
          liveCreated.map((c) => syncSingleRealMatchNow(c.id).catch(() => null))
        );
      }

      return NextResponse.json({
        ok: true,
        importedCount: createdRows.length,
        skippedCount: skipped,
      });
    }

    if (action === "syncRealMatch") {
      const matchId = Number(body.matchId);
      if (!matchId) return NextResponse.json({ error: "matchId requis" }, { status: 400 });
      const updated = await syncSingleRealMatchNow(matchId);
      if (!updated) {
        return NextResponse.json(
          { error: "Match réel introuvable" },
          { status: 404 }
        );
      }
      await Promise.all([settleFinishedBets(), settlePendingCombos()]);
      return NextResponse.json({
        ok: true,
        match: updated,
        linked: Boolean(updated.externalId),
      });
    }

    if (action === "syncAllRealMatches") {
      const summary = await syncRealMatchesThrottled(true);
      await Promise.all([settleFinishedBets(), settlePendingCombos()]);
      return NextResponse.json({ ok: true, summary });
    }

    if (action === "toggleAutoSync") {
      const matchId = Number(body.matchId);
      if (!matchId) return NextResponse.json({ error: "matchId requis" }, { status: 400 });
      const autoSync = Boolean(body.autoSync);
      const [updated] = await db
        .update(matches)
        .set({ autoSync })
        .where(eq(matches.id, matchId))
        .returning();
      if (updated && autoSync) {
        await syncSingleRealMatchNow(updated.id).catch(() => null);
      }
      return NextResponse.json({ ok: true, match: updated });
    }

    if (action === "setRealSettlementMode") {
      const mode = body.mode === "confirm" ? "confirm" : "auto";
      const applied = await setRealMatchSettlementMode(mode);
      return NextResponse.json({ ok: true, realSettlementMode: applied });
    }

    if (action === "voidMatch") {
      const matchId = Number(body.matchId);
      if (!matchId) return NextResponse.json({ error: "matchId requis" }, { status: 400 });
      const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
      if (!m) return NextResponse.json({ error: "Match introuvable" }, { status: 404 });
      if (m.status === "finished" && m.feedStatusNote === "VOIDED") {
        return NextResponse.json({ error: "Ce match a déjà été annulé et remboursé" }, { status: 400 });
      }

      const [updated] = await db
        .update(matches)
        .set({
          status: "finished",
          minute: "Annulé",
          suspended: false,
          autoSync: false,
          feedStatusNote: "VOIDED",
          finishedAt: new Date(),
        })
        .where(eq(matches.id, matchId))
        .returning();

      const refundedCount = await voidMatchBets(matchId);
      await settlePendingCombos();
      invalidateHouseHealthCache();

      return NextResponse.json({ ok: true, match: updated, refundedCount });
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
          homeLogo: teamLogo(homeTeam, homeTeam === m.homeTeam ? m.homeLogo : null),
          awayLogo: teamLogo(awayTeam, awayTeam === m.awayTeam ? m.awayLogo : null),
          markets: updatedMarkets,
        })
        .where(eq(matches.id, matchId))
        .returning();

      return NextResponse.json({ ok: true, match: updated });
    }

    if (action === "deleteMatch") {
      const matchId = Number(body.matchId);
      if (!matchId) return NextResponse.json({ error: "matchId requis" }, { status: 400 });

      // Remboursement groupé + suppression en cascade en 1 seule transaction SQL sans boucle N+1
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          WITH refunded AS (
            SELECT "user_id", SUM(ROUND(("stake" * 100)::numeric)::float8 / 100.0)::float8 AS refund
            FROM "bets"
            WHERE "match_id" = ${matchId}
              AND "status" = 'pending'
            GROUP BY "user_id"
          )
          UPDATE "app_user" AS u
          SET "balance" = u."balance" + refunded.refund
          FROM refunded
          WHERE u."id" = refunded."user_id"
            AND refunded.refund > 0
        `);
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
      const htHomeScore =
        givenHtHome != null
          ? Math.max(0, Math.min(homeScore, Math.round(givenHtHome)))
          : (m.htHomeScore ?? m.realStats?.htHomeScore ?? null);
      const htAwayScore =
        givenHtAway != null
          ? Math.max(0, Math.min(awayScore, Math.round(givenHtAway)))
          : (m.htAwayScore ?? m.realStats?.htAwayScore ?? null);

      const [updated] = await db
        .update(matches)
        .set({
          status: "finished",
          minute: "Terminé",
          suspended: false,
          homeScore,
          awayScore,
          htHomeScore,
          htAwayScore,
          feedStatusNote:
            m.source === "manual" ? "ADMIN_CONFIRMED_FT" : m.feedStatusNote,
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
        await tx.execute(sql`
          WITH reopened AS (
            UPDATE "bets" AS b
            SET
              "status" = 'pending',
              "potential_win" = ROUND((b."stake" * b."odds" * 100)::numeric)::float8 / 100.0,
              "settled_at" = NULL
            WHERE b."match_id" = ${matchId}
              AND b."status" IN ('won', 'lost', 'void')
            RETURNING
              b."user_id",
              CASE
                WHEN b."status" = 'void' THEN ROUND((b."stake" * 100)::numeric)::float8 / 100.0
                WHEN b."status" = 'won' THEN ROUND(((b."stake" * b."odds" * COALESCE(b."payout_multiplier", 1) + COALESCE(b."stake_returned", 0)) * 100)::numeric)::float8 / 100.0
                ELSE 0::float8
              END AS clawback
          )
          UPDATE "app_user" AS u
          SET "balance" = GREATEST(0, u."balance" - agg.total_clawback)
          FROM (
            SELECT "user_id", SUM(clawback)::float8 AS total_clawback
            FROM reopened
            WHERE clawback > 0
            GROUP BY "user_id"
          ) AS agg
          WHERE u."id" = agg."user_id"
        `);

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
        // Remboursement groupé en 1 seule requête SQL + suppression en cascade
        await tx.execute(sql`
          WITH refunded AS (
            SELECT "user_id", SUM(ROUND(("stake" * 100)::numeric)::float8 / 100.0)::float8 AS refund
            FROM "prediction_bets"
            WHERE "question_id" = ${questionId}
              AND "status" = 'pending'
            GROUP BY "user_id"
          )
          UPDATE "app_user" AS u
          SET "balance" = u."balance" + refunded.refund
          FROM refunded
          WHERE u."id" = refunded."user_id"
            AND refunded.refund > 0
        `);
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
  } finally {
    // Toute mutation admin invalide immédiatement les caches RAM ET purge les tags CDN Edge Vercel
    // (`Vercel-Cache-Tag`) lorsque le plan actif l'autorise.
    invalidateAllActiveCaches();
    invalidatePublicApiCaches(true);
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
