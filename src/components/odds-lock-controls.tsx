"use client";

import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, RefreshCw } from "lucide-react";
import { getLastPublicServerTime } from "@/lib/api";
import { cn, formatOdds } from "@/lib/format";
import {
  formatFeedAge,
  type OddsChangedDetails,
  type OddsChangePolicy,
} from "@/lib/odds-lock";

interface OddsLockControlsProps {
  feedKind: "matches" | "predictions";
  oddsFormat: "decimal" | "fractional";
  oddsPolicy: OddsChangePolicy;
  onChangePolicy: (policy: OddsChangePolicy) => void;
  oddsChanged: OddsChangedDetails | null;
  compact?: boolean;
}

export function OddsLockControls({
  feedKind,
  oddsFormat,
  oddsPolicy,
  onChangePolicy,
  oddsChanged,
  compact = false,
}: OddsLockControlsProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) return;
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const serverTime = getLastPublicServerTime(feedKind);
  const freshness = formatFeedAge(serverTime, nowMs);
  const acceptHigher = oddsPolicy === "accept_higher";

  return (
    <div
      className={cn(
        "space-y-2",
        oddsChanged ? (compact ? "mt-2" : "mt-2.5") : "hidden lg:block lg:mt-3"
      )}
    >
      {/* Bandeau permanent uniquement sur desktop (lg+) pour ne jamais encombrer le mobile */}
      <div className="hidden flex-wrap items-center justify-between gap-2 rounded-xl bg-elev/80 px-2.5 py-1.5 text-[10px] lg:flex">
        <div className="flex items-center gap-1.5 text-mist">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              !freshness
                ? "bg-mist/50"
                : freshness.isStale
                  ? "bg-amber-500"
                  : "bg-emerald-500"
            )}
          />
          <span className="tabular-nums">
            {freshness ? freshness.label : "Cotes synchronisées"}
          </span>
        </div>

        <label className="flex cursor-pointer select-none items-center gap-1.5 font-medium text-ink/85">
          <input
            type="checkbox"
            checked={acceptHigher}
            onChange={(e) =>
              onChangePolicy(e.target.checked ? "accept_higher" : "confirm_all")
            }
            className="h-3.5 w-3.5 rounded border-edge accent-betclic-red"
          />
          <span>Accepter les hausses</span>
        </label>
      </div>

      {/* Alerte affichée sur mobile & desktop UNIQUEMENT quand la cote a réellement varié */}
      {oddsChanged && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[10.5px]",
            oddsChanged.direction === "up"
              ? "border-emerald-500/35 bg-emerald-500/10 text-ink"
              : "border-amber-500/40 bg-amber-500/10 text-ink"
          )}
        >
          {oddsChanged.direction === "up" ? (
            <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <ArrowDownRight className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          )}
          <div className="min-w-0 flex-1 leading-snug">
            <p className="font-medium">
              {oddsChanged.direction === "up"
                ? "La cote a augmenté"
                : "La cote a évolué"}{" "}
              :{" "}
              <span className="line-through opacity-70 tabular-nums">
                {formatOdds(oddsChanged.previousOdds, oddsFormat)}
              </span>{" "}
              →{" "}
              <span className="font-medium tabular-nums text-betclic-red">
                {formatOdds(oddsChanged.currentOdds, oddsFormat)}
              </span>
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-mist">
              <RefreshCw className="h-3 w-3 shrink-0" />
              Aucun montant débité — confirmez la nouvelle cote.
            </p>
            <label className="mt-1.5 flex cursor-pointer select-none items-center gap-1.5 text-[10px] font-medium text-ink/85 lg:hidden">
              <input
                type="checkbox"
                checked={acceptHigher}
                onChange={(e) =>
                  onChangePolicy(e.target.checked ? "accept_higher" : "confirm_all")
                }
                className="h-3.5 w-3.5 rounded border-edge accent-betclic-red"
              />
              <span>Accepter automatiquement les prochaines hausses</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
