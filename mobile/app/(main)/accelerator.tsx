import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient as SvgGradient,
  Path,
  Polygon,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import {
  ArrowLeft,
  CircleHelp,
  Eye,
  EyeOff,
  Hand,
  Play,
} from "lucide-react-native";
import { useApp } from "@/context/app-context";
import { api } from "@/lib/api";
import { useRouter } from "@/lib/router";
import { triggerHaptic } from "@/theme/tokens";

const SYM = "$";
const DEC = 2;
const MIN_BET = 1;
const MAX_BET = 50;
const QUICK_BETS = [1, 5, 10, 25];
const PING_PERIOD_MS = 500;
const MIN_HOLD_MS = 350;

const V_MIN = 1.01;
const V_MAX = 2.0;

// Géométrie exacte de la jauge (identique à src/app/(main)/accelerator/page.tsx)
const GX = 100;
const GY = 100;
const GR = 72;
const GSTROKE = 14;
const G_LABEL_R = GR + 17;

const RISK_SECTORS = [
  { lo: 1.01, hi: 1.25, color: "#10b981" },
  { lo: 1.25, hi: 1.5, color: "#22c55e" },
  { lo: 1.5, hi: 1.75, color: "#eab308" },
  { lo: 1.75, hi: 2.0, color: "#ef4444" },
];

const MAJORS = [1.01, 1.5, 2];
const EPS = 1e-6;
const approxEq = (a: number, b: number) => Math.abs(a - b) < EPS;

