"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, Radio } from "lucide-react";
import type { ClientMatch, ClientMatchEvent } from "@/lib/api";
import {
  computeLivePlayFrame,
  computeMatchTelemetry,
  resolveMatchColors,
  type LiveMatchTelemetry,
  type LivePlayFrame,
  type MatchColors,
} from "@/lib/live-telemetry";
import { teamLogoCandidates } from "@/lib/team-logos";
import { sanitizeMatchEvents } from "@/lib/match-events";
import { cn, initials } from "@/lib/format";
import { useLiveMatchClockSnapshot } from "./live-match-clock";

type TrackerTab = "pitch" | "momentum" | "stats";

/** Coordonnées SVG panoramiques réglementaires (viewBox 340×112, terrain 316×100). */
const px = (pctX: number) => 12 + (pctX / 100) * 316;
const py = (pctY: number) => 6 + (pctY / 100) * 100;

export function LiveMatchTracker({
  match,
  defaultTab = "pitch",
  className,
}: {
  match: ClientMatch;
  defaultTab?: TrackerTab;
  className?: string;
}) {
  const [tab, setTab] = useState<TrackerTab>(defaultTab);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [pinnedEvent, setPinnedEvent] = useState<{ matchId: number; idx: number } | null>(null);

  const isFinished = match.status === "finished" || match.minute === "Terminé";

  // Animation fluide ~30 fps pilotée par requestAnimationFrame (zéro conflit de transition CSS)
  useEffect(() => {
    if (isFinished || tab !== "pitch") return;
    let rafId = 0;
    let lastTick = 0;

    const loop = (ts: number) => {
      if (typeof document === "undefined" || !document.hidden) {
        if (ts - lastTick >= 33) {
          lastTick = ts;
          setNowMs(Date.now());
        }
      }
      rafId = window.requestAnimationFrame(loop);
    };

    rafId = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(rafId);
  }, [isFinished, tab]);

  const colors = useMemo(
    () => resolveMatchColors(match.homeTeam, match.awayTeam),
    [match.homeTeam, match.awayTeam]
  );

  const telemetry: LiveMatchTelemetry = useMemo(
    () => match.telemetry ?? computeMatchTelemetry(match),
    [match]
  );

  const frame: LivePlayFrame = useMemo(
    () => computeLivePlayFrame(match, telemetry, nowMs),
    [match, telemetry, nowMs]
  );

  const isDanger =
    frame.kind === "goal" ||
    frame.kind === "shot_on_target" ||
    frame.kind === "dangerous_attack" ||
    frame.kind === "corner" ||
    frame.kind === "free_kick";

  const events = useMemo(
    () => sanitizeMatchEvents(match.events, match.homeScore, match.awayScore),
    [match.events, match.homeScore, match.awayScore]
  );
  const activePinIdx = pinnedEvent?.matchId === match.id ? pinnedEvent.idx : null;
  const activePinnedEvent: ClientMatchEvent | null =
    activePinIdx != null ? (events[activePinIdx] ?? null) : null;

  const homeCrests = useMemo(
    () => teamLogoCandidates(match.homeTeam, match.homeLogo),
    [match.homeTeam, match.homeLogo]
  );
  const awayCrests = useMemo(
    () => teamLogoCandidates(match.awayTeam, match.awayLogo),
    [match.awayTeam, match.awayLogo]
  );

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "overflow-hidden rounded-2xl border border-emerald-950/35 bg-[#09291b] text-white shadow-xs",
        className
      )}
    >
      {/* En-tête ultra-fin sur 1 seule ligne (~28 px) */}
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/35 px-2.5 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              frame.kind === "goal"
                ? "animate-ping bg-amber-300"
                : isDanger
                  ? "live-dot bg-betclic-red"
                  : isFinished
                    ? "bg-slate-400"
                    : "bg-emerald-400"
            )}
          />
          <span className="truncate font-display text-[10.5px] font-bold tracking-tight text-white">
            {frame.label}
          </span>
        </div>

        <div className="flex shrink-0 items-center rounded-lg bg-white/8 p-0.5">
          <TabPill
            active={tab === "pitch"}
            onClick={() => setTab("pitch")}
            icon={<Radio className="h-2.5 w-2.5" strokeWidth={2.4} />}
            label="2D"
          />
          <TabPill
            active={tab === "momentum"}
            onClick={() => setTab("momentum")}
            icon={<Activity className="h-2.5 w-2.5" strokeWidth={2.4} />}
            label="Pression"
          />
          <TabPill
            active={tab === "stats"}
            onClick={() => setTab("stats")}
            icon={<BarChart3 className="h-2.5 w-2.5" strokeWidth={2.4} />}
            label="Stats"
          />
        </div>
      </div>

      {/* Fenêtre principale compacte à hauteur fixe (~104 px : aucun saut d'écran) */}
      {tab === "pitch" && (
        <PitchRadarView
          match={match}
          frame={frame}
          colors={colors}
          homeCrests={homeCrests}
          awayCrests={awayCrests}
          isDanger={isDanger}
        />
      )}

      {tab === "momentum" && (
        <MomentumHistogramView
          match={match}
          telemetry={telemetry}
          colors={colors}
          events={events}
        />
      )}

      {tab === "stats" && (
        <DetailedStatsView telemetry={telemetry} colors={colors} />
      )}

      {/* Pied compact : frise 0'→90' interactive + 3 jauges clés sur 1 ligne */}
      <div className="border-t border-white/10 bg-black/25 px-2.5 py-1.5">
        <MatchTimelineStrip
          match={match}
          minute={telemetry.minute}
          isHalfTime={match.minute === "MT" || match.minute === "HT"}
          isFinished={isFinished}
          events={events}
          colors={colors}
          activePinIdx={activePinIdx}
          activePinnedEvent={activePinnedEvent}
          onSelectPin={(idx) =>
            setPinnedEvent((prev) =>
              prev && prev.matchId === match.id && prev.idx === idx
                ? null
                : { matchId: match.id, idx }
            )
          }
        />

        {tab !== "stats" && (
          <div className="mt-1.5 grid grid-cols-3 divide-x divide-white/10 border-t border-white/8 pt-1">
            <MiniStatGauge
              label="xG"
              leftText={telemetry.xgHome.toFixed(2)}
              rightText={telemetry.xgAway.toFixed(2)}
              leftVal={telemetry.xgHome}
              rightVal={telemetry.xgAway}
              colors={colors}
            />
            <MiniStatGauge
              label="Poss."
              leftText={`${telemetry.possessionHome}%`}
              rightText={`${telemetry.possessionAway}%`}
              leftVal={telemetry.possessionHome}
              rightVal={telemetry.possessionAway}
              colors={colors}
            />
            <MiniStatGauge
              label="Tirs"
              leftText={`${telemetry.shotsOnTargetHome}/${telemetry.shotsTotalHome}`}
              rightText={`${telemetry.shotsOnTargetAway}/${telemetry.shotsTotalAway}`}
              leftVal={telemetry.shotsOnTargetHome + telemetry.shotsTotalHome * 0.25}
              rightVal={telemetry.shotsOnTargetAway + telemetry.shotsTotalAway * 0.25}
              colors={colors}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TabPill({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-[6px] px-1.5 font-display text-[9.5px] font-bold transition-colors",
        active ? "bg-emerald-400 text-[#052e16]" : "text-emerald-100/75 hover:text-white"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/* ============================================================================
 * 1. VUE TERRAIN 2D PANORAMIQUE COMPACTE (~104 px) & MOUVEMENTS C¹ FLUIDES
 * ========================================================================== */

function PitchRadarView({
  match,
  frame,
  colors,
  homeCrests,
  awayCrests,
  isDanger,
}: {
  match: ClientMatch;
  frame: LivePlayFrame;
  colors: MatchColors;
  homeCrests: string[];
  awayCrests: string[];
  isDanger: boolean;
}) {
  const bx = px(frame.ballX);
  const by = py(frame.ballY);
  const fx = px(frame.fromX);
  const fy = py(frame.fromY);

  const activeColor =
    frame.side === "home"
      ? colors.homePrimary
      : frame.side === "away"
        ? colors.awayPrimary
        : "#34d399";

  const homeGoalFlash =
    (frame.kind === "goal" || frame.kind === "shot_on_target") && frame.side === "away";
  const awayGoalFlash =
    (frame.kind === "goal" || frame.kind === "shot_on_target") && frame.side === "home";

  const trajectoryPath = useMemo(() => {
    if (frame.trajectory === "none") return null;
    if (frame.trajectory === "cross") {
      const targetX = frame.side === "home" ? 296 : 44;
      const targetY = 56;
      const ctrlX = frame.side === "home" ? 274 : 66;
      const ctrlY = fy < 56 ? 26 : 86;
      return {
        d: `M ${fx.toFixed(1)} ${fy.toFixed(1)} Q ${ctrlX} ${ctrlY} ${targetX} ${targetY}`,
        targetX,
        targetY,
        dashed: true,
        hot: true,
      };
    }
    if (frame.trajectory === "free_kick") {
      const ctrlX = (fx + bx) / 2;
      const bendY = fy < 56 ? Math.max(12, fy - 14) : Math.min(100, fy + 14);
      return {
        d: `M ${fx.toFixed(1)} ${fy.toFixed(1)} Q ${ctrlX.toFixed(1)} ${bendY.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`,
        targetX: bx,
        targetY: by,
        dashed: false,
        hot: true,
      };
    }
    if (frame.trajectory === "shot") {
      const ctrlX = (fx + bx) / 2;
      const ctrlY = (fy + by) / 2 - 3.5;
      return {
        d: `M ${fx.toFixed(1)} ${fy.toFixed(1)} Q ${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`,
        targetX: bx,
        targetY: by,
        dashed: false,
        hot: true,
      };
    }
    const dist = Math.hypot(bx - fx, by - fy);
    if (dist < 3.5) return null;
    const midX = (fx + bx) / 2;
    const midY = (fy + by) / 2 - 2.5;
    return {
      d: `M ${fx.toFixed(1)} ${fy.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`,
      targetX: bx,
      targetY: by,
      dashed: true,
      hot: false,
    };
  }, [frame.trajectory, frame.side, bx, by, fx, fy]);

  const attackConePoints = useMemo(() => {
    if (frame.side === "neutral" || frame.kind === "halftime" || frame.kind === "fulltime") {
      return null;
    }
    if (frame.kind === "corner") {
      const goalSpotX = frame.side === "home" ? 296 : 44;
      return `${bx.toFixed(1)},${by.toFixed(1)} ${goalSpotX},36 ${goalSpotX},76`;
    }
    const goalX = frame.side === "home" ? 328 : 12;
    const spread = isDanger ? 25 : 18;
    return `${bx.toFixed(1)},${by.toFixed(1)} ${goalX},${56 - spread} ${goalX},${56 + spread}`;
  }, [frame.side, frame.kind, bx, by, isDanger]);

  const redHome = match.redHome ?? 0;
  const redAway = match.redAway ?? 0;
  const sport = (match.sport ?? "football").toLowerCase();

  return (
    <div className="relative h-[104px] w-full select-none px-2 py-1.5">
      <div className="relative h-full w-full overflow-hidden rounded-lg bg-[#0d4228] ring-1 ring-white/12">
        <svg
          viewBox="0 0 340 112"
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
          aria-hidden
        >
          <defs>
            <radialGradient id={`lights-${match.id}`} cx="50%" cy="50%" r="62%">
              <stop offset="0%" stopColor="#1c7c4d" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#04190f" stopOpacity="0.42" />
            </radialGradient>

            <linearGradient
              id={`cone-${match.id}`}
              x1={frame.side === "home" ? "0%" : "100%"}
              y1="50%"
              x2={frame.side === "home" ? "100%" : "0%"}
              y2="50%"
            >
              <stop
                offset="0%"
                stopColor={isDanger ? "#ef4444" : activeColor}
                stopOpacity="0.3"
              />
              <stop
                offset="100%"
                stopColor={isDanger ? "#f97316" : activeColor}
                stopOpacity="0.03"
              />
            </linearGradient>

            <pattern
              id={`net-${match.id}`}
              width="3"
              height="3"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 0 0 L 3 3 M 3 0 L 0 3"
                stroke="rgba(255,255,255,0.32)"
                strokeWidth="0.4"
              />
            </pattern>
          </defs>

          {sport === "basketball" ? (
            <BasketballSurface colors={colors} />
          ) : sport === "tennis" ? (
            <TennisSurface />
          ) : (
            <FootballSurface
              matchId={match.id}
              colors={colors}
              homeCrests={homeCrests}
              awayCrests={awayCrests}
              homeGoalFlash={homeGoalFlash}
              awayGoalFlash={awayGoalFlash}
              dangerSide={isDanger ? frame.side : "neutral"}
            />
          )}

          {attackConePoints && (
            <polygon points={attackConePoints} fill={`url(#cone-${match.id})`} />
          )}

          {frame.kind === "corner" && (
            <circle
              cx={frame.side === "home" ? 296 : 44}
              cy="56"
              r="9"
              fill="rgba(250,204,21,0.14)"
              stroke="#fde047"
              strokeWidth="0.9"
              strokeDasharray="2.5 2"
            />
          )}

          {frame.wall && (
            <g>
              {[-5, 0, 5].map((dy, idx) => (
                <circle
                  key={idx}
                  cx={px(frame.wall!.x)}
                  cy={py(frame.wall!.y) + dy}
                  r="2.4"
                  fill={frame.wall!.side === "home" ? colors.homePrimary : colors.awayPrimary}
                  stroke="#ffffff"
                  strokeWidth="0.8"
                />
              ))}
            </g>
          )}

          {trajectoryPath && (
            <g>
              <path
                d={trajectoryPath.d}
                fill="none"
                stroke={trajectoryPath.hot ? "#fde047" : "rgba(255,255,255,0.68)"}
                strokeWidth={trajectoryPath.hot ? "1.6" : "1.1"}
                strokeDasharray={trajectoryPath.dashed ? "3.5 2.5" : undefined}
                strokeLinecap="round"
              />
              {trajectoryPath.hot && (
                <circle
                  cx={trajectoryPath.targetX}
                  cy={trajectoryPath.targetY}
                  r="4"
                  fill="none"
                  stroke="#fde047"
                  strokeWidth="0.9"
                  opacity="0.8"
                />
              )}
            </g>
          )}

          {/* Blocs tactiques coordonnés en C¹ (aucune transition CSS parasite) */}
          {sport === "football" &&
            frame.players.map((p) => {
              const cx = px(p.x);
              const cy = py(p.y);
              const fill = p.team === "home" ? colors.homePrimary : colors.awayPrimary;
              const txt = p.team === "home" ? colors.homeText : colors.awayText;
              return (
                <g
                  key={p.id}
                  transform={`translate(${cx.toFixed(2)}, ${cy.toFixed(2)})`}
                >
                  {p.isCarrier && (
                    <circle
                      cx="0"
                      cy="0"
                      r="5.6"
                      fill="none"
                      stroke="#fde047"
                      strokeWidth="0.95"
                      opacity="0.9"
                    />
                  )}
                  <circle
                    cx="0"
                    cy="0"
                    r={p.role === "gk" ? "3.3" : p.isCarrier ? "3.6" : "3.1"}
                    fill={fill}
                    stroke={p.role === "gk" ? "#fde047" : "rgba(15,23,42,0.85)"}
                    strokeWidth={p.role === "gk" ? "1" : "0.8"}
                  />
                  <text
                    x="0"
                    y="1.2"
                    textAnchor="middle"
                    fontSize="3.4"
                    fontWeight="800"
                    fill={txt}
                  >
                    {p.number}
                  </text>
                </g>
              );
            })}

          {/* Ballon vectoriel fluide */}
          <g transform={`translate(${bx.toFixed(2)}, ${by.toFixed(2)})`}>
            <circle
              cx="0"
              cy="0"
              r={isDanger ? "7.2" : "5.4"}
              fill={
                frame.kind === "goal"
                  ? "rgba(250,204,21,0.4)"
                  : isDanger
                    ? "rgba(239,68,68,0.34)"
                    : "rgba(52,211,153,0.26)"
              }
            />
            <circle cx="0.6" cy="1" r="2.9" fill="rgba(0,0,0,0.42)" />
            <circle cx="0" cy="0" r="2.9" fill="#ffffff" stroke="#0f172a" strokeWidth="0.7" />
            <polygon points="0,-1.4 1.3,-0.4 0.8,1.2 -0.8,1.2 -1.3,-0.4" fill="#0f172a" />
          </g>
        </svg>

        {/* Repères d'attaque discrets intégrés aux coins du terrain (zéro hauteur ajoutée) */}
        <div className="pointer-events-none absolute bottom-1 left-2 flex items-center gap-1 rounded bg-black/40 px-1.5 py-0.5 text-[8.5px] font-bold text-white/90">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: colors.homePrimary }}
          />
          <span>{initials(match.homeTeam)} →</span>
          {redHome > 0 && <span className="text-red-300">({11 - redHome}j)</span>}
        </div>
        <div className="pointer-events-none absolute bottom-1 right-2 flex items-center gap-1 rounded bg-black/40 px-1.5 py-0.5 text-[8.5px] font-bold text-white/90">
          {redAway > 0 && <span className="text-red-300">({11 - redAway}j)</span>}
          <span>← {initials(match.awayTeam)}</span>
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: colors.awayPrimary }}
          />
        </div>

        {/* Bandeau compact d'événement majeur */}
        {frame.banner && (
          <div className="pointer-events-none absolute inset-x-3 top-1.5 flex justify-center">
            <div
              className={cn(
                "flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-0.5 text-center shadow-md backdrop-blur-sm",
                frame.banner.type === "goal"
                  ? "border-amber-300/75 bg-black/80 text-amber-200"
                  : frame.banner.type === "red_card"
                    ? "border-red-400/75 bg-red-950/90 text-red-100"
                    : "border-amber-400/50 bg-black/75 text-amber-100"
              )}
            >
              <span className="truncate font-display text-[10px] font-extrabold">
                {frame.banner.title}
              </span>
              <span className="truncate text-[9px] font-semibold text-white/85">
                · {frame.banner.subtitle}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SvgClubCrest({
  candidates,
  x,
  y,
}: {
  candidates: string[];
  x: number;
  y: number;
}) {
  const key = candidates.join("|");
  const [attempt, setAttempt] = useState<{ key: string; idx: number }>({
    key,
    idx: 0,
  });
  const idx = attempt.key === key ? attempt.idx : 0;
  const href = candidates[idx];
  if (!href) return null;

  return (
    <image
      href={href}
      x={x}
      y={y}
      width="30"
      height="30"
      opacity="0.14"
      preserveAspectRatio="xMidYMid meet"
      onError={() =>
        setAttempt((prev) => ({
          key,
          idx: (prev.key === key ? prev.idx : 0) + 1,
        }))
      }
    />
  );
}

function FootballSurface({
  matchId,
  colors,
  homeCrests,
  awayCrests,
  homeGoalFlash,
  awayGoalFlash,
  dangerSide,
}: {
  matchId: number;
  colors: MatchColors;
  homeCrests: string[];
  awayCrests: string[];
  homeGoalFlash: boolean;
  awayGoalFlash: boolean;
  dangerSide: "home" | "away" | "neutral";
}) {
  return (
    <g>
      <rect x="0" y="0" width="340" height="112" fill="#0d4228" />
      {Array.from({ length: 10 }).map((_, i) => (
        <rect
          key={i}
          x={12 + i * 31.6}
          y="6"
          width="15.8"
          height="100"
          fill="#125334"
          opacity="0.56"
        />
      ))}
      <rect x="0" y="0" width="340" height="112" fill={`url(#lights-${matchId})`} />

      <rect x="10.2" y="6" width="1.8" height="100" fill={colors.homePrimary} opacity="0.85" />
      <rect x="328" y="6" width="1.8" height="100" fill={colors.awayPrimary} opacity="0.85" />

      <SvgClubCrest candidates={homeCrests} x={78} y={41} />
      <SvgClubCrest candidates={awayCrests} x={232} y={41} />

      {dangerSide === "home" && (
        <rect x="284" y="26" width="44" height="60" fill="rgba(239,68,68,0.16)" />
      )}
      {dangerSide === "away" && (
        <rect x="12" y="26" width="44" height="60" fill="rgba(239,68,68,0.16)" />
      )}

      {/* Cages 3D & filets */}
      <rect
        x="4.5"
        y="47"
        width="7.5"
        height="18"
        rx="1"
        fill={homeGoalFlash ? "rgba(250,204,21,0.45)" : `url(#net-${matchId})`}
        stroke={homeGoalFlash ? "#fde047" : "rgba(255,255,255,0.72)"}
        strokeWidth={homeGoalFlash ? "1.3" : "0.9"}
      />
      <rect
        x="328"
        y="47"
        width="7.5"
        height="18"
        rx="1"
        fill={awayGoalFlash ? "rgba(250,204,21,0.45)" : `url(#net-${matchId})`}
        stroke={awayGoalFlash ? "#fde047" : "rgba(255,255,255,0.72)"}
        strokeWidth={awayGoalFlash ? "1.3" : "0.9"}
      />

      {/* Marquages réglementaires proportionnés */}
      <g stroke="rgba(255,255,255,0.5)" strokeWidth="1" fill="none">
        <rect x="12" y="6" width="316" height="100" rx="1" />
        <line x1="170" y1="6" x2="170" y2="106" />
        <circle cx="170" cy="56" r="15.5" />
        <circle cx="170" cy="56" r="1.4" fill="rgba(255,255,255,0.8)" />

        <rect x="12" y="26" width="44" height="60" />
        <rect x="12" y="41" width="15" height="30" />
        <rect x="284" y="26" width="44" height="60" />
        <rect x="313" y="41" width="15" height="30" />

        <circle cx="44" cy="56" r="1.2" fill="rgba(255,255,255,0.8)" />
        <circle cx="296" cy="56" r="1.2" fill="rgba(255,255,255,0.8)" />

        <path d="M 56 46.2 A 15.5 15.5 0 0 1 56 65.8" />
        <path d="M 284 46.2 A 15.5 15.5 0 0 0 284 65.8" />

        <path d="M 16.5 6 A 4.5 4.5 0 0 1 12 10.5" />
        <path d="M 12 101.5 A 4.5 4.5 0 0 1 16.5 106" />
        <path d="M 323.5 6 A 4.5 4.5 0 0 0 328 10.5" />
        <path d="M 328 101.5 A 4.5 4.5 0 0 0 323.5 106" />
      </g>
    </g>
  );
}

function BasketballSurface({ colors }: { colors: MatchColors }) {
  return (
    <g>
      <rect x="0" y="0" width="340" height="112" fill="#78350f" />
      <rect x="12" y="6" width="316" height="100" fill="#92400e" stroke="#fde68a" strokeWidth="1.1" />
      <rect x="12" y="39" width="48" height="34" fill={colors.homePrimary} opacity="0.35" stroke="#fde68a" strokeWidth="1" />
      <rect x="280" y="39" width="48" height="34" fill={colors.awayPrimary} opacity="0.35" stroke="#fde68a" strokeWidth="1" />
      <line x1="170" y1="6" x2="170" y2="106" stroke="#fde68a" strokeWidth="1.1" />
      <circle cx="170" cy="56" r="14" fill="none" stroke="#fde68a" strokeWidth="1.1" />
      <path d="M 12 14 A 46 46 0 0 1 12 98" fill="none" stroke="#fde68a" strokeWidth="1.1" />
      <path d="M 328 14 A 46 46 0 0 0 328 98" fill="none" stroke="#fde68a" strokeWidth="1.1" />
    </g>
  );
}

function TennisSurface() {
  return (
    <g>
      <rect x="0" y="0" width="340" height="112" fill="#172554" />
      <rect x="22" y="12" width="296" height="88" fill="#1d4ed8" stroke="#ffffff" strokeWidth="1.1" />
      <line x1="22" y1="22" x2="318" y2="22" stroke="#ffffff" strokeWidth="0.8" />
      <line x1="22" y1="90" x2="318" y2="90" stroke="#ffffff" strokeWidth="0.8" />
      <line x1="94" y1="22" x2="94" y2="90" stroke="#ffffff" strokeWidth="0.8" />
      <line x1="246" y1="22" x2="246" y2="90" stroke="#ffffff" strokeWidth="0.8" />
      <line x1="94" y1="56" x2="246" y2="56" stroke="#ffffff" strokeWidth="0.8" />
      <line x1="170" y1="9" x2="170" y2="103" stroke="#fde047" strokeWidth="1.4" strokeDasharray="3 2" />
    </g>
  );
}

/* ============================================================================
 * 2. VUE MOMENTUM COMPACTE (Même hauteur 104 px que le Terrain 2D)
 * ========================================================================== */

function MomentumHistogramView({
  match,
  telemetry,
  colors,
  events,
}: {
  match: ClientMatch;
  telemetry: LiveMatchTelemetry;
  colors: MatchColors;
  events: ClientMatchEvent[];
}) {
  return (
    <div className="flex h-[104px] flex-col justify-between px-2.5 py-1.5">
      <div className="flex items-center justify-between gap-2 text-[9.5px]">
        <span className="flex items-center gap-1 font-display font-bold text-white">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: colors.homePrimary }}
          />
          {initials(match.homeTeam)}
        </span>
        <span className="rounded-full bg-white/10 px-2 py-0.2 text-[9px] font-semibold text-emerald-100">
          10 dern. min :{" "}
          <strong className="text-white">{telemetry.recentHomePressure}%</strong> –{" "}
          <strong className="text-white">{100 - telemetry.recentHomePressure}%</strong>
        </span>
        <span className="flex items-center gap-1 font-display font-bold text-white">
          {initials(match.awayTeam)}
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: colors.awayPrimary }}
          />
        </span>
      </div>

      <div className="relative h-[74px] w-full overflow-hidden rounded-lg border border-white/10 bg-black/30 px-1.5 py-1">
        <svg viewBox="0 0 320 76" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
          <line x1="6" y1="38" x2="314" y2="38" stroke="rgba(255,255,255,0.25)" strokeWidth="0.9" />
          <line
            x1="160"
            y1="4"
            x2="160"
            y2="72"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth="0.9"
            strokeDasharray="2.5 2.5"
          />

          {telemetry.momentum.map((b, i) => {
            const slotW = 304 / 18;
            const barW = slotW - 3;
            const x = 8 + i * slotW + 1.5;

            if (!b.played) {
              return (
                <rect
                  key={b.minuteEnd}
                  x={x}
                  y={36}
                  width={barW}
                  height={4}
                  rx="1.5"
                  fill="rgba(255,255,255,0.08)"
                />
              );
            }

            const isHome = b.value >= 0;
            const h = Math.max(4, (Math.abs(b.value) / 100) * 31);
            const y = isHome ? 38 - h : 38;
            const bucketStart = b.minuteEnd - 4;
            const hasGoal = events.some(
              (ev) => ev.type === "goal" && ev.minute >= bucketStart && ev.minute <= b.minuteEnd
            );

            return (
              <g key={b.minuteEnd}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  rx="2"
                  fill={isHome ? colors.homePrimary : colors.awayPrimary}
                  opacity={Math.abs(b.value) > 55 ? "0.96" : "0.78"}
                />
                {hasGoal && (
                  <circle
                    cx={x + barW / 2}
                    cy={isHome ? Math.max(4, y - 3.5) : Math.min(72, y + h + 3.5)}
                    r="2.4"
                    fill="#fde047"
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ============================================================================
 * 3. VUE STATS COMPACTE EN GRILLE 2×3 (~104 px)
 * ========================================================================== */

function DetailedStatsView({
  telemetry,
  colors,
}: {
  telemetry: LiveMatchTelemetry;
  colors: MatchColors;
}) {
  const items = [
    {
      label: "xG",
      leftText: telemetry.xgHome.toFixed(2),
      rightText: telemetry.xgAway.toFixed(2),
      leftVal: telemetry.xgHome,
      rightVal: telemetry.xgAway,
    },
    {
      label: "Possession",
      leftText: `${telemetry.possessionHome}%`,
      rightText: `${telemetry.possessionAway}%`,
      leftVal: telemetry.possessionHome,
      rightVal: telemetry.possessionAway,
    },
    {
      label: "Tirs cadrés",
      leftText: String(telemetry.shotsOnTargetHome),
      rightText: String(telemetry.shotsOnTargetAway),
      leftVal: telemetry.shotsOnTargetHome,
      rightVal: telemetry.shotsOnTargetAway,
    },
    {
      label: "Tirs totaux",
      leftText: String(telemetry.shotsTotalHome),
      rightText: String(telemetry.shotsTotalAway),
      leftVal: telemetry.shotsTotalHome,
      rightVal: telemetry.shotsTotalAway,
    },
    {
      label: "Attaques dang.",
      leftText: String(telemetry.dangerousAttacksHome),
      rightText: String(telemetry.dangerousAttacksAway),
      leftVal: telemetry.dangerousAttacksHome,
      rightVal: telemetry.dangerousAttacksAway,
    },
    {
      label: "Corners · Arrêts",
      leftText: `${telemetry.cornersHome}·${telemetry.savesHome}`,
      rightText: `${telemetry.cornersAway}·${telemetry.savesAway}`,
      leftVal: telemetry.cornersHome + telemetry.savesHome,
      rightVal: telemetry.cornersAway + telemetry.savesAway,
    },
  ];

  return (
    <div className="grid h-[104px] grid-cols-2 content-center gap-x-3 gap-y-2 px-3 py-1.5">
      {items.map((r) => {
        const total = r.leftVal + r.rightVal;
        const leftPct = total > 0 ? Math.round((r.leftVal / total) * 100) : 50;
        return (
          <div key={r.label}>
            <div className="mb-0.5 flex items-center justify-between text-[9.5px] tabular-nums">
              <span className="font-display font-bold text-white">{r.leftText}</span>
              <span className="truncate px-1 text-[9px] text-emerald-100/75">{r.label}</span>
              <span className="font-display font-bold text-white">{r.rightText}</span>
            </div>
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-white/12">
              <div
                className="h-full"
                style={{ width: `${leftPct}%`, backgroundColor: colors.homePrimary }}
              />
              <div
                className="h-full"
                style={{ width: `${100 - leftPct}%`, backgroundColor: colors.awayPrimary }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================================
 * 4. FRISE CHRONOLOGIQUE SUR 1 LIGNE & JAUGES RAPIDES ULTRA-FINES
 * ========================================================================== */

function MatchTimelineStrip({
  match,
  minute,
  isHalfTime,
  isFinished,
  events,
  colors,
  activePinIdx,
  activePinnedEvent,
  onSelectPin,
}: {
  match: ClientMatch;
  minute: number;
  isHalfTime: boolean;
  isFinished: boolean;
  events: ClientMatchEvent[];
  colors: MatchColors;
  activePinIdx: number | null;
  activePinnedEvent: ClientMatchEvent | null;
  onSelectPin: (idx: number) => void;
}) {
  const liveClock = useLiveMatchClockSnapshot(match, match.minute);
  const progressPct = isFinished
    ? 100
    : match.status === "live"
      ? Math.min(100, Math.max(2, liveClock.progressPct))
      : Math.min(100, Math.max(2, (minute / 90) * 100));
  const rightClockLabel = isFinished
    ? "90’"
    : match.status === "live"
      ? liveClock.display
      : isHalfTime
        ? "MT"
        : `${minute}’`;

  return (
    <div>
      {activePinnedEvent && (
        <div className="mb-1 flex justify-center">
          <span className="truncate rounded-full bg-white/14 px-2 py-0.2 font-display text-[9.5px] font-bold text-amber-200">
            {activePinnedEvent.minute}’ ·{" "}
            {activePinnedEvent.type === "red_card" ? "🟥 Rouge" : "⚽ But"}{" "}
            {activePinnedEvent.player ? `${activePinnedEvent.player} ` : ""}(
            {activePinnedEvent.team === "home" ? match.homeTeam : match.awayTeam})
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 text-[9px] font-semibold tabular-nums text-emerald-100/70">
        <span>0’</span>
        <div className="relative h-3 flex-1">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/14">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="pointer-events-none absolute left-1/2 top-1/2 h-2 w-[1px] -translate-x-1/2 -translate-y-1/2 bg-white/40" />

          {!isFinished && (
            <span
              className="pointer-events-none absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-emerald-300"
              style={{ left: `${progressPct}%` }}
            />
          )}

          {events.map((ev, idx) => {
            if (ev.type !== "goal" && ev.type !== "red_card") return null;
            const left = Math.min(98, Math.max(2, (ev.minute / 90) * 100));
            const isHome = ev.team === "home";
            const selected = activePinIdx === idx;
            return (
              <button
                key={`${ev.type}-${ev.minute}-${idx}`}
                type="button"
                onClick={() => onSelectPin(idx)}
                style={{
                  left: `${left}%`,
                  borderColor: isHome ? colors.homePrimary : colors.awayPrimary,
                }}
                className={cn(
                  "absolute top-1/2 grid h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bg-[#082216] text-[7.5px] leading-none transition-transform",
                  selected && "scale-125 ring-1 ring-amber-300"
                )}
              >
                {ev.type === "red_card" ? "🟥" : "⚽"}
              </button>
            );
          })}
        </div>
        <span className="tabular-nums">{rightClockLabel}</span>
      </div>
    </div>
  );
}

function MiniStatGauge({
  label,
  leftText,
  rightText,
  leftVal,
  rightVal,
  colors,
}: {
  label: string;
  leftText: string;
  rightText: string;
  leftVal: number;
  rightVal: number;
  colors: MatchColors;
}) {
  const sum = leftVal + rightVal;
  const leftPct = sum > 0 ? Math.round((leftVal / sum) * 100) : 50;

  return (
    <div className="px-1.5">
      <div className="flex items-center justify-between gap-1 text-[9.5px] tabular-nums">
        <span className="font-display font-bold text-white">{leftText}</span>
        <span className="text-[8.5px] font-medium text-emerald-200/75">{label}</span>
        <span className="font-display font-bold text-white">{rightText}</span>
      </div>
      <div className="mt-0.5 flex h-1 w-full overflow-hidden rounded-full bg-white/12">
        <div
          className="h-full"
          style={{ width: `${leftPct}%`, backgroundColor: colors.homePrimary }}
        />
        <div
          className="h-full"
          style={{ width: `${100 - leftPct}%`, backgroundColor: colors.awayPrimary }}
        />
      </div>
    </div>
  );
}
