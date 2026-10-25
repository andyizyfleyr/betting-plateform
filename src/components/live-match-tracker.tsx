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
import { teamLogo } from "@/lib/team-logos";
import { cn, initials } from "@/lib/format";

type TrackerTab = "pitch" | "momentum" | "stats";

/** Convertit % terrain (0..100) en coordonnées SVG réglementaires (viewBox 320×198). */
const px = (pctX: number) => 12 + (pctX / 100) * 296;
const py = (pctY: number) => 8 + (pctY / 100) * 182;

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

  // Cadence temps réel (~110 ms) alignée sur l'horloge du moteur serveur, en pause hors-écran
  useEffect(() => {
    if (isFinished) return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      setNowMs(Date.now());
    }, 110);
    return () => clearInterval(id);
  }, [isFinished]);

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

  const events = useMemo(() => match.events ?? [], [match.events]);
  const activePinIdx = pinnedEvent?.matchId === match.id ? pinnedEvent.idx : null;
  const activePinnedEvent: ClientMatchEvent | null =
    activePinIdx != null ? (events[activePinIdx] ?? null) : null;

  const homeCrest = teamLogo(match.homeTeam) || match.homeLogo || null;
  const awayCrest = teamLogo(match.awayTeam) || match.awayLogo || null;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "overflow-hidden rounded-2xl border border-emerald-950/35 bg-[#09291b] text-white shadow-sm",
        className
      )}
    >
      {/* En-tête broadcast : statut de l'action en direct + sélecteur 3 vues */}
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/35 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                frame.kind === "goal"
                  ? "animate-ping bg-amber-300"
                  : isDanger
                    ? "live-dot bg-betclic-red"
                    : isFinished
                      ? "bg-slate-400"
                      : "bg-emerald-400"
              )}
            />
            <span className="truncate font-display text-[11.5px] font-bold tracking-tight text-white">
              {frame.label}
            </span>
          </div>
          <p className="truncate pl-3.5 text-[10px] font-medium text-emerald-200/75">
            {frame.sublabel}
          </p>
        </div>

        <div className="flex shrink-0 items-center rounded-xl bg-white/8 p-0.5">
          <TabPill
            active={tab === "pitch"}
            onClick={() => setTab("pitch")}
            icon={<Radio className="h-3 w-3" strokeWidth={2.3} />}
            label="2D"
          />
          <TabPill
            active={tab === "momentum"}
            onClick={() => setTab("momentum")}
            icon={<Activity className="h-3 w-3" strokeWidth={2.3} />}
            label="Pression"
          />
          <TabPill
            active={tab === "stats"}
            onClick={() => setTab("stats")}
            icon={<BarChart3 className="h-3 w-3" strokeWidth={2.3} />}
            label="Stats"
          />
        </div>
      </div>

      {/* Corps principal à hauteur maîtrisée (aucun saut vertical au changement d'onglet) */}
      {tab === "pitch" && (
        <PitchRadarView
          match={match}
          frame={frame}
          colors={colors}
          homeCrest={homeCrest}
          awayCrest={awayCrest}
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
        <DetailedStatsView match={match} telemetry={telemetry} colors={colors} />
      )}

      {/* Frise chronologique interactive 0' → 45' → 90' avec marqueurs buts & cartons */}
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

      {/* Jauges comparatives rapides (affichées sous Terrain 2D & Pression) */}
      {tab !== "stats" && (
        <div className="grid grid-cols-3 divide-x divide-white/10 border-t border-white/10 bg-black/30 px-2 py-2">
          <MiniStatGauge
            label="xG (Occasions)"
            leftText={telemetry.xgHome.toFixed(2)}
            rightText={telemetry.xgAway.toFixed(2)}
            leftVal={telemetry.xgHome}
            rightVal={telemetry.xgAway}
            colors={colors}
          />
          <MiniStatGauge
            label="Possession"
            leftText={`${telemetry.possessionHome}%`}
            rightText={`${telemetry.possessionAway}%`}
            leftVal={telemetry.possessionHome}
            rightVal={telemetry.possessionAway}
            colors={colors}
          />
          <MiniStatGauge
            label="Tirs cadrés"
            leftText={`${telemetry.shotsOnTargetHome}/${telemetry.shotsTotalHome}`}
            rightText={`${telemetry.shotsOnTargetAway}/${telemetry.shotsTotalAway}`}
            leftVal={telemetry.shotsOnTargetHome + telemetry.shotsTotalHome * 0.25}
            rightVal={telemetry.shotsOnTargetAway + telemetry.shotsTotalAway * 0.25}
            colors={colors}
          />
        </div>
      )}
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
        "inline-flex h-6.5 items-center gap-1 rounded-[9px] px-2 font-display text-[10px] font-bold transition-colors",
        active ? "bg-emerald-400 text-[#052e16] shadow-xs" : "text-emerald-100/75 hover:text-white"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/* ============================================================================
 * 1. VUE TERRAIN 2D HAUTE PRÉCISION (Ratio réglementaire, cônes, pions, ballon)
 * ========================================================================== */