function fmt(n: number): string {
  const safe = Number.isFinite(n) ? n : 0;
  const fixed = safe.toFixed(DEC).replace(".", ",");
  const [intPart, decPart] = fixed.split(",");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped},${decPart} ${SYM}`;
}

function vToTheta(v: number): number {
  const t = (Math.max(V_MIN, Math.min(V_MAX, v)) - V_MIN) / (V_MAX - V_MIN);
  return Math.PI * (1 - t);
}

function polar(th: number, r = GR) {
  return { x: GX + r * Math.cos(th), y: GY - r * Math.sin(th) };
}

function arcPath(t1: number, t2: number, r = GR): string {
  const p1 = polar(t1, r);
  const p2 = polar(t2, r);
  const d = Math.abs(t2 - t1);
  const large = d > Math.PI ? 1 : 0;
  const sweep = t2 < t1 ? 1 : 0;
  return `M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)} A ${r.toFixed(3)} ${r.toFixed(3)} 0 ${large} ${sweep} ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`;
}

function graduationValues(): number[] {
  const out: number[] = [];
  for (let v = V_MIN; v < V_MAX - 1e-9; v += 0.1) {
    out.push(Math.round(v * 100) / 100);
  }
  out.push(V_MAX);
  return out;
}

function clsFor(v: number): "major" | "minor" | "micro" {
  if (MAJORS.some((m) => approxEq(m, v))) return "major";
  if (approxEq(v * 2, Math.round(v * 2))) return "minor";
  return "micro";
}

function endsFor(c: "major" | "minor" | "micro") {
  if (c === "major") return { inR: 78, outR: 84.5 };
  return { inR: 79.5, outR: 84 };
}

export default function AcceleratorScreen() {
  const router = useRouter();
  const { user, setBalance, hapticsEnabled } = useApp();

  const [bal, setBal] = useState<number>(() => user?.balance ?? 0);
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [balFlash, setBalFlash] = useState(false);
  const [stake, setStake] = useState("1.00");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"start" | "hold">("start");
  const [displayMult, setDisplayMult] = useState(V_MIN);
  const [baseBet, setBaseBet] = useState<number | null>(null);
  const [crashShow, setCrashShow] = useState(false);
  const [crashMult, setCrashMult] = useState(1.01);
  const [crashedBorder, setCrashedBorder] = useState(false);
  const [cashingOut, setCashingOut] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [modal, setModal] = useState<{
    show: boolean;
    win: boolean;
    title: string;
    amount: string;
    mult: string;
  }>({
    show: false,
    win: true,
    title: "",
    amount: "",
    mult: "",
  });

  const displayVRef = useRef(V_MIN);
  const gBaseRef = useRef(0.02911764705882353);
  const mMaxRef = useRef(V_MAX);
  const roundIdRef = useRef<number | null>(null);
  const holdingRef = useRef(false);
  const isStartingRef = useRef(false);
  const isCashingOutRef = useRef(false);
  const releaseLockRef = useRef(false);
  const pingInFlightRef = useRef(false);
  const animIdRef = useRef(0);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFrameTsRef = useRef<number | null>(null);
  const crashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStartedAtRef = useRef(0);

  const endRef = useRef<(j: Record<string, unknown>) => void>(() => {});
  const animateLoopRef = useRef<(ts: number) => void>(() => {});
  const stopHoldLoopRef = useRef<(skip: boolean) => void>(() => {});

  // Géométrie statique pré-calculée de la jauge SVG
  const staticGauge = useMemo(() => {
    const railD = arcPath(vToTheta(V_MIN), vToTheta(V_MAX), GR);
    const sectors = RISK_SECTORS.map((seg) => ({
      color: seg.color,
      d: arcPath(vToTheta(seg.lo), vToTheta(seg.hi), GR),
    }));
    const strokeColors = {
      major: "#e2e8f0",
      minor: "#94a3b8",
      micro: "#475569",
    };
    const strokeWidths = {
      major: 2,
      minor: 1.2,
      micro: 0.8,
    };
    const ticks = graduationValues().map((v) => {
      const th = vToTheta(v);
      const c = clsFor(v);
      const { inR, outR } = endsFor(c);
      const p1 = polar(th, inR);
      const p2 = polar(th, outR);
      return {
        v,
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        stroke: strokeColors[c],
        strokeWidth: strokeWidths[c],
      };
    });
    const labels = graduationValues()
      .filter((v) => MAJORS.some((m) => approxEq(m, v)))
      .map((v) => {
        const p = polar(vToTheta(v), G_LABEL_R);
        return { v, x: p.x, y: p.y, text: `×${v.toFixed(2)}` };
      });
    const baseHalf = 5.5;
    const tipR = GR - 6;
    const needlePoints = `${GX},${GY - baseHalf} ${GX},${GY + baseHalf} ${GX + tipR},${GY}`;
    return { railD, sectors, ticks, labels, needlePoints };
  }, []);

  const syncBalFlash = useCallback(
    (next: number) => {
      setBal(next);
      setBalance(next);
      setBalFlash(true);
      setTimeout(() => setBalFlash(false), 500);
    },
    [setBalance]
  );

  const cleanupGameLoop = useCallback(() => {
    holdingRef.current = false;
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (animIdRef.current) {
      cancelAnimationFrame(animIdRef.current);
      animIdRef.current = 0;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanupGameLoop();
      if (crashTimerRef.current) clearTimeout(crashTimerRef.current);
    };
  }, [cleanupGameLoop]);

  const triggerCrashAnimation = useCallback(
    (mult: number) => {
      triggerHaptic("error", hapticsEnabled);
      setCrashMult(mult);
      setCrashShow(true);
      setCrashedBorder(true);
      if (crashTimerRef.current) clearTimeout(crashTimerRef.current);
      crashTimerRef.current = setTimeout(() => {
        setCrashShow(false);
        setCrashedBorder(false);
      }, 2000);
    },
    [hapticsEnabled]
  );

  const handleEnd = useCallback(
    (j: Record<string, unknown>) => {
      cleanupGameLoop();
      const mult =
        typeof j.multiplier === "number" ? j.multiplier : displayVRef.current;
      displayVRef.current = mult;
      setDisplayMult(mult);

      if (j.new_balance != null) syncBalFlash(Number(j.new_balance));
      const st = String(j.status ?? "");

      if (st === "crashed" || st === "postcrashed") {
        triggerCrashAnimation(mult);
        setBaseBet(null);
      } else if (st === "cashed") {
        triggerHaptic("success", hapticsEnabled);
        const win = Number(j.win_amount ?? 0);
        const jackpot = Boolean(j.jackpot);
        setModal({
          show: true,
          win: true,
          title: jackpot ? "JACKPOT !" : "Encaissé !",
          amount: fmt(win),
          mult: `×${mult.toFixed(2)}`,
        });
      }
      setError("");
      setMode("start");
      roundIdRef.current = null;
    },
    [cleanupGameLoop, hapticsEnabled, syncBalFlash, triggerCrashAnimation]
  );

  const pingTap = useCallback(async () => {
    if (!roundIdRef.current || pingInFlightRef.current) return;
    pingInFlightRef.current = true;
    try {
      const j = (await api.accelerator.post({
        action: "tap",
      })) as unknown as Record<string, unknown>;
      pingInFlightRef.current = false;
      if (j.status === "ok" && typeof j.multiplier === "number") {
        if (j.multiplier > displayVRef.current) {
          displayVRef.current = j.multiplier;
          setDisplayMult(j.multiplier);
        }
        return;
      }
      if (
        j.status === "crashed" ||
        j.status === "cashed" ||
        j.status === "postcrashed"
      ) {
        endRef.current(j);
      }
    } catch {
      pingInFlightRef.current = false;
    }
  }, []);

  const animateLoop = useCallback((ts: number) => {
    if (!holdingRef.current) {
      if (animIdRef.current) {
        cancelAnimationFrame(animIdRef.current);
        animIdRef.current = 0;
      }
      return;
    }
    if (lastFrameTsRef.current == null) lastFrameTsRef.current = ts;
    const dt = Math.min(0.1, (ts - lastFrameTsRef.current) / 1000);
    lastFrameTsRef.current = ts;

    displayVRef.current = Math.min(
      mMaxRef.current,
      displayVRef.current + gBaseRef.current * dt
    );
    setDisplayMult(displayVRef.current);

    if (displayVRef.current >= mMaxRef.current - 1e-9) {
      stopHoldLoopRef.current(false);
      return;
    }
    animIdRef.current = requestAnimationFrame(animateLoopRef.current);
  }, []);

  const startHoldLoop = useCallback(async () => {
    if (holdingRef.current) return;
    holdingRef.current = true;
    lastFrameTsRef.current = null;
    releaseLockRef.current = false;
    triggerHaptic("light", hapticsEnabled);

    try {
      const hs = (await api.accelerator.post({
        action: "hold_start",
      })) as unknown as Record<string, unknown>;
      if (!holdingRef.current) return;
      if (hs.status === "crashed" || hs.status === "postcrashed") {
        cleanupGameLoop();
        endRef.current(hs);
        return;
      }
      if (hs.status === "ok" && typeof hs.multiplier === "number") {
        displayVRef.current = hs.multiplier;
        setDisplayMult(hs.multiplier);
      }
    } catch {
      if (!holdingRef.current) return;
    }

    animIdRef.current = requestAnimationFrame(animateLoopRef.current);
    if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    pingTimerRef.current = setInterval(pingTap, PING_PERIOD_MS);
  }, [cleanupGameLoop, hapticsEnabled, pingTap]);

  const stopHoldLoop = useCallback(
    async (skipCashout: boolean) => {
      if (releaseLockRef.current) return;
      releaseLockRef.current = true;
      if (skipCashout) {
        cleanupGameLoop();
        setMode("start");
        releaseLockRef.current = false;
        return;
      }
      if (isCashingOutRef.current) {
        releaseLockRef.current = false;
        return;
      }
      isCashingOutRef.current = true;
      cleanupGameLoop();
      setCashingOut(true);
      try {
        const j = (await api.accelerator.post({
          action: "cashout",
          client_multiplier: displayVRef.current,
        })) as unknown as Record<string, unknown>;
        endRef.current(j);
      } catch {
        setError("Erreur réseau");
      } finally {
        setCashingOut(false);
        isCashingOutRef.current = false;
        releaseLockRef.current = false;
      }
    },
    [cleanupGameLoop]
  );

  const releaseHold = useCallback(
    (force = false) => {
      if (!force && Date.now() - holdStartedAtRef.current < MIN_HOLD_MS) {
        cleanupGameLoop();
        return;
      }
      void stopHoldLoopRef.current(false);
    },
    [cleanupGameLoop]
  );

  const startGame = useCallback(async () => {
    if (!user) {
      router.push("/auth");
      return;
    }
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    setError("");
    setCrashShow(false);
    setCrashedBorder(false);
    setDisplayMult(V_MIN);
    try {
      const bet = parseFloat(stake.replace(",", "."));
      if (Number.isNaN(bet) || bet <= 0) {
        setError("Mise invalide");
        return;
      }
      const j = (await api.accelerator.post({
        action: "start_game",
        bet,
      })) as unknown as Record<string, unknown>;
      if (j.status === "success") {
        roundIdRef.current =
          typeof j.round_id === "number" ? j.round_id : null;
        syncBalFlash(Number(j.new_balance));
        if (typeof j.g_base === "number" && j.g_base > 0) {
          gBaseRef.current = j.g_base;
        }
        if (typeof j.m_max === "number" && j.m_max > 0) {
          mMaxRef.current = j.m_max;
        }
        const m0 = typeof j.multiplier === "number" ? j.multiplier : V_MIN;
        displayVRef.current = m0;
        setDisplayMult(m0);

        const betNorm = Number(j.bet_amount_display ?? bet);
        setStake(betNorm.toFixed(DEC));
        setBaseBet(betNorm);
        setMode("hold");
      } else {
        setError((j.message as string) || "Erreur");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      isStartingRef.current = false;
    }
  }, [router, stake, syncBalFlash, user]);

  useEffect(() => {
    endRef.current = handleEnd;
    animateLoopRef.current = animateLoop;
    stopHoldLoopRef.current = stopHoldLoop;
  }, [animateLoop, handleEnd, stopHoldLoop]);

  useEffect(() => {
    api.accelerator
      .state()
      .then((d) => {
        if (d.status === "success" && typeof d.balance === "number") {
          setBal(d.balance);
          setBalance(d.balance);
          setStake(Math.max(MIN_BET, Math.min(MIN_BET, d.balance)).toFixed(DEC));
        }
      })
      .catch(() => {});
  }, [setBalance]);

  const setQuickStake = (val: number) => {
    const clamped = Math.max(MIN_BET, Math.min(MAX_BET, val));
    setStake(clamped.toFixed(DEC));
    setError("");
  };

  const onStakeBlur = () => {
    let val = parseFloat(stake.replace(",", "."));
    if (Number.isNaN(val) || val < MIN_BET) val = MIN_BET;
    if (val > MAX_BET) val = MAX_BET;
    setStake(val.toFixed(DEC));
  };

  const needleDeg = -(vToTheta(displayMult) * 180) / Math.PI;
  const isHold = mode === "hold";
  const balText = balanceHidden ? "••••" : fmt(bal);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      {/* En-tête identique à src/app/(main)/accelerator/page.tsx */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable
            onPress={() => router.push("/jeux")}
            style={styles.btnIcon}
          >
            <ArrowLeft size={16} color="#e2e8f0" strokeWidth={2.3} />
          </Pressable>
          <Text style={styles.logo}>
            Accelerator <Text style={styles.logoGold}>Pro</Text>
          </Text>
        </View>

        <View style={styles.headerRight}>
          <Pressable
            onPress={() => setBalanceHidden((h) => !h)}
            style={styles.balancePill}
          >
            <Text
              style={[
                styles.amountHl,
                balFlash && { color: "#4ade80" },
              ]}
            >
              {balText}
            </Text>
            {balanceHidden ? (
              <EyeOff size={14} color="#94a3b8" strokeWidth={2} />
            ) : (
              <Eye size={14} color="#94a3b8" strokeWidth={2} />
            )}
          </Pressable>

          <Pressable
            onPress={() => setRulesOpen(true)}
            style={styles.btnIcon}
          >
            <CircleHelp size={16} color="#e2e8f0" strokeWidth={2.2} />
          </Pressable>
        </View>
      </View>

      {/* Scène centrale : jauge SVG + multiplicateur + gain en direct */}
      <View style={styles.stage}>
        <View
          style={[
            styles.gaugeCard,
            crashedBorder && styles.gaugeCardCrashed,
          ]}
        >
          <View style={styles.gbox}>
            <Svg
              width="100%"
              height="100%"
              viewBox="0 0 200 116"
              preserveAspectRatio="xMidYMid meet"
            >
              <Defs>
                <SvgGradient id="railGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <Stop offset="0%" stopColor="#1e293b" />
                  <Stop offset="100%" stopColor="#0f172a" />
                </SvgGradient>
                <SvgGradient id="needleGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <Stop offset="0%" stopColor="#f8fafc" />
                  <Stop offset="100%" stopColor="#cbd5e1" />
                </SvgGradient>
              </Defs>

              <Path
                d={staticGauge.railD}
                fill="none"
                stroke="url(#railGradient)"
                strokeWidth={GSTROKE}
                strokeLinecap="round"
              />

              <G>
                {staticGauge.sectors.map((seg) => (
                  <Path
                    key={seg.color}
                    d={seg.d}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth={GSTROKE}
                    strokeLinecap="butt"
                  />
                ))}
              </G>

              <G>
                {staticGauge.ticks.map((t) => (
                  <Line
                    key={t.v}
                    x1={t.x1}
                    y1={t.y1}
                    x2={t.x2}
                    y2={t.y2}
                    stroke={t.stroke}
                    strokeWidth={t.strokeWidth}
                    strokeLinecap="round"
                  />
                ))}
              </G>

              <G>
                {staticGauge.labels.map((l) => (
                  <SvgText
                    key={l.v}
                    x={l.x}
                    y={l.y + 3}
                    fill="#f8fafc"
                    fontSize={8.5}
                    fontWeight="500"
                    textAnchor="middle"
                  >
                    {l.text}
                  </SvgText>
                ))}
              </G>

              <G rotation={needleDeg} origin={`${GX}, ${GY}`}>
                <Polygon
                  points={staticGauge.needlePoints}
                  fill="url(#needleGradient)"
                />
                <Circle
                  cx={GX}
                  cy={GY}
                  r={5}
                  fill="#0f172a"
                  stroke="#cbd5e1"
                  strokeWidth={1.5}
                />
                <Circle cx={GX} cy={GY} r={2.5} fill="#f8fafc" />
              </G>
            </Svg>
          </View>

          <View style={styles.valueRow}>
            <Text style={styles.multPrefix}>×</Text>
            <Text style={styles.valueText}>{displayMult.toFixed(2)}</Text>
          </View>

          <View style={styles.payoutRow}>
            <Text style={styles.payoutMuted}>
              {baseBet != null ? fmt(baseBet) : "—"}
            </Text>
            <Text style={[styles.payoutMuted, { opacity: 0.5 }]}>→</Text>
            <Text style={styles.payoutGain}>
              {baseBet != null ? fmt(baseBet * displayMult) : "—"}
            </Text>
          </View>

          {crashShow ? (
            <View style={styles.crashBadge}>
              <Text style={styles.crashBadgeText}>
                CRASH ×{crashMult.toFixed(2)}
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.hintText}>
          {isHold
            ? "Maintenez le bouton enfoncé puis relâchez pour encaisser"
            : "Choisissez votre mise (1 $ à 50 $) puis lancez la manche"}
        </Text>
      </View>

      {/* Contrôles bas */}
      <View style={styles.controls}>
        <View style={styles.inputGroup}>
          <TextInput
            value={stake}
            onChangeText={(t) => setStake(t.replace(/[^0-9.,]/g, ""))}
            onBlur={onStakeBlur}
            editable={!isHold}
            keyboardType="decimal-pad"
            placeholder="Mise"
            placeholderTextColor="#64748b"
            style={styles.stakeIn}
          />
          <Text style={styles.currencyBadge}>{SYM}</Text>
        </View>

        <View style={styles.quickGrid}>
          {QUICK_BETS.map((q) => (
            <Pressable
              key={q}
              disabled={isHold}
              onPress={() => setQuickStake(q)}
              style={[styles.quickBtn, isHold && { opacity: 0.45 }]}
            >
              <Text style={styles.quickBtnText}>
                {q} {SYM}
              </Text>
            </Pressable>
          ))}
          <Pressable
            disabled={isHold}
            onPress={() =>
              setQuickStake(Math.min(MAX_BET, Math.max(MIN_BET, bal)))
            }
            style={[
              styles.quickBtn,
              styles.quickMaxBtn,
              isHold && { opacity: 0.45 },
            ]}
          >
            <Text style={[styles.quickBtnText, { color: "#f59e0b" }]}>MAX</Text>
          </Pressable>
        </View>

        {isHold ? (
          <Pressable
            onPressIn={() => {
              holdStartedAtRef.current = Date.now();
              void startHoldLoop();
            }}
            onPressOut={() => {
              if (holdingRef.current) releaseHold();
            }}
            style={({ pressed }) => [
              styles.btnPlace,
              styles.btnHoldCashout,
              pressed && { transform: [{ scale: 0.985 }] },
            ]}
          >
            <Hand size={20} color="#ffffff" strokeWidth={2.4} />
            <Text style={[styles.btnPlaceText, { color: "#ffffff" }]}>
              {cashingOut ? "ENCAISSEMENT…" : "MAINTENIR POUR MONTER"}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => void startGame()}
            style={({ pressed }) => [
              styles.btnPlace,
              pressed && { transform: [{ scale: 0.985 }] },
            ]}
          >
            <Play size={20} color="#0b0f19" strokeWidth={2.4} />
            <Text style={styles.btnPlaceText}>MISER</Text>
          </Pressable>
        )}

        {error ? <Text style={styles.errorMsg}>{error}</Text> : null}
      </View>

      {/* Modale résultat */}
      <Modal
        visible={modal.show}
        transparent
        animationType="fade"
        onRequestClose={() => setModal((m) => ({ ...m, show: false }))}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setModal((m) => ({ ...m, show: false }))}
          />
          <View
            style={[
              styles.modalV2,
              modal.win ? styles.modalWin : styles.modalLose,
            ]}
          >
            <Text
              style={[
                styles.modalTitle,
                { color: modal.win ? "#22c55e" : "#ef4444" },
              ]}
            >
              {modal.title}
            </Text>
            <Text style={styles.modalAmount}>{modal.amount}</Text>
            {modal.mult ? (
              <Text style={styles.multLabel}>Multiplicateur {modal.mult}</Text>
            ) : null}
            <Pressable
              onPress={() => setModal((m) => ({ ...m, show: false }))}
              style={styles.btnCloseModal}
            >
              <Text style={styles.btnCloseModalText}>Continuer</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Modale règles */}
      <Modal
        visible={rulesOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setRulesOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setRulesOpen(false)}
          />
          <View style={styles.modalV2}>
            <Text style={[styles.modalTitle, { color: "#ffffff" }]}>
              Règles
            </Text>
            <View style={styles.rulesList}>
              <Text style={styles.ruleBullet}>
                • Le multiplicateur progresse de ×1.01 jusqu&apos;à ×2.00.
              </Text>
              <Text style={styles.ruleBullet}>
                • Maintenez le bouton pour monter, relâchez pour encaisser.
              </Text>
              <Text style={styles.ruleBullet}>
                • Si le crash survient avant le relâchement, la mise est perdue.
              </Text>
            </View>
            <Pressable
              onPress={() => setRulesOpen(false)}
              style={styles.btnCloseModal}
            >
              <Text style={styles.btnCloseModalText}>Compris</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#070b14",
  },
  header: {
    backgroundColor: "#0f172a",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.09)",
    paddingHorizontal: 8,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  btnIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    fontSize: 12.5,
    fontWeight: "500",
    color: "#ffffff",
    letterSpacing: -0.3,
  },
  logoGold: {
    color: "#f59e0b",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  balancePill: {
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  amountHl: {
    fontSize: 11,
    fontWeight: "500",
    color: "#22c55e",
    fontVariant: ["tabular-nums"],
  },
  stage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 14,
    gap: 12,
  },
  gaugeCard: {
    width: "100%",
    backgroundColor: "#0f172a",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 18,
    alignItems: "center",
    position: "relative",
  },
  gaugeCardCrashed: {
    borderColor: "#ef4444",
  },
  gbox: {
    width: "100%",
    maxWidth: 310,
    aspectRatio: 200 / 116,
  },
  valueRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    gap: 2,
  },
  multPrefix: {
    fontSize: 16,
    fontWeight: "500",
    color: "#94a3b8",
  },
  valueText: {
    fontSize: 21,
    fontWeight: "500",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
  payoutRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  payoutMuted: {
    fontSize: 12,
    fontWeight: "500",
    color: "#94a3b8",
    fontVariant: ["tabular-nums"],
  },
  payoutGain: {
    fontSize: 12,
    fontWeight: "500",
    color: "#22c55e",
    fontVariant: ["tabular-nums"],
  },
  crashBadge: {
    position: "absolute",
    top: "42%",
    backgroundColor: "#ef4444",
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
  },
  crashBadgeText: {
    fontSize: 11.5,
    fontWeight: "500",
    color: "#ffffff",
  },
  hintText: {
    fontSize: 10.5,
    color: "#94a3b8",
    textAlign: "center",
    lineHeight: 17,
  },
  controls: {
    backgroundColor: "#0f172a",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.09)",
    paddingHorizontal: 8,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 10,
  },
  inputGroup: {
    position: "relative",
    justifyContent: "center",
  },
  stakeIn: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    backgroundColor: "#070b14",
    paddingHorizontal: 14,
    paddingRight: 38,
    fontSize: 12.5,
    fontWeight: "500",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
  currencyBadge: {
    position: "absolute",
    right: 14,
    fontSize: 12,
    fontWeight: "500",
    color: "#94a3b8",
  },
  quickGrid: {
    flexDirection: "row",
    gap: 6,
  },
  quickBtn: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    backgroundColor: "#131d33",
    alignItems: "center",
    justifyContent: "center",
  },
  quickMaxBtn: {
    borderColor: "rgba(245,158,11,0.35)",
  },
  quickBtnText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#e2e8f0",
  },
  btnPlace: {
    height: 54,
    borderRadius: 14,
    backgroundColor: "#f59e0b",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  btnHoldCashout: {
    backgroundColor: "#22c55e",
  },
  btnPlaceText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#0b0f19",
  },
  errorMsg: {
    fontSize: 11,
    fontWeight: "500",
    color: "#f87171",
    textAlign: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(2,6,23,0.82)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalV2: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    backgroundColor: "#0f172a",
    padding: 22,
    alignItems: "center",
  },
  modalWin: {
    borderColor: "rgba(34,197,94,0.5)",
  },
  modalLose: {
    borderColor: "rgba(239,68,68,0.5)",
  },
  modalTitle: {
    fontSize: 14.5,
    fontWeight: "700",
  },
  modalAmount: {
    marginTop: 10,
    marginBottom: 4,
    fontSize: 17.5,
    fontWeight: "500",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
  multLabel: {
    fontSize: 11.5,
    fontWeight: "500",
    color: "#94a3b8",
  },
  rulesList: {
    width: "100%",
    marginTop: 14,
    gap: 6,
  },
  ruleBullet: {
    fontSize: 11.5,
    lineHeight: 20,
    color: "#cbd5e1",
  },
  btnCloseModal: {
    marginTop: 16,
    width: "100%",
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  btnCloseModalText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#ffffff",
  },
});
