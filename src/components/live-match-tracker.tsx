"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClientMatch } from "@/lib/api";
import { minuteNumber } from "@/lib/markets";
import { cn } from "@/lib/format";

function hashInt(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type ActionKind =
  | "goal"
  | "halftime"
  | "dangerous_attack"
  | "shot_on_target"
  | "corner"
  | "free_kick"
  | "attack"
  | "build_up";

interface PlaySnapshot {
  kind: ActionKind;
  side: "home" | "away" | "neutral";
  label: string;
  ballX: number; // 6 .. 94 (%)
  ballY: number; // 14 .. 86 (%)
  possessionHome: number;
  shotsHome: number;
  shotsAway: number;
  cornersHome: number;
  cornersAway: number;
}

function buildSnapshot(match: ClientMatch, beat: number): PlaySnapshot {
  const min = Math.max(1, minuteNumber(match.minute));
  const hGoals = match.homeScore ?? 0;
  const aGoals = match.awayScore ?? 0;
  const redH = match.redHome ?? 0;
  const redA = match.redAway ?? 0;

  // Force relative estimée depuis les cotes et les cartons rouges
  const pH = 1 / Math.max(1.05, match.oddsHome);
  const pA = 1 / Math.max(1.05, match.oddsAway);
  const rawHomeShare = pH / (pH + pA);
  const redShift = (redA - redH) * 0.06;
  const wave = (((hashInt(`poss|${match.id}|${Math.floor(min / 5)}`) % 9) - 4) * 0.01);
  const possessionHome = Math.min(72, Math.max(28, Math.round((rawHomeShare + redShift + wave) * 100)));

  // Statistiques cumulées monotones sur la durée écoulée (toujours >= nombre de buts !)
  let extraShotsH = 0;
  let extraShotsA = 0;
  let cornersH = 0;
  let cornersA = 0;

  for (let m = 1; m <= min; m++) {
    const r = hashInt(`stat|${match.id}|${m}`);
    const u1 = (r & 0xffff) / 65536;
    const u2 = ((r >>> 16) & 0xffff) / 65536;
    const domShare = possessionHome / 100;

    if (u1 < 0.085) {
      if (u2 < domShare) extraShotsH += 1;
      else extraShotsA += 1;
    } else if (u1 < 0.195) {
      if (u2 < domShare) cornersH += 1;
      else cornersA += 1;
    }
  }

  const shotsHome = hGoals + extraShotsH;
  const shotsAway = aGoals + extraShotsA;

  // Mi-temps
  if (match.minute === "MT" || match.minute === "HT") {
    return {
      kind: "halftime",
      side: "neutral",
      label: "Mi-temps · Pause au vestiaire",
      ballX: 50,
      ballY: 50,
      possessionHome,
      shotsHome,
      shotsAway,
      cornersHome: cornersH,
      cornersAway: cornersA,
    };
  }

  // But récent (marché suspendu ou but inscrit dans la minute courante)
  const events = match.events ?? [];
  const latestGoal = [...events]
    .reverse()
    .find((e) => e.type === "goal" && Math.abs(e.minute - min) <= 1);

  if (latestGoal && (match.suspended || latestGoal.minute === min)) {
    const isHome = latestGoal.team === "home";
    const teamName = isHome ? match.homeTeam : match.awayTeam;
    const scorer = latestGoal.player ? ` (${latestGoal.player})` : "";
    return {
      kind: "goal",
      side: isHome ? "home" : "away",
      label: `⚽ BUT ! ${teamName}${scorer}`,
      ballX: isHome ? 93 : 7,
      ballY: 50,
      possessionHome,
      shotsHome,
      shotsAway,
      cornersHome: cornersH,
      cornersAway: cornersA,
    };
  }

  // Séquence de jeu fluide toutes les ~3,5 secondes
  const seed = hashInt(`play|${match.id}|${min}|${beat}`);
  const sideRoll = (seed & 0xff) / 255;
  const actionRoll = ((seed >>> 8) & 0xff) / 255;
  const yRoll = ((seed >>> 16) & 0xff) / 255;

  const side: "home" | "away" = sideRoll < possessionHome / 100 ? "home" : "away";
  const team = side === "home" ? match.homeTeam : match.awayTeam;
  const dir = side === "home" ? 1 : -1; // domicile attaque vers la droite (x -> 90), extérieur vers la gauche (x -> 10)

  let kind: ActionKind = "build_up";
  let label = `Construction · ${team}`;
  let depth = 0.12; // distance depuis le rond central vers le but adverse (0..0.44)
  let ballY = 24 + yRoll * 52;

  if (actionRoll > 0.9) {
    kind = "shot_on_target";
    label = `Tir dangereux · ${team}`;
    depth = 0.37;
    ballY = 38 + yRoll * 24;
  } else if (actionRoll > 0.8) {
    kind = "corner";
    label = `Corner · ${team}`;
    depth = 0.42;
    ballY = yRoll > 0.5 ? 14 : 86;
  } else if (actionRoll > 0.66) {
    kind = "dangerous_attack";
    label = `Attaque dangereuse · ${team}`;
    depth = 0.33;
    ballY = 26 + yRoll * 48;
  } else if (actionRoll > 0.54) {
    kind = "free_kick";
    label = `Coup franc offensif · ${team}`;
    depth = 0.28;
    ballY = 25 + yRoll * 50;
  } else if (actionRoll > 0.28) {
    kind = "attack";
    label = `Attaque · ${team}`;
    depth = 0.21;
  } else {
    kind = "build_up";
    label = `Possession · ${team}`;
    depth = 0.06;
  }

  const ballX = Math.min(93, Math.max(7, Math.round(50 + dir * depth * 100)));

  return {
    kind,
    side,
    label,
    ballX,
    ballY: Math.round(ballY),
    possessionHome,
    shotsHome,
    shotsAway,
    cornersHome: cornersH,
    cornersAway: cornersA,
  };
}

export function LiveMatchTracker({
  match,
  className,
}: {
  match: ClientMatch;
  className?: string;
}) {
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      setBeat((b) => b + 1);
    }, 3_500);
    return () => clearInterval(id);
  }, []);

  const snap = useMemo(() => buildSnapshot(match, beat), [match, beat]);
  const isDanger =
    snap.kind === "goal" ||
    snap.kind === "dangerous_attack" ||
    snap.kind === "shot_on_target" ||
    snap.kind === "corner";

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "overflow-hidden rounded-2xl border border-emerald-900/20 bg-[#0d3b26] text-white shadow-xs",
        className
      )}
    >
      {/* Bandeau d'action live */}
      <div className="flex items-center justify-between gap-2 bg-black/25 px-3 py-1.5 text-[11px]">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              snap.kind === "goal"
                ? "animate-ping bg-amber-300"
                : isDanger
                  ? "live-dot bg-betclic-red"
                  : "bg-emerald-400"
            )}
          />
          <span className="truncate font-display font-bold tracking-tight text-white">
            {snap.label}
          </span>
        </div>
        <span className="shrink-0 font-display text-[10px] font-semibold uppercase tracking-wider text-emerald-200/80">
          Tracker 2D
        </span>
      </div>

      {/* Terrain 2D SVG avec zone de pression et ballon fluide */}
      <div className="relative h-[94px] w-full select-none overflow-hidden px-2 py-1.5">
        <svg
          viewBox="0 0 200 96"
          preserveAspectRatio="none"
          className="h-full w-full rounded-lg"
          aria-hidden
        >
          <defs>
            <linearGradient id={`home-atk-${match.id}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0" />
              <stop offset="100%" stopColor={isDanger ? "#ef4444" : "#34d399"} stopOpacity="0.34" />
            </linearGradient>
            <linearGradient id={`away-atk-${match.id}`} x1="100%" y1="0%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0" />
              <stop offset="100%" stopColor={isDanger ? "#ef4444" : "#38bdf8"} stopOpacity="0.34" />
            </linearGradient>
          </defs>

          {/* Bandes de pelouse */}
          <rect x="0" y="0" width="200" height="96" fill="#114b31" />
          {[0, 40, 80, 120, 160].map((x) => (
            <rect key={x} x={x} y="0" width="20" height="96" fill="#15583a" opacity="0.55" />
          ))}

          {/* Cône de pression offensive */}
          {snap.side === "home" && (
            <rect
              x="95"
              y="4"
              width={Math.max(25, (snap.ballX - 45) * 2)}
              height="88"
              fill={`url(#home-atk-${match.id})`}
            />
          )}
          {snap.side === "away" && (
            <rect
              x={Math.max(4, (snap.ballX - 5) * 2)}
              y="4"
              width={Math.max(25, (55 - snap.ballX) * 2)}
              height="88"
              fill={`url(#away-atk-${match.id})`}
            />
          )}

          {/* Marquages réglementaires */}
          <g stroke="rgba(255,255,255,0.42)" strokeWidth="1.2" fill="none">
            <rect x="4" y="4" width="192" height="88" rx="2" />
            <line x1="100" y1="4" x2="100" y2="92" />
            <circle cx="100" cy="48" r="14" />
            <circle cx="100" cy="48" r="1.4" fill="rgba(255,255,255,0.65)" />
            {/* Surface gauche (Domicile défend) */}
            <rect x="4" y="21" width="26" height="54" />
            <rect x="4" y="34" width="10" height="28" />
            {/* Surface droite (Extérieur défend) */}
            <rect x="170" y="21" width="26" height="54" />
            <rect x="186" y="34" width="10" height="28" />
          </g>
        </svg>

        {/* Repères discrets des camps */}
        <span className="pointer-events-none absolute bottom-2.5 left-4 max-w-[36%] truncate text-[9.5px] font-bold uppercase tracking-wider text-white/55">
          {match.homeTeam} →
        </span>
        <span className="pointer-events-none absolute bottom-2.5 right-4 max-w-[36%] truncate text-right text-[9.5px] font-bold uppercase tracking-wider text-white/55">
          ← {match.awayTeam}
        </span>

        {/* Ballon animé en douceur */}
        <div
          className="pointer-events-none absolute -ml-2.5 -mt-2.5 h-5 w-5 transition-all duration-700 ease-out"
          style={{
            left: `${snap.ballX}%`,
            top: `${snap.ballY}%`,
          }}
        >
          <span
            className={cn(
              "absolute inset-0 rounded-full opacity-55 blur-[3px]",
              snap.kind === "goal"
                ? "bg-amber-300"
                : isDanger
                  ? "bg-betclic-red"
                  : "bg-emerald-300"
            )}
          />
          <span className="relative grid h-5 w-5 place-items-center rounded-full border border-ink/40 bg-white text-[10px] leading-none shadow-md">
            ⚽
          </span>
        </div>
      </div>

      {/* Statistiques live compactes : Possession, Tirs cadrés, Corners */}
      <div className="grid grid-cols-3 divide-x divide-white/10 border-t border-white/10 bg-black/20 px-2 py-1.5 text-center text-[10.5px]">
        <div className="px-1">
          <p className="text-[9.5px] text-emerald-200/70">Possession</p>
          <p className="font-display font-bold tabular-nums text-white">
            {snap.possessionHome}% <span className="text-white/40">–</span> {100 - snap.possessionHome}%
          </p>
        </div>
        <div className="px-1">
          <p className="text-[9.5px] text-emerald-200/70">Tirs cadrés</p>
          <p className="font-display font-bold tabular-nums text-white">
            {snap.shotsHome} <span className="text-white/40">–</span> {snap.shotsAway}
          </p>
        </div>
        <div className="px-1">
          <p className="text-[9.5px] text-emerald-200/70">Corners</p>
          <p className="font-display font-bold tabular-nums text-white">
            {snap.cornersHome} <span className="text-white/40">–</span> {snap.cornersAway}
          </p>
        </div>
      </div>
    </div>
  );
}
