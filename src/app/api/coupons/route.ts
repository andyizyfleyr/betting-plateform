import { eq, inArray, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db, ensureHealthyDbConnection } from "@/db";
import { hydrateLiveMatchRow } from "@/db/engine";
import {
  matches,
  predictionQuestions,
  savedCoupons,
  type MatchRow,
  type PredictionQuestionRow,
  type SavedCouponLegRecord,
} from "@/db/schema";
import {
  MAX_COMBO_LEGS,
  sortSlipSelectionsChronologically,
} from "@/lib/combo-math";
import { classifyServerError } from "@/lib/db-error";
import {
  liveMarketOddsFor,
  marketLabelFor,
  marketOddsFor,
  minuteNumber,
  realMatchOddsFor,
} from "@/lib/markets";

export const dynamic = "force-dynamic";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
let tableReady = false;

async function ensureSavedCouponsTable(): Promise<void> {
  if (tableReady) return;
  await ensureHealthyDbConnection();
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "saved_coupons" (
      "code" text PRIMARY KEY NOT NULL,
      "legs" jsonb NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
  `);
  tableReady = true;
}

function generateShortCode(len = 4): string {
  let out = "BX-";
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

function normalizeServerCode(raw: string): string {
  const clean = raw.trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!clean) return "";
  if (clean.startsWith("BX") && clean.length >= 6) {
    return `BX-${clean.slice(2, 10)}`;
  }
  return `BX-${clean.slice(0, 8)}`;
}

/**
 * POST /api/coupons — Enregistre un coupon (1 à 8 sélections) et renvoie un code court ex. `BX-84K2`.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureSavedCouponsTable();

    let body: { legs?: SavedCouponLegRecord[] };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    }

    const rawLegs = Array.isArray(body.legs) ? body.legs : [];
    if (rawLegs.length === 0 || rawLegs.length > MAX_COMBO_LEGS) {
      return NextResponse.json(
        { error: `Le coupon doit contenir entre 1 et ${MAX_COMBO_LEGS} sélections.` },
        { status: 400 }
      );
    }

    const sanitizedLegs: SavedCouponLegRecord[] = [];
    for (const l of rawLegs) {
      if (!l || (l.kind !== "sport" && l.kind !== "prediction")) continue;
      if (!l.selection || !l.market) continue;
      const odds = Number(l.odds);
      if (!Number.isFinite(odds) || odds < 1.01) continue;
      sanitizedLegs.push({
        uid: String(l.uid || (l.kind === "sport" ? `sport-${l.matchId}` : `pred-${l.questionId}`)),
        kind: l.kind,
        ...(l.matchId ? { matchId: Number(l.matchId) } : {}),
        ...(l.matchSource === "manual" || l.matchSource === "virtual"
          ? { matchSource: l.matchSource }
          : {}),
        ...(l.questionId ? { questionId: Number(l.questionId) } : {}),
        title: String(l.title || "").slice(0, 140),
        ...(l.homeTeam ? { homeTeam: String(l.homeTeam).slice(0, 80) } : {}),
        ...(l.awayTeam ? { awayTeam: String(l.awayTeam).slice(0, 80) } : {}),
        ...(l.homeLogo ? { homeLogo: String(l.homeLogo).slice(0, 260) } : {}),
        ...(l.awayLogo ? { awayLogo: String(l.awayLogo).slice(0, 260) } : {}),
        league: String(l.league || "").slice(0, 80),
        market: String(l.market).slice(0, 48),
        selection: String(l.selection).slice(0, 64),
        selectionLabel: String(l.selectionLabel || l.selection).slice(0, 100),
        odds: Math.round(odds * 100) / 100,
      });
    }

    if (sanitizedLegs.length === 0) {
      return NextResponse.json({ error: "Aucune sélection valide à enregistrer." }, { status: 400 });
    }

    // Nettoyage léger probabiliste (coupons > 14 jours) pour préserver le stockage Neon
    if (Math.random() < 0.06) {
      void db
        .execute(sql`DELETE FROM "saved_coupons" WHERE "created_at" < NOW() - INTERVAL '14 days'`)
        .catch(() => undefined);
    }

    for (let attempt = 0; attempt < 6; attempt++) {
      const code = generateShortCode(attempt < 3 ? 4 : 5);
      const inserted = await db
        .insert(savedCoupons)
        .values({
          code,
          legs: sanitizedLegs,
        })
        .onConflictDoNothing()
        .returning({ code: savedCoupons.code });

      if (inserted.length > 0) {
        return NextResponse.json({ code: inserted[0].code });
      }
    }

    return NextResponse.json(
      { error: "Impossible de générer un code pour le moment, réessayez." },
      { status: 500 }
    );
  } catch (err) {
    const info = classifyServerError(err);
    return NextResponse.json({ error: info.message, code: info.code }, { status: info.status });
  }
}

/**
 * GET /api/coupons?code=BX-84K2 — Charge et réactualise les sélections d'un code coupon.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureSavedCouponsTable();
    const rawCode = req.nextUrl.searchParams.get("code") ?? "";
    const code = normalizeServerCode(rawCode);
    if (!code || code.length < 6) {
      return NextResponse.json({ error: "Code coupon invalide (ex. BX-84K2)." }, { status: 400 });
    }

    const [row] = await db
      .select()
      .from(savedCoupons)
      .where(eq(savedCoupons.code, code))
      .limit(1);

    if (!row || !Array.isArray(row.legs) || row.legs.length === 0) {
      return NextResponse.json(
        { error: `Aucun coupon trouvé pour le code ${code}.` },
        { status: 404 }
      );
    }

    const matchIds = row.legs
      .filter((l) => l.kind === "sport" && l.matchId)
      .map((l) => Number(l.matchId));
    const questionIds = row.legs
      .filter((l) => l.kind === "prediction" && l.questionId)
      .map((l) => Number(l.questionId));

    const [mRows, qRows] = await Promise.all([
      matchIds.length > 0
        ? db.select().from(matches).where(inArray(matches.id, matchIds))
        : Promise.resolve([] as MatchRow[]),
      questionIds.length > 0
        ? db
            .select()
            .from(predictionQuestions)
            .where(inArray(predictionQuestions.id, questionIds))
        : Promise.resolve([] as PredictionQuestionRow[]),
    ]);

    const nowLoadMs = Date.now();
    const matchMap = new Map(mRows.map((m) => [m.id, hydrateLiveMatchRow(m, nowLoadMs)]));
    const predMap = new Map(qRows.map((q) => [q.id, q]));

    const hydrated: SavedCouponLegRecord[] = [];
    let skippedClosedCount = 0;

    for (const leg of row.legs) {
      if (leg.kind === "sport" && leg.matchId) {
        const m = matchMap.get(Number(leg.matchId));
        if (!m || m.status === "finished") {
          skippedClosedCount++;
          continue;
        }
        const market = leg.market || "result";
        let resolvedOdds: number | null = null;
        let resolvedLabel: string | null = null;

        if (m.source === "manual") {
          const realHit = realMatchOddsFor(m, market, leg.selection);
          if (realHit) {
            resolvedOdds = realHit.odds;
            resolvedLabel = realHit.label;
          }
        } else {
          const h = m.homeScore ?? 0;
          const a = m.awayScore ?? 0;
          const min = minuteNumber(m.minute);
          const formOpts = {
            homeForm: m.homeForm ?? 1,
            awayForm: m.awayForm ?? 1,
            redHome: m.redHome ?? 0,
            redAway: m.redAway ?? 0,
            events: m.events ?? [],
            regime: m.regime ?? null,
            league: m.league ?? null,
            matchId: m.id,
          };
          resolvedOdds =
            m.status === "live"
              ? liveMarketOddsFor(
                  market,
                  leg.selection,
                  m.homeTeam,
                  m.awayTeam,
                  h,
                  a,
                  min,
                  formOpts
                )
              : marketOddsFor(market, leg.selection, m.homeTeam, m.awayTeam, formOpts);
          resolvedLabel = marketLabelFor(market, leg.selection, m.homeTeam, m.awayTeam);
        }

        if (resolvedOdds == null) {
          skippedClosedCount++;
          continue;
        }
        hydrated.push({
          uid: `sport-${m.id}`,
          kind: "sport",
          matchId: m.id,
          matchSource: m.source === "manual" ? "manual" : "virtual",
          title: `${m.homeTeam} – ${m.awayTeam}`,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          homeLogo: m.homeLogo,
          awayLogo: m.awayLogo,
          league: m.league,
          market,
          selection: leg.selection,
          selectionLabel: resolvedLabel || leg.selectionLabel,
          odds: resolvedOdds,
          startsAt: m.startsAt ? m.startsAt.toISOString() : null,
          isLive: m.status === "live",
        });
      } else if (leg.kind === "prediction" && leg.questionId) {
        const q = predMap.get(Number(leg.questionId));
        if (!q || q.status !== "open") {
          skippedClosedCount++;
          continue;
        }
        let freshOdds = leg.odds;
        let freshLabel = leg.selectionLabel;
        if (Array.isArray(q.options) && q.options.length >= 2) {
          const opt = q.options.find((o) => o.key === leg.selection);
          if (!opt) {
            skippedClosedCount++;
            continue;
          }
          freshOdds = opt.odds;
          freshLabel = opt.label;
        } else {
          freshOdds = leg.selection === "yes" ? q.oddsYes : q.oddsNo;
          freshLabel = leg.selection === "yes" ? "Oui" : "Non";
        }
        hydrated.push({
          uid: `pred-${q.id}`,
          kind: "prediction",
          questionId: q.id,
          title: q.question,
          league: q.category,
          market: leg.market,
          selection: leg.selection,
          selectionLabel: freshLabel,
          odds: freshOdds,
          startsAt: q.resolvesAt ? q.resolvesAt.toISOString() : null,
          isLive: false,
        });
      }
    }

    if (hydrated.length === 0) {
      return NextResponse.json(
        { error: "Toutes les sélections de ce coupon sont déjà terminées ou clôturées." },
        { status: 410 }
      );
    }

    return NextResponse.json({
      code: row.code,
      legs: sortSlipSelectionsChronologically(hydrated),
      skippedClosedCount,
    });
  } catch (err) {
    const info = classifyServerError(err);
    return NextResponse.json({ error: info.message, code: info.code }, { status: info.status });
  }
}
