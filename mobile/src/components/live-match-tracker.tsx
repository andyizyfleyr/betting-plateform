import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient as SvgLinearGradient,
  Path,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { Activity, BarChart3, Radio } from "lucide-react-native";
import type { ClientMatch, ClientMatchEvent } from "@/lib/api";
import { initials } from "@/lib/format";
import {
  computeLivePlayFrame,
  computeMatchTelemetry,
  resolveMatchColors,
  type LiveMatchTelemetry,
  type LivePlayFrame,
  type MatchColors,
} from "@/lib/live-telemetry";
import { sanitizeMatchEvents } from "@/lib/match-events";
import { COLORS } from "@/theme/tokens";
import { useLiveMatchClockSnapshot } from "./live-match-clock";

type TrackerTab = "pitch" | "momentum" | "stats";

const px = (pctX: number) => 12 + (pctX / 100) * 316;
const py = (pctY: number) => 6 + (pctY / 100) * 100;

export function LiveMatchTracker({
  match,
  defaultTab = "pitch",
}: {
  match: ClientMatch;
  defaultTab?: TrackerTab;
}) {
  const [tab, setTab] = useState<TrackerTab>(defaultTab);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [pinnedEvent, setPinnedEvent] = useState<{
    matchId: number;
    idx: number;
  } | null>(null);

  const isFinished = match.status === "finished" || match.minute === "Terminé";

  useEffect(() => {
    if (isFinished || tab !== "pitch") return;
    let rafId = 0;
    let lastTick = 0;

    const loop = (ts: number) => {
      if (ts - lastTick >= 40) {
        lastTick = ts;
        setNowMs(Date.now());
      }
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
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
  const activePinIdx =
    pinnedEvent?.matchId === match.id ? pinnedEvent.idx : null;
  const activePinnedEvent: ClientMatchEvent | null =
    activePinIdx != null ? (events[activePinIdx] ?? null) : null;

  return (
    <View style={styles.root}>
      {/* En-tête ultra-fin sur 1 ligne */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View
            style={[
              styles.headerDot,
              {
                backgroundColor:
                  frame.kind === "goal"
                    ? "#fcd34d"
                    : isDanger
                      ? COLORS.betclicRed
                      : isFinished
                        ? "#94a3b8"
                        : "#34d399",
              },
            ]}
          />
          <Text numberOfLines={1} style={styles.headerLabel}>
            {frame.label}
          </Text>
        </View>

        <View style={styles.tabGroup}>
          <TabPill
            active={tab === "pitch"}
            onPress={() => setTab("pitch")}
            Icon={Radio}
            label="2D"
          />
          <TabPill
            active={tab === "momentum"}
            onPress={() => setTab("momentum")}
            Icon={Activity}
            label="Pression"
          />
          <TabPill
            active={tab === "stats"}
            onPress={() => setTab("stats")}
            Icon={BarChart3}
            label="Stats"
          />
        </View>
      </View>

      {/* Fenêtre principale compacte à hauteur fixe (104 px) */}
      {tab === "pitch" ? (
        <PitchRadarView
          match={match}
          frame={frame}
          colors={colors}
          isDanger={isDanger}
        />
      ) : tab === "momentum" ? (
        <MomentumHistogramView
          match={match}
          telemetry={telemetry}
          colors={colors}
          events={events}
        />
      ) : (
        <DetailedStatsView telemetry={telemetry} colors={colors} />
      )}

      {/* Pied compact : frise 0'→90' interactive + 3 jauges clés */}
      <View style={styles.footer}>
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

        {tab !== "stats" ? (
          <View style={styles.miniGaugesRow}>
            <MiniStatGauge
              label="xG"
              leftText={telemetry.xgHome.toFixed(2)}
              rightText={telemetry.xgAway.toFixed(2)}
              leftVal={telemetry.xgHome}
              rightVal={telemetry.xgAway}
              colors={colors}
            />
            <View style={styles.miniGaugeDivider} />
            <MiniStatGauge
              label="Poss."
              leftText={`${telemetry.possessionHome}%`}
              rightText={`${telemetry.possessionAway}%`}
              leftVal={telemetry.possessionHome}
              rightVal={telemetry.possessionAway}
              colors={colors}
            />
            <View style={styles.miniGaugeDivider} />
            <MiniStatGauge
              label="Tirs"
              leftText={`${telemetry.shotsOnTargetHome}/${telemetry.shotsTotalHome}`}
              rightText={`${telemetry.shotsOnTargetAway}/${telemetry.shotsTotalAway}`}
              leftVal={
                telemetry.shotsOnTargetHome + telemetry.shotsTotalHome * 0.25
              }
              rightVal={
                telemetry.shotsOnTargetAway + telemetry.shotsTotalAway * 0.25
              }
              colors={colors}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function TabPill({
  active,
  onPress,
  Icon,
  label,
}: {
  active: boolean;
  onPress: () => void;
  Icon: typeof Radio;
  label: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tabPill, active && styles.tabPillActive]}
    >
      <Icon
        size={10}
        color={active ? "#052e16" : "rgba(209,250,229,0.78)"}
        strokeWidth={2.4}
      />
      <Text style={[styles.tabPillText, active && styles.tabPillTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function PitchRadarView({
  match,
  frame,
  colors,
  isDanger,
}: {
  match: ClientMatch;
  frame: LivePlayFrame;
  colors: MatchColors;
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
    (frame.kind === "goal" || frame.kind === "shot_on_target") &&
    frame.side === "away";
  const awayGoalFlash =
    (frame.kind === "goal" || frame.kind === "shot_on_target") &&
    frame.side === "home";

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
    if (
      frame.side === "neutral" ||
      frame.kind === "halftime" ||
      frame.kind === "fulltime"
    ) {
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
    <View style={styles.pitchOuter}>
      <View style={styles.pitchFrame}>
        <Svg
          viewBox="0 0 340 112"
          preserveAspectRatio="xMidYMid meet"
          width="100%"
          height="100%"
        >
          <Defs>
            <RadialGradient id={`lights-${match.id}`} cx="50%" cy="50%" r="62%">
              <Stop offset="0%" stopColor="#1c7c4d" stopOpacity="0.25" />
              <Stop offset="100%" stopColor="#04190f" stopOpacity="0.42" />
            </RadialGradient>

            <SvgLinearGradient
              id={`cone-${match.id}`}
              x1={frame.side === "home" ? "0%" : "100%"}
              y1="50%"
              x2={frame.side === "home" ? "100%" : "0%"}
              y2="50%"
            >
              <Stop
                offset="0%"
                stopColor={isDanger ? "#ef4444" : activeColor}
                stopOpacity="0.30"
              />
              <Stop
                offset="100%"
                stopColor={isDanger ? "#f97316" : activeColor}
                stopOpacity="0.03"
              />
            </SvgLinearGradient>
          </Defs>

          <Rect x="0" y="0" width="340" height="112" fill="#0d4228" />
          {Array.from({ length: 10 }).map((_, i) => (
            <Rect
              key={i}
              x={12 + i * 31.6}
              y="6"
              width="15.8"
              height="100"
              fill="#125334"
              opacity={0.56}
            />
          ))}
          <Rect
            x="0"
            y="0"
            width="340"
            height="112"
            fill={`url(#lights-${match.id})`}
          />

          <Rect
            x="10.2"
            y="6"
            width="1.8"
            height="100"
            fill={colors.homePrimary}
            opacity={0.85}
          />
          <Rect
            x="328"
            y="6"
            width="1.8"
            height="100"
            fill={colors.awayPrimary}
            opacity={0.85}
          />

          {isDanger && frame.side === "home" ? (
            <Rect
              x="284"
              y="26"
              width="44"
              height="60"
              fill="rgba(239,68,68,0.16)"
            />
          ) : null}
          {isDanger && frame.side === "away" ? (
            <Rect
              x="12"
              y="26"
              width="44"
              height="60"
              fill="rgba(239,68,68,0.16)"
            />
          ) : null}

          <Rect
            x="4.5"
            y="47"
            width="7.5"
            height="18"
            rx="1"
            fill={
              homeGoalFlash
                ? "rgba(250,204,21,0.45)"
                : "rgba(255,255,255,0.12)"
            }
            stroke={homeGoalFlash ? "#fde047" : "rgba(255,255,255,0.72)"}
            strokeWidth={homeGoalFlash ? 1.3 : 0.9}
          />
          <Rect
            x="328"
            y="47"
            width="7.5"
            height="18"
            rx="1"
            fill={
              awayGoalFlash
                ? "rgba(250,204,21,0.45)"
                : "rgba(255,255,255,0.12)"
            }
            stroke={awayGoalFlash ? "#fde047" : "rgba(255,255,255,0.72)"}
            strokeWidth={awayGoalFlash ? 1.3 : 0.9}
          />

          {/* Marquages réglementaires */}
          <G stroke="rgba(255,255,255,0.5)" strokeWidth="1" fill="none">
            <Rect x="12" y="6" width="316" height="100" rx="1" />
            <Line x1="170" y1="6" x2="170" y2="106" />
            <Circle cx="170" cy="56" r="15.5" />
            <Circle cx="170" cy="56" r="1.4" fill="rgba(255,255,255,0.8)" />
            <Rect x="12" y="26" width="44" height="60" />
            <Rect x="12" y="41" width="15" height="30" />
            <Rect x="284" y="26" width="44" height="60" />
            <Rect x="313" y="41" width="15" height="30" />
            <Circle cx="44" cy="56" r="1.2" fill="rgba(255,255,255,0.8)" />
            <Circle cx="296" cy="56" r="1.2" fill="rgba(255,255,255,0.8)" />
            <Path d="M 56 46.2 A 15.5 15.5 0 0 1 56 65.8" />
            <Path d="M 284 46.2 A 15.5 15.5 0 0 0 284 65.8" />
          </G>

          {attackConePoints ? (
            <Polygon
              points={attackConePoints}
              fill={`url(#cone-${match.id})`}
            />
          ) : null}

          {frame.kind === "corner" ? (
            <Circle
              cx={frame.side === "home" ? 296 : 44}
              cy="56"
              r="9"
              fill="rgba(250,204,21,0.14)"
              stroke="#fde047"
              strokeWidth="0.9"
              strokeDasharray="2.5 2"
            />
          ) : null}

          {frame.wall ? (
            <G>
              {[-5, 0, 5].map((dy, idx) => (
                <Circle
                  key={idx}
                  cx={px(frame.wall!.x)}
                  cy={py(frame.wall!.y) + dy}
                  r="2.4"
                  fill={
                    frame.wall!.side === "home"
                      ? colors.homePrimary
                      : colors.awayPrimary
                  }
                  stroke="#ffffff"
                  strokeWidth="0.8"
                />
              ))}
            </G>
          ) : null}

          {trajectoryPath ? (
            <G>
              <Path
                d={trajectoryPath.d}
                fill="none"
                stroke={
                  trajectoryPath.hot ? "#fde047" : "rgba(255,255,255,0.68)"
                }
                strokeWidth={trajectoryPath.hot ? 1.6 : 1.1}
                strokeDasharray={trajectoryPath.dashed ? "3.5 2.5" : undefined}
                strokeLinecap="round"
              />
              {trajectoryPath.hot ? (
                <Circle
                  cx={trajectoryPath.targetX}
                  cy={trajectoryPath.targetY}
                  r="4"
                  fill="none"
                  stroke="#fde047"
                  strokeWidth="0.9"
                  opacity={0.8}
                />
              ) : null}
            </G>
          ) : null}

          {sport === "football" &&
            frame.players.map((p) => {
              const cx = px(p.x);
              const cy = py(p.y);
              const fill =
                p.team === "home" ? colors.homePrimary : colors.awayPrimary;
              const txt =
                p.team === "home" ? colors.homeText : colors.awayText;
              return (
                <G key={p.id} x={cx} y={cy}>
                  {p.isCarrier ? (
                    <Circle
                      cx="0"
                      cy="0"
                      r="5.6"
                      fill="none"
                      stroke="#fde047"
                      strokeWidth="0.95"
                      opacity={0.9}
                    />
                  ) : null}
                  <Circle
                    cx="0"
                    cy="0"
                    r={p.role === "gk" ? 3.3 : p.isCarrier ? 3.6 : 3.1}
                    fill={fill}
                    stroke={
                      p.role === "gk" ? "#fde047" : "rgba(15,23,42,0.85)"
                    }
                    strokeWidth={p.role === "gk" ? 1 : 0.8}
                  />
                  <SvgText
                    x="0"
                    y="1.2"
                    textAnchor="middle"
                    fontSize="3.4"
                    fontWeight="500"
                    fill={txt}
                  >
                    {p.number}
                  </SvgText>
                </G>
              );
            })}

          {/* Ballon vectoriel */}
          <G x={bx} y={by}>
            <Circle
              cx="0"
              cy="0"
              r={isDanger ? 7.2 : 5.4}
              fill={
                frame.kind === "goal"
                  ? "rgba(250,204,21,0.4)"
                  : isDanger
                    ? "rgba(239,68,68,0.34)"
                    : "rgba(52,211,153,0.26)"
              }
            />
            <Circle cx="0.6" cy="1" r="2.9" fill="rgba(0,0,0,0.42)" />
            <Circle
              cx="0"
              cy="0"
              r="2.9"
              fill="#ffffff"
              stroke="#0f172a"
              strokeWidth="0.7"
            />
            <Polygon
              points="0,-1.4 1.3,-0.4 0.8,1.2 -0.8,1.2 -1.3,-0.4"
              fill="#0f172a"
            />
          </G>
        </Svg>

        {/* Repères d'attaque discrets */}
        <View pointerEvents="none" style={styles.cornerLeft}>
          <View
            style={[
              styles.cornerDot,
              { backgroundColor: colors.homePrimary },
            ]}
          />
          <Text style={styles.cornerText}>{initials(match.homeTeam)} →</Text>
          {redHome > 0 ? (
            <Text style={styles.redPlayerCount}>({11 - redHome}j)</Text>
          ) : null}
        </View>
        <View pointerEvents="none" style={styles.cornerRight}>
          {redAway > 0 ? (
            <Text style={styles.redPlayerCount}>({11 - redAway}j)</Text>
          ) : null}
          <Text style={styles.cornerText}>← {initials(match.awayTeam)}</Text>
          <View
            style={[
              styles.cornerDot,
              { backgroundColor: colors.awayPrimary },
            ]}
          />
        </View>

        {frame.banner ? (
          <View pointerEvents="none" style={styles.bannerCenter}>
            <View
              style={[
                styles.bannerBox,
                frame.banner.type === "red_card" && styles.bannerBoxRed,
              ]}
            >
              <Text numberOfLines={1} style={styles.bannerTitle}>
                {frame.banner.title}
              </Text>
              <Text numberOfLines={1} style={styles.bannerSub}>
                · {frame.banner.subtitle}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

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
    <View style={styles.momentumWrap}>
      <View style={styles.momentumTopRow}>
        <View style={styles.momentumSide}>
          <View
            style={[
              styles.momentumDot,
              { backgroundColor: colors.homePrimary },
            ]}
          />
          <Text style={styles.momentumTeamText}>
            {initials(match.homeTeam)}
          </Text>
        </View>
        <View style={styles.momentumCenterBadge}>
          <Text style={styles.momentumCenterText}>
            10 dern. min :{" "}
            <Text style={{ fontWeight: "500", color: "#ffffff" }}>
              {telemetry.recentHomePressure}%
            </Text>{" "}
            –{" "}
            <Text style={{ fontWeight: "500", color: "#ffffff" }}>
              {100 - telemetry.recentHomePressure}%
            </Text>
          </Text>
        </View>
        <View style={styles.momentumSide}>
          <Text style={styles.momentumTeamText}>
            {initials(match.awayTeam)}
          </Text>
          <View
            style={[
              styles.momentumDot,
              { backgroundColor: colors.awayPrimary },
            ]}
          />
        </View>
      </View>

      <View style={styles.momentumSvgFrame}>
        <Svg viewBox="0 0 320 76" preserveAspectRatio="none" width="100%" height="100%">
          <Line
            x1="6"
            y1="38"
            x2="314"
            y2="38"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth="0.9"
          />
          <Line
            x1="160"
            y1="4"
            x2="160"
            y2="72"
            stroke="rgba(255,255,255,0.20)"
            strokeWidth="0.9"
            strokeDasharray="2.5 2.5"
          />
          {telemetry.momentum.map((b, i) => {
            const slotW = 304 / 18;
            const barW = slotW - 3;
            const x = 8 + i * slotW + 1.5;

            if (!b.played) {
              return (
                <Rect
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
              (ev) =>
                ev.type === "goal" &&
                ev.minute >= bucketStart &&
                ev.minute <= b.minuteEnd
            );

            return (
              <G key={b.minuteEnd}>
                <Rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  rx="2"
                  fill={isHome ? colors.homePrimary : colors.awayPrimary}
                  opacity={Math.abs(b.value) > 55 ? 0.96 : 0.78}
                />
                {hasGoal ? (
                  <Circle
                    cx={x + barW / 2}
                    cy={isHome ? Math.max(4, y - 3.5) : Math.min(72, y + h + 3.5)}
                    r="2.4"
                    fill="#fde047"
                  />
                ) : null}
              </G>
            );
          })}
        </Svg>
      </View>
    </View>
  );
}

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
    <View style={styles.statsGrid}>
      {items.map((r) => {
        const total = r.leftVal + r.rightVal;
        const leftPct = total > 0 ? Math.round((r.leftVal / total) * 100) : 50;
        return (
          <View key={r.label} style={styles.statsCell}>
            <View style={styles.statsTextRow}>
              <Text style={styles.statsVal}>{r.leftText}</Text>
              <Text numberOfLines={1} style={styles.statsLabel}>
                {r.label}
              </Text>
              <Text style={styles.statsVal}>{r.rightText}</Text>
            </View>
            <View style={styles.statsBarBg}>
              <View
                style={{
                  width: `${leftPct}%`,
                  height: "100%",
                  backgroundColor: colors.homePrimary,
                }}
              />
              <View
                style={{
                  width: `${100 - leftPct}%`,
                  height: "100%",
                  backgroundColor: colors.awayPrimary,
                }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

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
    <View>
      {activePinnedEvent ? (
        <View style={styles.pinnedPillRow}>
          <Text numberOfLines={1} style={styles.pinnedPillText}>
            {activePinnedEvent.minute}’ ·{" "}
            {activePinnedEvent.type === "red_card" ? "🟥 Rouge" : "⚽ But"}{" "}
            {activePinnedEvent.player ? `${activePinnedEvent.player} ` : ""}(
            {activePinnedEvent.team === "home"
              ? match.homeTeam
              : match.awayTeam}
            )
          </Text>
        </View>
      ) : null}

      <View style={styles.timelineRow}>
        <Text style={styles.timelineEdgeText}>0’</Text>
        <View style={styles.timelineTrackWrap}>
          <View style={styles.timelineTrackBg}>
            <View
              style={[
                styles.timelineTrackFill,
                { width: `${progressPct}%` },
              ]}
            />
          </View>
          <View style={styles.timelineMidMark} />

          {!isFinished ? (
            <View
              pointerEvents="none"
              style={[styles.timelineCursor, { left: `${progressPct}%` }]}
            />
          ) : null}

          {events.map((ev, idx) => {
            if (ev.type !== "goal" && ev.type !== "red_card") return null;
            const left = Math.min(98, Math.max(2, (ev.minute / 90) * 100));
            const isHome = ev.team === "home";
            const selected = activePinIdx === idx;
            return (
              <Pressable
                key={`${ev.type}-${ev.minute}-${idx}`}
                hitSlop={6}
                onPress={() => onSelectPin(idx)}
                style={[
                  styles.timelineEventPin,
                  {
                    left: `${left}%`,
                    borderColor: isHome
                      ? colors.homePrimary
                      : colors.awayPrimary,
                  },
                  selected && styles.timelineEventPinSelected,
                ]}
              >
                <Text style={styles.timelineEventEmoji}>
                  {ev.type === "red_card" ? "🟥" : "⚽"}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.timelineEdgeText, { fontVariant: ["tabular-nums"] }]}>
          {rightClockLabel}
        </Text>
      </View>
    </View>
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
    <View style={styles.miniGaugeCol}>
      <View style={styles.miniGaugeTextRow}>
        <Text style={styles.miniGaugeVal}>{leftText}</Text>
        <Text style={styles.miniGaugeLabel}>{label}</Text>
        <Text style={styles.miniGaugeVal}>{rightText}</Text>
      </View>
      <View style={styles.miniGaugeBar}>
        <View
          style={{
            width: `${leftPct}%`,
            height: "100%",
            backgroundColor: colors.homePrimary,
          }}
        />
        <View
          style={{
            width: `${100 - leftPct}%`,
            height: "100%",
            backgroundColor: colors.awayPrimary,
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(2,44,34,0.35)",
    backgroundColor: "#09291b",
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(0,0,0,0.35)",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  headerLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  headerLabel: {
    flex: 1,
    fontSize: 10,
    fontWeight: "500",
    color: "#ffffff",
  },
  tabGroup: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
    padding: 2,
    gap: 2,
  },
  tabPill: {
    height: 20,
    borderRadius: 6,
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  tabPillActive: {
    backgroundColor: "#34d399",
  },
  tabPillText: {
    fontSize: 9.5,
    fontWeight: "500",
    color: "rgba(209,250,229,0.78)",
  },
  tabPillTextActive: {
    color: "#052e16",
  },
  pitchOuter: {
    height: 104,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  pitchFrame: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: "#0d4228",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },
  cornerLeft: {
    position: "absolute",
    bottom: 4,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.42)",
    paddingHorizontal: 6,
    paddingVertical: 1.5,
  },
  cornerRight: {
    position: "absolute",
    bottom: 4,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.42)",
    paddingHorizontal: 6,
    paddingVertical: 1.5,
  },
  cornerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  cornerText: {
    fontSize: 8.5,
    fontWeight: "500",
    color: "rgba(255,255,255,0.90)",
  },
  redPlayerCount: {
    fontSize: 8.5,
    fontWeight: "500",
    color: "#fca5a5",
  },
  bannerCenter: {
    position: "absolute",
    top: 6,
    left: 12,
    right: 12,
    alignItems: "center",
  },
  bannerBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(252,211,77,0.75)",
    backgroundColor: "rgba(0,0,0,0.82)",
    paddingHorizontal: 9,
    paddingVertical: 2.5,
    maxWidth: "100%",
  },
  bannerBoxRed: {
    borderColor: "rgba(248,113,113,0.75)",
    backgroundColor: "rgba(69,10,10,0.92)",
  },
  bannerTitle: {
    fontSize: 9.5,
    fontWeight: "700",
    color: "#fde68a",
  },
  bannerSub: {
    fontSize: 9,
    fontWeight: "500",
    color: "rgba(255,255,255,0.86)",
  },
  momentumWrap: {
    height: 104,
    paddingHorizontal: 10,
    paddingVertical: 6,
    justifyContent: "space-between",
  },
  momentumTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  momentumSide: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  momentumDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  momentumTeamText: {
    fontSize: 9.5,
    fontWeight: "500",
    color: "#ffffff",
  },
  momentumCenterBadge: {
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.10)",
    paddingHorizontal: 8,
    paddingVertical: 1.5,
  },
  momentumCenterText: {
    fontSize: 9,
    fontWeight: "500",
    color: "#d1fae5",
  },
  momentumSvgFrame: {
    height: 74,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(0,0,0,0.30)",
    paddingHorizontal: 4,
    paddingVertical: 2,
    overflow: "hidden",
  },
  statsGrid: {
    height: 104,
    flexDirection: "row",
    flexWrap: "wrap",
    alignContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    rowGap: 7,
    columnGap: 10,
  },
  statsCell: {
    width: "48%",
    gap: 2,
  },
  statsTextRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statsVal: {
    fontSize: 9.5,
    fontWeight: "500",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
  statsLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 9,
    color: "rgba(209,250,229,0.75)",
    paddingHorizontal: 2,
  },
  statsBarBg: {
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    flexDirection: "row",
    overflow: "hidden",
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(0,0,0,0.25)",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pinnedPillRow: {
    marginBottom: 4,
    alignItems: "center",
  },
  pinnedPillText: {
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: 8,
    paddingVertical: 1.5,
    fontSize: 9.5,
    fontWeight: "500",
    color: "#fde68a",
  },
  timelineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  timelineEdgeText: {
    fontSize: 9,
    fontWeight: "500",
    color: "rgba(209,250,229,0.70)",
    fontVariant: ["tabular-nums"],
  },
  timelineTrackWrap: {
    flex: 1,
    height: 14,
    justifyContent: "center",
  },
  timelineTrackBg: {
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
  },
  timelineTrackFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#34d399",
  },
  timelineMidMark: {
    position: "absolute",
    left: "50%",
    width: 1,
    height: 8,
    backgroundColor: "rgba(255,255,255,0.40)",
  },
  timelineCursor: {
    position: "absolute",
    width: 8,
    height: 8,
    marginLeft: -4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#ffffff",
    backgroundColor: "#6ee7b7",
  },
  timelineEventPin: {
    position: "absolute",
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    borderWidth: 1,
    backgroundColor: "#082216",
    alignItems: "center",
    justifyContent: "center",
  },
  timelineEventPinSelected: {
    transform: [{ scale: 1.2 }],
  },
  timelineEventEmoji: {
    fontSize: 8.5,
    lineHeight: 9,
  },
  miniGaugesRow: {
    marginTop: 6,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    alignItems: "center",
  },
  miniGaugeDivider: {
    width: 1,
    height: 18,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  miniGaugeCol: {
    flex: 1,
    paddingHorizontal: 6,
  },
  miniGaugeTextRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  miniGaugeVal: {
    fontSize: 9.5,
    fontWeight: "500",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
  miniGaugeLabel: {
    fontSize: 8.5,
    fontWeight: "500",
    color: "rgba(167,243,208,0.75)",
  },
  miniGaugeBar: {
    marginTop: 2,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    flexDirection: "row",
    overflow: "hidden",
  },
});
