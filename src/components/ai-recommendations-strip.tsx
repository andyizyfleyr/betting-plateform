"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Sparkles } from "lucide-react";
import {
  api,
  type ClientMatch,
  type ClientMlRecommendations,
  type ClientMlRecommendedPick,
} from "@/lib/api";
import type { ComboSelection } from "@/components/combo-slip";
import { useApp } from "@/components/providers";
import { useLongPressOdds } from "@/lib/use-long-press-odds";
import { cn, formatOdds } from "@/lib/format";

export function AiRecommendationsStrip({ matches }: { matches: ClientMatch[] }) {
  const router = useRouter();
  const { user, openBet, toggleComboLeg, clearCombo, isInCombo, oddsFormat, betsVersion } =
    useApp();
  const [data, setData] = useState<ClientMlRecommendations | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await api.mlRecommendations();
        if (!cancelled) setData(res);
      } catch {
        /* silencieux */
      }
    }
    void load();
    const id = setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [user?.id, betsVersion]);

  if (!data || data.picks.length === 0) return null;

  const matchById = new Map(matches.map((m) => [m.id, m]));

  const handleSingleClick = (pick: ClientMlRecommendedPick) => {
    const m = matchById.get(pick.matchId);
    if (!m) return;
    openBet({
      match: m,
      selection: pick.selection,
      odds: pick.odds,
      label: pick.selectionLabel,
      market: pick.market,
      marketLabel: pick.marketLabel,
    });
  };

  const handleComboClick = () => {
    if (!data.smartCombo) return;
    clearCombo();
    for (const leg of data.smartCombo.legs) {
      toggleComboLeg({
        uid: `sport-${leg.matchId}`,
        kind: "sport",
        matchId: leg.matchId,
        title: `${leg.homeTeam} – ${leg.awayTeam}`,
        league: leg.league,
        market: leg.market,
        selection: leg.selection,
        selectionLabel: leg.selectionLabel,
        odds: leg.odds,
      });
    }
    router.push("/betslip");
  };

  return (
    <section aria-label="Sélection IA personnalisée">
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-1.5">
          <span className="grid h-5 w-5 place-items-center rounded-md bg-ink text-white">
            <Sparkles className="h-3 w-3 text-amber-300" />
          </span>
          <h2 className="font-display text-[13px] font-bold tracking-tight text-ink">
            {data.personalized ? "Sélection IA pour vous" : "Sélection IA du moment"}
          </h2>
        </div>
        <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-dim">
          Modèle ML · {data.personalized ? "Profilé" : "Global"}
        </span>
      </div>

      <div className="no-scrollbar mt-2 flex gap-2.5 overflow-x-auto pb-1">
        {data.smartCombo && (
          <button
            type="button"
            onClick={handleComboClick}
            className="flex min-w-[218px] max-w-[235px] shrink-0 flex-col justify-between rounded-2xl bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 p-3 text-left text-white shadow-sm transition-transform active:scale-[0.985]"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/12 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                  <Layers className="h-2.5 w-2.5" />
                  {data.smartCombo.title}
                </span>
                <span className="rounded-md bg-betclic-red px-1.5 py-0.5 font-display text-[11.5px] font-bold tabular-nums text-white">
                  {formatOdds(data.smartCombo.combinedOdds, oddsFormat)}
                </span>
              </div>
              <div className="mt-2 space-y-1">
                {data.smartCombo.legs.map((l) => (
                  <p key={`${l.matchId}-${l.selection}`} className="truncate text-[11.5px] font-medium text-white/90">
                    • {l.selectionLabel}
                  </p>
                ))}
              </div>
            </div>
            <p className="mt-2 truncate text-[10px] text-white/60">{data.smartCombo.reason}</p>
          </button>
        )}

        {data.picks.map((pick) => {
          const available = matchById.has(pick.matchId);
          if (!available) return null;
          const uid = `sport-${pick.matchId}`;
          const inCombo = isInCombo(uid, pick.market, pick.selection);
          return (
            <AiPickCard
              key={`${pick.matchId}-${pick.market}-${pick.selection}`}
              pick={pick}
              inCombo={inCombo}
              oddsFormat={oddsFormat}
              onTap={() => handleSingleClick(pick)}
            />
          );
        })}
      </div>
    </section>
  );
}

function AiPickCard({
  pick,
  inCombo,
  oddsFormat,
  onTap,
}: {
  pick: ClientMlRecommendedPick;
  inCombo: boolean;
  oddsFormat: "decimal" | "fractional";
  onTap: () => void;
}) {
  const comboSel: ComboSelection = {
    uid: `sport-${pick.matchId}`,
    kind: "sport",
    matchId: pick.matchId,
    title: `${pick.homeTeam} – ${pick.awayTeam}`,
    league: pick.league,
    market: pick.market,
    selection: pick.selection,
    selectionLabel: pick.selectionLabel,
    odds: pick.odds,
  };
  const { pressing, handlers, style } = useLongPressOdds({
    comboSelection: comboSel,
    onTap: () => onTap(),
  });

  return (
    <button
      type="button"
      {...handlers}
      style={style}
      className={cn(
        "flex min-w-[196px] max-w-[215px] shrink-0 flex-col justify-between rounded-2xl border p-3 text-left shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-all active:scale-[0.985]",
        inCombo
          ? "border-ink bg-ink text-white ring-2 ring-betclic-red/35"
          : "border-edge bg-white",
        pressing && "scale-[0.97] ring-2 ring-betclic-red/50"
      )}
    >
      <div>
        <div className="flex items-center justify-between gap-1.5">
          <span
            className={cn(
              "truncate text-[10px] font-semibold uppercase tracking-wide",
              inCombo ? "text-white/70" : "text-dim"
            )}
          >
            {pick.league}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
              inCombo ? "bg-white/15 text-emerald-300" : "bg-emerald-50 text-emerald-700"
            )}
          >
            IA {pick.matchScorePct}%
          </span>
        </div>
        <p className={cn("mt-1 truncate text-[12px] font-bold", inCombo ? "text-white" : "text-ink")}>
          {pick.homeTeam} – {pick.awayTeam}
        </p>
        <p className={cn("mt-0.5 truncate text-[11px] font-medium", inCombo ? "text-white/80" : "text-mist")}>
          {pick.selectionLabel}
        </p>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 pt-1">
        <span className={cn("truncate text-[10px]", inCombo ? "text-white/65" : "text-dim")}>
          {pick.reason}
        </span>
        <span className="shrink-0 rounded-lg bg-amber-400/90 px-2 py-0.5 font-display text-[11.5px] font-extrabold tabular-nums text-zinc-950">
          {formatOdds(pick.odds, oddsFormat)}
        </span>
      </div>
    </button>
  );
}