function PitchRadarView({
  match,
  frame,
  colors,
  homeCrest,
  awayCrest,
  isDanger,
}: {
  match: ClientMatch;
  frame: LivePlayFrame;
  colors: MatchColors;
  homeCrest: string | null;
  awayCrest: string | null;
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

  // Courbe Bézier pour centres de corner, coups francs enroulés et passes aériennes
  const trajectoryPath = useMemo(() => {
    if (frame.trajectory === "none") return null;
    if (frame.trajectory === "cross") {
      // Corner brossé du poteau de corner vers le point de penalty adverse
      const targetX = frame.side === "home" ? 277 : 43;
      const targetY = 99;
      const ctrlX = frame.side === "home" ? 256 : 64;
      const ctrlY = by < 99 ? 54 : 144;
      return {
        d: `M ${bx.toFixed(1)} ${by.toFixed(1)} Q ${ctrlX} ${ctrlY} ${targetX} ${targetY}`,
        targetX,
        targetY,
        dashed: true,
        hot: true,
      };
    }
    if (frame.trajectory === "free_kick") {
      const ctrlX = (fx + bx) / 2;
      const bendY = fy < 99 ? Math.max(20, fy - 24) : Math.min(178, fy + 24);
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
      const ctrlY = (fy + by) / 2 - 6;
      return {
        d: `M ${fx.toFixed(1)} ${fy.toFixed(1)} Q ${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`,
        targetX: bx,
        targetY: by,
        dashed: false,
        hot: true,
      };
    }
    // Passe de construction / progression
    const dist = Math.hypot(bx - fx, by - fy);
    if (dist < 4) return null;
    const midX = (fx + bx) / 2;
    const midY = (fy + by) / 2 - 4;
    return {
      d: `M ${fx.toFixed(1)} ${fy.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`,
      targetX: bx,
      targetY: by,
      dashed: true,
      hot: false,
    };
  }, [frame.trajectory, frame.side, bx, by, fx, fy]);

  // Cône radar directionnel (orienté vers la surface adverse)
  const attackConePoints = useMemo(() => {
    if (frame.side === "neutral" || frame.kind === "halftime" || frame.kind === "fulltime") {
      return null;
    }
    if (frame.kind === "corner") {
      const goalSpotX = frame.side === "home" ? 277 : 43;
      return `${bx.toFixed(1)},${by.toFixed(1)} ${goalSpotX},66 ${goalSpotX},132`;
    }
    const goalX = frame.side === "home" ? 308 : 12;
    const spread = isDanger ? 42 : 30;
    return `${bx.toFixed(1)},${by.toFixed(1)} ${goalX},${99 - spread} ${goalX},${99 + spread}`;
  }, [frame.side, frame.kind, bx, by, isDanger]);

  const redHome = match.redHome ?? 0;
  const redAway = match.redAway ?? 0;
  const sport = (match.sport ?? "football").toLowerCase();

  return (
    <div className="relative w-full select-none px-2.5 pb-1.5 pt-2">
      <div className="relative mx-auto aspect-[320/198] w-full overflow-hidden rounded-xl ring-1 ring-white/12">
        <svg
          viewBox="0 0 320 198"
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
          aria-hidden
        >
          <defs>
            <radialGradient id={`lights-${match.id}`} cx="50%" cy="48%" r="62%">
              <stop offset="0%" stopColor="#1c7c4d" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#04190f" stopOpacity="0.45" />
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
                stopOpacity="0.34"
              />
              <stop
                offset="100%"
                stopColor={isDanger ? "#f97316" : activeColor}
                stopOpacity="0.04"
              />
            </linearGradient>

            <pattern
              id={`net-${match.id}`}
              width="3.5"
              height="3.5"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 0 0 L 3.5 3.5 M 3.5 0 L 0 3.5"
                stroke="rgba(255,255,255,0.32)"
                strokeWidth="0.45"
              />
            </pattern>
          </defs>

          {/* Surface adaptée au sport (Football réglementaire, Parquet Basket ou Court Tennis) */}
          {sport === "basketball" ? (
            <BasketballSurface colors={colors} />
          ) : sport === "tennis" ? (
            <TennisSurface />
          ) : (
            <FootballSurface
              matchId={match.id}
              colors={colors}
              homeCrest={homeCrest}
              awayCrest={awayCrest}
              homeGoalFlash={homeGoalFlash}
              awayGoalFlash={awayGoalFlash}
              dangerSide={isDanger ? frame.side : "neutral"}
            />
          )}

          {/* Cône radar directionnel d'attaque / faisceau de corner */}
          {attackConePoints && (
            <polygon points={attackConePoints} fill={`url(#cone-${match.id})`} />
          )}

          {/* Zone cible point de penalty sur corner */}
          {frame.kind === "corner" && (
            <circle
              cx={frame.side === "home" ? 277 : 43}
              cy="99"
              r="14"
              fill="rgba(250,204,21,0.14)"
              stroke="#fde047"
              strokeWidth="1"
              strokeDasharray="3 2"
            />
          )}

          {/* Mur défensif réglementaire à 9m15 sur coup franc offensif */}
          {frame.wall && (
            <g>
              {[-8, 0, 8].map((dy, idx) => (
                <circle
                  key={idx}
                  cx={px(frame.wall!.x)}
                  cy={py(frame.wall!.y) + dy}
                  r="3.4"
                  fill={frame.wall!.side === "home" ? colors.homePrimary : colors.awayPrimary}
                  stroke="#ffffff"
                  strokeWidth="1"
                />
              ))}
              <line
                x1={px(frame.wall.x)}
                y1={py(frame.wall.y) - 11}
                x2={px(frame.wall.x)}
                y2={py(frame.wall.y) + 11}
                stroke="rgba(255,255,255,0.65)"
                strokeWidth="1.2"
              />
            </g>
          )}

          {/* Trajectoire vectorielle (passe, centre brossé ou tir cadré) */}
          {trajectoryPath && (
            <g>
              <path
                d={trajectoryPath.d}
                fill="none"
                stroke={trajectoryPath.hot ? "#fde047" : "rgba(255,255,255,0.75)"}
                strokeWidth={trajectoryPath.hot ? "2.1" : "1.35"}
                strokeDasharray={trajectoryPath.dashed ? "4 3" : undefined}
                strokeLinecap="round"
              />
              {trajectoryPath.hot && (
                <circle
                  cx={trajectoryPath.targetX}
                  cy={trajectoryPath.targetY}
                  r="5.5"
                  fill="none"
                  stroke="#fde047"
                  strokeWidth="1.1"
                  opacity="0.75"
                />
              )}
            </g>
          )}

          {/* Blocs tactiques dynamiques (11 vs 11, ajustés aux cartons rouges) */}
          {sport === "football" &&
            frame.players.map((p) => {
              const cx = px(p.x);
              const cy = py(p.y);
              const fill = p.team === "home" ? colors.homePrimary : colors.awayPrimary;
              const txt = p.team === "home" ? colors.homeText : colors.awayText;
              return (
                <g
                  key={p.id}
                  style={{
                    transition: "transform 420ms cubic-bezier(0.22, 1, 0.36, 1)",
                    transform: `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`,
                  }}
                >
                  {p.isCarrier && (
                    <circle
                      cx="0"
                      cy="0"
                      r="8.2"
                      fill="none"
                      stroke="#fde047"
                      strokeWidth="1.2"
                      opacity="0.85"
                    />
                  )}
                  <circle
                    cx="0"
                    cy="0"
                    r={p.role === "gk" ? "4.6" : p.isCarrier ? "5.1" : "4.3"}
                    fill={fill}
                    stroke={p.role === "gk" ? "#fde047" : "rgba(15,23,42,0.85)"}
                    strokeWidth={p.role === "gk" ? "1.3" : "1"}
                  />
                  <text
                    x="0"
                    y="1.6"
                    textAnchor="middle"
                    fontSize="4.6"
                    fontWeight="800"
                    fill={txt}
                  >
                    {p.number}
                  </text>
                </g>
              );
            })}

          {/* Ballon vectoriel haute précision avec onde sonar */}
          <g
            style={{
              transition: "transform 130ms linear",
              transform: `translate(${bx.toFixed(1)}px, ${by.toFixed(1)}px)`,
            }}
          >
            <circle
              cx="0"
              cy="0"
              r={isDanger ? "10.5" : "8"}
              fill={
                frame.kind === "goal"
                  ? "rgba(250,204,21,0.38)"
                  : isDanger
                    ? "rgba(239,68,68,0.34)"
                    : "rgba(52,211,153,0.26)"
              }
            />
            <circle cx="0.8" cy="1.4" r="4.3" fill="rgba(0,0,0,0.42)" />
            <circle cx="0" cy="0" r="4.3" fill="#ffffff" stroke="#0f172a" strokeWidth="0.9" />
            <polygon points="0,-2.1 2,-0.6 1.2,1.8 -1.2,1.8 -2,-0.6" fill="#0f172a" />
          </g>
        </svg>

        {/* Bandeau plein terrain sur événement majeur (BUT, CARTON ROUGE, VAR / Cotes suspendues) */}
        {frame.banner && (
          <div className="pointer-events-none absolute inset-x-3 top-2.5 flex justify-center">
            <div
              className={cn(
                "flex max-w-full items-center gap-2 rounded-xl border px-3 py-1.5 text-center shadow-lg backdrop-blur-md",
                frame.banner.type === "goal"
                  ? "border-amber-300/70 bg-black/80 text-amber-200"
                  : frame.banner.type === "red_card"
                    ? "border-red-400/70 bg-red-950/90 text-red-100"
                    : "border-amber-400/50 bg-black/75 text-amber-100"
              )}
            >
              <div className="min-w-0">
                <p className="truncate font-display text-[11.5px] font-extrabold tracking-wide">
                  {frame.banner.title}
                </p>
                <p className="truncate text-[10px] font-semibold text-white/85">
                  {frame.banner.subtitle}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Légende de sens d'attaque & effectif temps réel */}
      <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-[10px] font-semibold text-emerald-100/80">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/50"
            style={{ backgroundColor: colors.homePrimary }}
          />
          <span className="truncate font-display font-bold text-white">
            {match.homeTeam} →
          </span>
          {redHome > 0 && (
            <span className="shrink-0 rounded bg-betclic-red/90 px-1 py-0.2 text-[9px] font-extrabold text-white">
              {11 - redHome}j
            </span>
          )}
        </div>

        <div className="flex min-w-0 items-center gap-1.5">
          {redAway > 0 && (
            <span className="shrink-0 rounded bg-betclic-red/90 px-1 py-0.2 text-[9px] font-extrabold text-white">
              {11 - redAway}j
            </span>
          )}
          <span className="truncate font-display font-bold text-white">
            ← {match.awayTeam}
          </span>
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/50"
            style={{ backgroundColor: colors.awayPrimary }}
          />
        </div>
      </div>
    </div>
  );
}

function FootballSurface({
  matchId,
  colors,
  homeCrest,
  awayCrest,
  homeGoalFlash,
  awayGoalFlash,
  dangerSide,
}: {
  matchId: number;
  colors: MatchColors;
  homeCrest: string | null;
  awayCrest: string | null;
  homeGoalFlash: boolean;
  awayGoalFlash: boolean;
  dangerSide: "home" | "away" | "neutral";
}) {
  return (
    <g>
      {/* Pelouse tondue en bandes régulières */}
      <rect x="0" y="0" width="320" height="198" fill="#0d4228" />
      {Array.from({ length: 10 }).map((_, i) => (
        <rect
          key={i}
          x={12 + i * 29.6}
          y="8"
          width="14.8"
          height="182"
          fill="#125334"
          opacity="0.58"
        />
      ))}
      <rect x="0" y="0" width="320" height="198" fill={`url(#lights-${matchId})`} />

      {/* Lisérés de camp aux couleurs des deux clubs */}
      <rect x="10" y="8" width="2" height="182" fill={colors.homePrimary} opacity="0.85" />
      <rect x="308" y="8" width="2" height="182" fill={colors.awayPrimary} opacity="0.85" />

      {/* Blasons officiels en filigrane discret sur chaque moitié de terrain */}
      {homeCrest && (
        <image
          href={homeCrest}
          x="68"
          y="75"
          width="48"
          height="48"
          opacity="0.1"
          preserveAspectRatio="xMidYMid meet"
        />
      )}
      {awayCrest && (
        <image
          href={awayCrest}
          x="204"
          y="75"
          width="48"
          height="48"
          opacity="0.1"
          preserveAspectRatio="xMidYMid meet"
        />
      )}

      {/* Surbrillance de la surface sous haute pression */}
      {dangerSide === "home" && (
        <rect
          x="261.5"
          y="45"
          width="46.5"
          height="108"
          fill="rgba(239,68,68,0.16)"
        />
      )}
      {dangerSide === "away" && (
        <rect
          x="12"
          y="45"
          width="46.5"
          height="108"
          fill="rgba(239,68,68,0.16)"
        />
      )}

      {/* Cages 3D & filets gauche (Domicile défend) et droite (Extérieur défend) */}
      <g>
        <rect
          x="3.5"
          y="86"
          width="8.5"
          height="26"
          rx="1"
          fill={homeGoalFlash ? "rgba(250,204,21,0.45)" : `url(#net-${matchId})`}
          stroke={homeGoalFlash ? "#fde047" : "rgba(255,255,255,0.75)"}
          strokeWidth={homeGoalFlash ? "1.6" : "1"}
        />
        <rect
          x="308"
          y="86"
          width="8.5"
          height="26"
          rx="1"
          fill={awayGoalFlash ? "rgba(250,204,21,0.45)" : `url(#net-${matchId})`}
          stroke={awayGoalFlash ? "#fde047" : "rgba(255,255,255,0.75)"}
          strokeWidth={awayGoalFlash ? "1.6" : "1"}
        />
      </g>

      {/* Marquages FIFA réglementaires complets */}
      <g stroke="rgba(255,255,255,0.52)" strokeWidth="1.25" fill="none">
        {/* Lignes de touche et de but */}
        <rect x="12" y="8" width="296" height="182" rx="1.5" />
        {/* Ligne médiane & rond central vrai */}
        <line x1="160" y1="8" x2="160" y2="190" />
        <circle cx="160" cy="99" r="25.8" />
        <circle cx="160" cy="99" r="1.8" fill="rgba(255,255,255,0.8)" />

        {/* Surfaces de réparation (16,50m) & 6 mètres (5,50m) */}
        <rect x="12" y="45" width="46.5" height="108" />
        <rect x="12" y="74.5" width="15.5" height="49" />
        <rect x="261.5" y="45" width="46.5" height="108" />
        <rect x="292.5" y="74.5" width="15.5" height="49" />

        {/* Points de penalty (11m) */}
        <circle cx="43" cy="99" r="1.5" fill="rgba(255,255,255,0.8)" />
        <circle cx="277" cy="99" r="1.5" fill="rgba(255,255,255,0.8)" />

        {/* Arcs de surface (« D » réglementaires) */}
        <path d="M 58.5 78.4 A 25.8 25.8 0 0 1 58.5 119.6" />
        <path d="M 261.5 78.4 A 25.8 25.8 0 0 0 261.5 119.6" />

        {/* Quarts de cercle de corner */}
        <path d="M 18 8 A 6 6 0 0 1 12 14" />
        <path d="M 12 184 A 6 6 0 0 1 18 190" />
        <path d="M 302 8 A 6 6 0 0 0 308 14" />
        <path d="M 308 184 A 6 6 0 0 0 302 190" />
      </g>
    </g>
  );
}

function BasketballSurface({ colors }: { colors: MatchColors }) {
  return (
    <g>
      <rect x="0" y="0" width="320" height="198" fill="#78350f" />
      <rect x="12" y="8" width="296" height="182" fill="#92400e" stroke="#fde68a" strokeWidth="1.4" />
      <rect x="12" y="72" width="52" height="54" fill={colors.homePrimary} opacity="0.35" stroke="#fde68a" strokeWidth="1.2" />
      <rect x="256" y="72" width="52" height="54" fill={colors.awayPrimary} opacity="0.35" stroke="#fde68a" strokeWidth="1.2" />
      <line x1="160" y1="8" x2="160" y2="190" stroke="#fde68a" strokeWidth="1.3" />
      <circle cx="160" cy="99" r="22" fill="none" stroke="#fde68a" strokeWidth="1.3" />
      <path d="M 12 26 A 76 76 0 0 1 12 172" fill="none" stroke="#fde68a" strokeWidth="1.3" />
      <path d="M 308 26 A 76 76 0 0 0 308 172" fill="none" stroke="#fde68a" strokeWidth="1.3" />
    </g>
  );
}

function TennisSurface() {
  return (
    <g>
      <rect x="0" y="0" width="320" height="198" fill="#172554" />
      <rect x="24" y="20" width="272" height="158" fill="#1d4ed8" stroke="#ffffff" strokeWidth="1.4" />
      <line x1="24" y1="38" x2="296" y2="38" stroke="#ffffff" strokeWidth="1" />
      <line x1="24" y1="160" x2="296" y2="160" stroke="#ffffff" strokeWidth="1" />
      <line x1="92" y1="38" x2="92" y2="160" stroke="#ffffff" strokeWidth="1" />
      <line x1="228" y1="38" x2="228" y2="160" stroke="#ffffff" strokeWidth="1" />
      <line x1="92" y1="99" x2="228" y2="99" stroke="#ffffff" strokeWidth="1" />
      <line x1="160" y1="16" x2="160" y2="182" stroke="#fde047" strokeWidth="1.8" strokeDasharray="3 2" />
    </g>
  );
}

/* ============================================================================
 * 2. VUE MOMENTUM / PRESSION MINUTE PAR MINUTE (Histogramme bicolore 18 barres)
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
    <div className="px-3 pb-2 pt-2.5">
      <div className="mb-2 flex items-center justify-between gap-2 text-[10.5px]">
        <span className="flex items-center gap-1.5 font-display font-bold text-white">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: colors.homePrimary }}
          />
          {initials(match.homeTeam)}
        </span>
        <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-100">
          Pression 10&apos; :{" "}
          <strong className="text-white">{telemetry.recentHomePressure}%</strong> –{" "}
          <strong className="text-white">{100 - telemetry.recentHomePressure}%</strong>
        </span>
        <span className="flex items-center gap-1.5 font-display font-bold text-white">
          {initials(match.awayTeam)}
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: colors.awayPrimary }}
          />
        </span>
      </div>

      <div className="relative aspect-[320/164] w-full overflow-hidden rounded-xl border border-white/10 bg-black/30 px-2 py-2">
        <svg viewBox="0 0 320 140" className="h-full w-full" aria-hidden>
          {/* Ligne d'équilibre médiane & séparation Mi-temps (45') */}
          <line x1="8" y1="70" x2="312" y2="70" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
          <line
            x1="160"
            y1="8"
            x2="160"
            y2="132"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
          <text
            x="160"
            y="137"
            textAnchor="middle"
            fontSize="7"
            fontWeight="700"
            fill="rgba(255,255,255,0.5)"
          >
            MT 45&apos;
          </text>

          {telemetry.momentum.map((b, i) => {
            const slotW = 300 / 18;
            const barW = slotW - 3.2;
            const x = 10 + i * slotW + 1.6;

            if (!b.played) {
              return (
                <rect
                  key={b.minuteEnd}
                  x={x}
                  y={67}
                  width={barW}
                  height={6}
                  rx="2"
                  fill="rgba(255,255,255,0.07)"
                />
              );
            }

            const isHome = b.value >= 0;
            const h = Math.max(5, (Math.abs(b.value) / 100) * 56);
            const y = isHome ? 70 - h : 70;
            const bucketStart = b.minuteEnd - 4;
            const bucketEvents = events.filter(
              (ev) => ev.minute >= bucketStart && ev.minute <= b.minuteEnd
            );

            return (
              <g key={b.minuteEnd}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  rx="2.5"
                  fill={isHome ? colors.homePrimary : colors.awayPrimary}
                  opacity={Math.abs(b.value) > 55 ? "0.96" : "0.78"}
                />
                {bucketEvents.map((ev, idx) => {
                  const evHome = ev.team === "home";
                  const cy = evHome ? Math.max(9, y - 6 - idx * 8) : Math.min(131, y + h + 7 + idx * 8);
                  return (
                    <circle
                      key={idx}
                      cx={x + barW / 2}
                      cy={cy}
                      r="3.2"
                      fill={ev.type === "red_card" ? "#ef4444" : "#fde047"}
                      stroke="#0f172a"
                      strokeWidth="0.9"
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ============================================================================
 * 3. VUE STATISTIQUES BOOKMAKER FACE-À-FACE (xG, Tirs, Attaques dang., Corners)
 * ========================================================================== */

function DetailedStatsView({
  match,
  telemetry,
  colors,
}: {
  match: ClientMatch;
  telemetry: LiveMatchTelemetry;
  colors: MatchColors;
}) {
  const rows = [
    {
      label: "Expected Goals (xG)",
      leftText: telemetry.xgHome.toFixed(2),
      rightText: telemetry.xgAway.toFixed(2),
      leftVal: telemetry.xgHome,
      rightVal: telemetry.xgAway,
    },
    {
      label: "Possession de balle",
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
      label: "Attaques dangereuses",
      leftText: String(telemetry.dangerousAttacksHome),
      rightText: String(telemetry.dangerousAttacksAway),
      leftVal: telemetry.dangerousAttacksHome,
      rightVal: telemetry.dangerousAttacksAway,
    },
    {
      label: "Corners · Arrêts gardien",
      leftText: `${telemetry.cornersHome} · ${telemetry.savesHome}`,
      rightText: `${telemetry.cornersAway} · ${telemetry.savesAway}`,
      leftVal: telemetry.cornersHome + telemetry.savesHome,
      rightVal: telemetry.cornersAway + telemetry.savesAway,
    },
  ];

  return (
    <div className="px-3.5 pb-2.5 pt-2.5">
      <div className="mb-2 flex items-center justify-between text-[10.5px] font-bold text-emerald-100/90">
        <span className="truncate">{match.homeTeam}</span>
        <span className="truncate text-right">{match.awayTeam}</span>
      </div>
      <div className="space-y-2">
        {rows.map((r) => {
          const total = r.leftVal + r.rightVal;
          const leftPct = total > 0 ? Math.round((r.leftVal / total) * 100) : 50;
          return (
            <div key={r.label}>
              <div className="mb-0.5 flex items-center justify-between text-[10.5px] tabular-nums">
                <span className="font-display font-bold text-white">{r.leftText}</span>
                <span className="text-[10px] font-medium text-emerald-100/75">{r.label}</span>
                <span className="font-display font-bold text-white">{r.rightText}</span>
              </div>
              <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-white/12">
                <div
                  className="h-full transition-all duration-500"
                  style={{
                    width: `${leftPct}%`,
                    backgroundColor: colors.homePrimary,
                  }}
                />
                <div
                  className="h-full transition-all duration-500"
                  style={{
                    width: `${100 - leftPct}%`,
                    backgroundColor: colors.awayPrimary,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================================
 * 4. FRISE CHRONOLOGIQUE INTERACTIVE 0' → 45' → 90' & JAUGES COMPACTES
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
  const progressPct = isFinished ? 100 : Math.min(100, Math.max(2, (minute / 90) * 100));

  return (
    <div className="border-t border-white/10 bg-black/25 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[9.5px] text-emerald-100/70">
        <span className="font-semibold">0&apos;</span>
        {activePinnedEvent ? (
          <span className="truncate rounded-full bg-white/14 px-2 py-0.5 font-display text-[10px] font-bold text-amber-200">
            {activePinnedEvent.minute}&apos; ·{" "}
            {activePinnedEvent.type === "red_card" ? "🟥 Carton rouge" : "⚽ But"}{" "}
            {activePinnedEvent.player ? `${activePinnedEvent.player} ` : ""}(
            {activePinnedEvent.team === "home" ? match.homeTeam : match.awayTeam})
          </span>
        ) : (
          <span className="font-semibold">
            {isFinished
              ? "90' Terminé"
              : isHalfTime
                ? "MT · 45'"
                : `MT 45'  •  En jeu ${minute}'`}
          </span>
        )}
        <span className="font-semibold">90&apos;</span>
      </div>

      <div className="relative h-3.5 w-full">
        {/* Rail 0' → 90' */}
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/12">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Repère Mi-temps 45' */}
        <span className="pointer-events-none absolute left-1/2 top-1/2 h-2.5 w-[1.5px] -translate-x-1/2 -translate-y-1/2 bg-white/40" />

        {/* Curseur live pulsant */}
        {!isFinished && (
          <span
            className="pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-emerald-300 shadow-sm transition-all duration-500"
            style={{ left: `${progressPct}%` }}
          />
        )}

        {/* Marqueurs cliquables des buts & cartons rouges */}
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
              title={`${ev.minute}' ${ev.player ?? ""}`}
              className={cn(
                "absolute top-1/2 grid h-4 w-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[1.5px] bg-[#082216] text-[8.5px] leading-none shadow-sm transition-transform",
                selected && "scale-125 ring-2 ring-amber-300"
              )}
            >
              {ev.type === "red_card" ? "🟥" : "⚽"}
            </button>
          );
        })}
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
      <p className="truncate text-center text-[9px] font-medium text-emerald-200/75">
        {label}
      </p>
      <div className="mt-0.5 flex items-center justify-between text-[10px] font-bold tabular-nums text-white">
        <span>{leftText}</span>
        <span>{rightText}</span>
      </div>
      <div className="mt-1 flex h-1 w-full overflow-hidden rounded-full bg-white/12">
        <div
          className="h-full transition-all duration-500"
          style={{ width: `${leftPct}%`, backgroundColor: colors.homePrimary }}
        />
        <div
          className="h-full transition-all duration-500"
          style={{ width: `${100 - leftPct}%`, backgroundColor: colors.awayPrimary }}
        />
      </div>
    </div>
  );
}
