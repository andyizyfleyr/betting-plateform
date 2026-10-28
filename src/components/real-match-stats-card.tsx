"use client";

import { BarChart3 } from "lucide-react";
import type { ClientRealMatchStats } from "@/lib/api";
import { TeamAvatar } from "./team-avatar";
import { cn } from "@/lib/format";

export function hasAnyRealStats(stats?: ClientRealMatchStats | null): boolean {
  if (!stats) return false;
  return (
    stats.possessionHome != null ||
    stats.shotsTotalHome != null ||
    stats.shotsOnTargetHome != null ||
    stats.cornersHome != null ||
    stats.foulsHome != null ||
    stats.savesHome != null ||
    stats.offsidesHome != null ||
    stats.yellowCardsHome != null
  );
}

interface StatLine {
  key: string;
  label: string;
  left: string;
  right: string;
  leftShare: number;
}

function ratioShare(a: number, b: number): number {
  const sum = a + b;
  if (sum <= 0) return 50;
  return Math.round((a / sum) * 100);
}

export function buildRealStatLines(stats?: ClientRealMatchStats | null): StatLine[] {
  if (!stats) return [];
  const rows: StatLine[] = [];

  if (stats.possessionHome != null && stats.possessionAway != null) {
    rows.push({
      key: "possession",
      label: "Possession (%)",
      left: `${Math.round(stats.possessionHome)}%`,
      right: `${Math.round(stats.possessionAway)}%`,
      leftShare: ratioShare(stats.possessionHome, stats.possessionAway),
    });
  }
  if (stats.shotsOnTargetHome != null && stats.shotsOnTargetAway != null) {
    rows.push({
      key: "sot",
      label: "Tirs cadrés",
      left: String(stats.shotsOnTargetHome),
      right: String(stats.shotsOnTargetAway),
      leftShare: ratioShare(stats.shotsOnTargetHome, stats.shotsOnTargetAway),
    });
  }
  if (stats.shotsTotalHome != null && stats.shotsTotalAway != null) {
    rows.push({
      key: "shots",
      label: "Tirs totaux",
      left: String(stats.shotsTotalHome),
      right: String(stats.shotsTotalAway),
      leftShare: ratioShare(stats.shotsTotalHome, stats.shotsTotalAway),
    });
  }
  if (stats.cornersHome != null && stats.cornersAway != null) {
    rows.push({
      key: "corners",
      label: "Corners",
      left: String(stats.cornersHome),
      right: String(stats.cornersAway),
      leftShare: ratioShare(stats.cornersHome, stats.cornersAway),
    });
  }
  if (stats.foulsHome != null && stats.foulsAway != null) {
    rows.push({
      key: "fouls",
      label: "Fautes",
      left: String(stats.foulsHome),
      right: String(stats.foulsAway),
      leftShare: ratioShare(stats.foulsHome, stats.foulsAway),
    });
  }
  if (stats.savesHome != null && stats.savesAway != null) {
    rows.push({
      key: "saves",
      label: "Arrêts du gardien",
      left: String(stats.savesHome),
      right: String(stats.savesAway),
      leftShare: ratioShare(stats.savesHome, stats.savesAway),
    });
  }
  if (stats.offsidesHome != null && stats.offsidesAway != null) {
    rows.push({
      key: "offsides",
      label: "Hors-jeu",
      left: String(stats.offsidesHome),
      right: String(stats.offsidesAway),
      leftShare: ratioShare(stats.offsidesHome, stats.offsidesAway),
    });
  }
  if (stats.yellowCardsHome != null && stats.yellowCardsAway != null) {
    rows.push({
      key: "yellow",
      label: "Cartons jaunes",
      left: String(stats.yellowCardsHome),
      right: String(stats.yellowCardsAway),
      leftShare: ratioShare(stats.yellowCardsHome, stats.yellowCardsAway),
    });
  }

  return rows;
}

export function RealMatchStatsCard({
  stats,
  homeTeam,
  awayTeam,
  homeLogo,
  awayLogo,
  htHomeScore,
  htAwayScore,
  compact = false,
  className,
}: {
  stats?: ClientRealMatchStats | null;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  htHomeScore?: number | null;
  htAwayScore?: number | null;
  compact?: boolean;
  className?: string;
}) {
  const lines = buildRealStatLines(stats);
  const visibleLines = compact ? lines.slice(0, 5) : lines;
  const effHtH = htHomeScore ?? stats?.htHomeScore ?? null;
  const effHtA = htAwayScore ?? stats?.htAwayScore ?? null;

  if (visibleLines.length === 0 && (effHtH == null || effHtA == null)) {
    return null;
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "rounded-2xl border border-emerald-600/20 bg-surface p-3 shadow-xs",
        className
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-[10px]">
        <span className="inline-flex items-center gap-1.5 font-display font-medium text-emerald-700">
          <BarChart3 className="h-3.5 w-3.5" strokeWidth={2.3} />
          Statistiques officielles
        </span>
        {effHtH != null && effHtA != null && (
          <span className="rounded-md bg-elev px-2 py-0.5 font-display text-[10px] font-medium tabular-nums text-ink">
            MT {effHtH} - {effHtA}
          </span>
        )}
      </div>

      <div className="mb-2 flex items-center justify-between gap-2 text-[10px] font-medium text-dim">
        <span className="flex min-w-0 max-w-[46%] items-center gap-1.5">
          <TeamAvatar name={homeTeam} logo={homeLogo} size="2xs" />
          <span className="truncate">{homeTeam}</span>
        </span>
        <span className="flex min-w-0 max-w-[46%] items-center justify-end gap-1.5 text-right">
          <span className="truncate">{awayTeam}</span>
          <TeamAvatar name={awayTeam} logo={awayLogo} size="2xs" />
        </span>
      </div>

      <div className="space-y-2">
        {visibleLines.map((row) => (
          <div key={row.key} className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-display font-medium tabular-nums text-ink">
                {row.left}
              </span>
              <span className="text-[10px] font-medium text-mist">{row.label}</span>
              <span className="font-display font-medium tabular-nums text-ink">
                {row.right}
              </span>
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-elev">
              <div
                className="bg-emerald-600 transition-all duration-300"
                style={{ width: `${Math.max(6, Math.min(94, row.leftShare))}%` }}
              />
              <div className="flex-1 bg-ink/20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
