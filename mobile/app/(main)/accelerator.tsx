import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, G, Line, Path, Text as SvgText } from "react-native-svg";
import { ArrowLeft, Gauge } from "lucide-react-native";
import { useApp } from "@/context/app-context";
import { api, ApiHttpError } from "@/lib/api";
import { Redirect, useRouter } from "@/lib/router";
import { triggerHaptic } from "@/theme/tokens";

const V_MIN = 1.01;
const V_MAX = 2.0;
const STAKES = [1, 5, 10, 25, 50] as const;

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number
) {
  const s = polar(cx, cy, r, startDeg);
  const e = polar(cx, cy, r, endDeg);
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

function valToDeg(v: number): number {
  const clamped = Math.max(V_MIN, Math.min(V_MAX, v));
  const ratio = (clamped - V_MIN) / (V_MAX - V_MIN);
  return 180 + ratio * 180; // 180° (gauche) -> 360° (droite)
}

export default function AcceleratorScreen() {
  const router = useRouter();
  const { user, authReady, balance, setBalance, hapticsEnabled } = useApp();

  const [bet, setBet] = useState<number>(5);
  const [mode, setMode] = useState<"idle" | "ready" | "holding">("idle");
  const [mult, setMult] = useState<number>(V_MIN);
  const [statusMsg, setStatusMsg] = useState<{
    kind: "win" | "crash" | "info";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const multRef = useRef<number>(V_MIN);
  multRef.current = mult;
  const holdingRef = useRef<boolean>(false);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user) return;
    api.accelerator
      .state()
      .then((res) => {
        if (typeof res.balance === "number") setBalance(res.balance);
      })
      .catch(() => {});
  }, [setBalance, user]);

  useEffect(() => {
    return () => {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    };
  }, []);

  if (authReady && !user) {
    return <Redirect href="/auth" />;
  }

  const stopHoldLoop = () => {
    holdingRef.current = false;
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  };

  const handleStartRound = async () => {
    if (busy || bet > balance + 0.001) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await api.accelerator.post({
        action: "start_game",
        bet,
      });
      if (typeof res.new_balance === "number") setBalance(res.new_balance);
      const startM = Number(res.multiplier ?? V_MIN);
      setMult(startM);
      setMode("ready");
      triggerHaptic("medium", hapticsEnabled);
    } catch (err) {
      setStatusMsg({
        kind: "crash",
        text: err instanceof ApiHttpError ? err.message : "Mise refusée",
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePressInAccelerate = async () => {
    if (mode !== "ready" && mode !== "holding") return;
    holdingRef.current = true;
    setMode("holding");
    triggerHaptic("light", hapticsEnabled);

    try {
      const hs = await api.accelerator.post({ action: "hold_start" });
      if (hs.status === "crashed") {
        stopHoldLoop();
        setMode("idle");
        setStatusMsg({
          kind: "crash",
          text: `Surchauffe à ×${Number(hs.multiplier ?? multRef.current).toFixed(2)} !`,
        });
        triggerHaptic("error", hapticsEnabled);
        return;
      }
      if (typeof hs.multiplier === "number") setMult(hs.multiplier);
    } catch {
      /* ignore */
    }

    if (!holdingRef.current) return;
    pingIntervalRef.current = setInterval(async () => {
      if (!holdingRef.current) return;
      try {
        const step = await api.accelerator.post({ action: "tap" });
        if (step.status === "crashed") {
          stopHoldLoop();
          setMode("idle");
          const cm = Number(step.multiplier ?? multRef.current);
          setMult(cm);
          setStatusMsg({
            kind: "crash",
            text: `Crash à ×${cm.toFixed(2)} !`,
          });
          triggerHaptic("error", hapticsEnabled);
        } else if (typeof step.multiplier === "number") {
          setMult(step.multiplier);
          if (step.multiplier >= V_MAX - 1e-4) {
            void handleCashout();
          }
        }
      } catch {
        /* ignore */
      }
    }, 220);
  };

  const handlePressOutAccelerate = async () => {
    if (!holdingRef.current) return;
    stopHoldLoop();
    setMode("ready");
    try {
      const fin = await api.accelerator.post({ action: "tap_final" });
      if (fin.status === "crashed") {
        setMode("idle");
        setStatusMsg({
          kind: "crash",
          text: `Crash à ×${Number(fin.multiplier ?? multRef.current).toFixed(2)} !`,
        });
        triggerHaptic("error", hapticsEnabled);
      } else if (typeof fin.multiplier === "number") {
        setMult(fin.multiplier);
      }
    } catch {
      /* ignore */
    }
  };

  const handleCashout = async () => {
    stopHoldLoop();
    if (busy || mode === "idle") return;
    setBusy(true);
    try {
      const res = await api.accelerator.post({
        action: "cashout",
        client_multiplier: multRef.current,
      });
      setMode("idle");
      if (res.status === "crashed") {
        setStatusMsg({
          kind: "crash",
          text: `Crash à ×${Number(res.multiplier ?? multRef.current).toFixed(2)} !`,
        });
        triggerHaptic("error", hapticsEnabled);
      } else {
        const finalM = Number(res.multiplier ?? multRef.current);
        const winAmt = Number(res.win_amount ?? bet * finalM);
        setMult(finalM);
        if (typeof res.new_balance === "number") setBalance(res.new_balance);
        setStatusMsg({
          kind: "win",
          text: `Encaissé : +${winAmt.toFixed(2)} $ (×${finalM.toFixed(2)})`,
        });
        triggerHaptic("success", hapticsEnabled);
      }
    } catch {
      setMode("idle");
    } finally {
      setBusy(false);
    }
  };

  const needleDeg = valToDeg(mult);
  const needleTip = polar(140, 145, 92, needleDeg);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back("/jeux")}
          style={styles.backBtn}
        >
          <ArrowLeft size={18} color="#f8fafc" strokeWidth={2.3} />
          <Text style={styles.backText}>Jeux</Text>
        </Pressable>

        <View style={styles.titleCenter}>
          <Gauge size={16} color="#10b981" strokeWidth={2.4} />
          <Text style={styles.cockpitTitle}>ACCELERATOR PRO</Text>
        </View>

        <View style={styles.balancePill}>
          <Text style={styles.balanceText}>{balance.toFixed(2)} $</Text>
        </View>
      </View>

      {/* Jauge semi-circulaire SVG ×1,01 – ×2,00 */}
      <View style={styles.gaugeCard}>
        <Svg width={280} height={175} viewBox="0 0 280 175">
          {/* Rail de fond */}
          <Path
            d={arcPath(140, 145, 108, 180, 360)}
            stroke="#1e293b"
            strokeWidth={16}
            fill="none"
            strokeLinecap="round"
          />
          {/* Secteurs de risque : Vert -> Lime -> Ambre -> Rouge */}
          <Path
            d={arcPath(140, 145, 108, 180, 224)}
            stroke="#10b981"
            strokeWidth={14}
            fill="none"
          />
          <Path
            d={arcPath(140, 145, 108, 225, 270)}
            stroke="#22c55e"
            strokeWidth={14}
            fill="none"
          />
          <Path
            d={arcPath(140, 145, 108, 271, 315)}
            stroke="#eab308"
            strokeWidth={14}
            fill="none"
          />
          <Path
            d={arcPath(140, 145, 108, 316, 360)}
            stroke="#ef4444"
            strokeWidth={14}
            fill="none"
          />

          <SvgText
            x="26"
            y="166"
            fill="#94a3b8"
            fontSize="11"
            fontWeight="700"
          >
            1.01x
          </SvgText>
          <SvgText
            x="128"
            y="24"
            fill="#94a3b8"
            fontSize="11"
            fontWeight="700"
          >
            1.50x
          </SvgText>
          <SvgText
            x="234"
            y="166"
            fill="#ef4444"
            fontSize="11"
            fontWeight="700"
          >
            2.00x
          </SvgText>

          {/* Aiguille dynamique */}
          <G>
            <Line
              x1={140}
              y1={145}
              x2={needleTip.x}
              y2={needleTip.y}
              stroke="#f8fafc"
              strokeWidth={4}
              strokeLinecap="round"
            />
            <Circle cx={140} cy={145} r={9} fill="#10b981" />
            <Circle cx={140} cy={145} r={4} fill="#ffffff" />
          </G>
        </Svg>

        <Text style={styles.multValue}>×{mult.toFixed(2)}</Text>
        <Text style={styles.payoutHint}>
          Gain courant : {(bet * mult).toFixed(2)} $
        </Text>

        {statusMsg ? (
          <View
            style={[
              styles.statusPill,
              statusMsg.kind === "win"
                ? styles.statusWin
                : styles.statusCrash,
            ]}
          >
            <Text style={styles.statusText}>{statusMsg.text}</Text>
          </View>
        ) : null}
      </View>

      {/* Dock de pilotage */}
      <View style={styles.dock}>
        <View style={styles.stakesRow}>
          {STAKES.map((s) => {
            const active = Math.abs(bet - s) < 0.01;
            return (
              <Pressable
                key={s}
                disabled={mode !== "idle"}
                onPress={() => setBet(s)}
                style={[
                  styles.stakeChip,
                  active && styles.stakeChipActive,
                  mode !== "idle" && { opacity: 0.45 },
                ]}
              >
                <Text
                  style={[
                    styles.stakeChipText,
                    active && { color: "#070b14" },
                  ]}
                >
                  {s} $
                </Text>
              </Pressable>
            );
          })}
        </View>

        {mode === "idle" ? (
          <Pressable
            disabled={busy || bet > balance + 0.001}
            onPress={handleStartRound}
            style={[
              styles.startBtn,
              (busy || bet > balance + 0.001) && { opacity: 0.55 },
            ]}
          >
            <Text style={styles.startBtnText}>
              DÉMARRER LA MANCHE · {bet.toFixed(2)} $
            </Text>
          </Pressable>
        ) : (
          <View style={styles.activeControls}>
            <Pressable
              onPressIn={handlePressInAccelerate}
              onPressOut={handlePressOutAccelerate}
              style={[
                styles.holdBtn,
                mode === "holding" && styles.holdBtnPressed,
              ]}
            >
              <Text style={styles.holdBtnText}>
                {mode === "holding"
                  ? "ACCÉLÉRATION EN COURS…"
                  : "MAINTENIR POUR ACCÉLÉRER"}
              </Text>
            </Pressable>

            <Pressable
              disabled={busy}
              onPress={handleCashout}
              style={styles.cashoutBtn}
            >
              <Text style={styles.cashoutBtnText}>
                ENCAISSER {(bet * mult).toFixed(2)} $
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#070b14",
    justifyContent: "space-between",
  },
  topBar: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    height: 36,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  backText: { fontSize: 12.5, fontWeight: "700", color: "#f8fafc" },
  titleCenter: { flexDirection: "row", alignItems: "center", gap: 6 },
  cockpitTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#f8fafc",
    letterSpacing: 0.6,
  },
  balancePill: {
    height: 36,
    borderRadius: 999,
    backgroundColor: "rgba(16, 185, 129, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.40)",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  balanceText: {
    fontSize: 13.5,
    fontWeight: "900",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
  gaugeCard: {
    marginHorizontal: 14,
    borderRadius: 24,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingVertical: 18,
    alignItems: "center",
    gap: 4,
  },
  multValue: {
    fontSize: 40,
    fontWeight: "900",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
    marginTop: 2,
  },
  payoutHint: {
    fontSize: 13,
    fontWeight: "600",
    color: "#94a3b8",
  },
  statusPill: {
    marginTop: 8,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  statusWin: { backgroundColor: "rgba(16, 185, 129, 0.24)" },
  statusCrash: { backgroundColor: "rgba(239, 68, 68, 0.26)" },
  statusText: { fontSize: 12.5, fontWeight: "800", color: "#ffffff" },
  dock: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: "#0f172a",
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 22,
    gap: 11,
  },
  stakesRow: { flexDirection: "row", gap: 7 },
  stakeChip: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  stakeChipActive: { backgroundColor: "#10b981" },
  stakeChipText: { fontSize: 12.5, fontWeight: "800", color: "#e2e8f0" },
  startBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: "#10b981",
    alignItems: "center",
    justifyContent: "center",
  },
  startBtnText: { fontSize: 14.5, fontWeight: "900", color: "#070b14" },
  activeControls: { gap: 9 },
  holdBtn: {
    height: 54,
    borderRadius: 14,
    backgroundColor: "#f59e0b",
    alignItems: "center",
    justifyContent: "center",
  },
  holdBtnPressed: { backgroundColor: "#ef4444" },
  holdBtnText: { fontSize: 14.5, fontWeight: "900", color: "#070b14" },
  cashoutBtn: {
    height: 46,
    borderRadius: 13,
    backgroundColor: "#10b981",
    alignItems: "center",
    justifyContent: "center",
  },
  cashoutBtnText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#070b14",
    fontVariant: ["tabular-nums"],
  },
});
