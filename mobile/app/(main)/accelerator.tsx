import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { useRouter } from "expo-router";
import { ArrowLeft, Gauge } from "lucide-react-native";
import { api } from "@/lib/api";
import { eur } from "@/lib/format";
import { colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

const BET_CHIPS = [1, 2, 5, 10, 25];

/**
 * Jeu `/accelerator` (`Accelerator Pro`) en React Native Android :
 * - Jauge semi-circulaire SVG native + maintien tactile pour accélérer + Cash Out instantané.
 */
export default function AcceleratorScreen() {
  const router = useRouter();
  const { user, balance, setBalance, hapticsEnabled, toast } = useApp();

  const [bet, setBet] = useState<number>(2);
  const [phase, setPhase] = useState<"idle" | "ready" | "holding" | "crashed" | "cashed">("idle");
  const [multiplier, setMultiplier] = useState<number>(1.0);
  const [winAmount, setWinAmount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdingActiveRef = useRef<boolean>(false);

  const stopHoldLoop = () => {
    holdingActiveRef.current = false;
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopHoldLoop();
  }, []);

  const handleStartRound = async () => {
    if (!user) {
      router.push("/auth");
      return;
    }
    if (bet > balance) {
      toast({ kind: "error", title: "Solde insuffisant" });
      return;
    }
    setBusy(true);
    try {
      const res = await api.accelerator.startGame(bet);
      setBalance(res.new_balance);
      setMultiplier(res.multiplier || 1.0);
      setWinAmount(null);
      setPhase("ready");
      triggerHaptic("medium", hapticsEnabled);
    } catch (err) {
      toast({
        kind: "error",
        title: "Impossible de lancer la manche",
        subtitle: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePressInPedal = async () => {
    if (phase !== "ready" && phase !== "holding") return;
    holdingActiveRef.current = true;
    setPhase("holding");
    triggerHaptic("light", hapticsEnabled);

    try {
      const startRes = await api.accelerator.holdStart();
      if (startRes.status === "crashed") {
        stopHoldLoop();
        setMultiplier(startRes.multiplier);
        setPhase("crashed");
        triggerHaptic("error", hapticsEnabled);
        return;
      }
      setMultiplier(startRes.multiplier);
    } catch {
      stopHoldLoop();
      return;
    }

    holdIntervalRef.current = setInterval(async () => {
      if (!holdingActiveRef.current) return;
      try {
        const tick = await api.accelerator.tickHold(false);
        setMultiplier(tick.multiplier);
        if (tick.status === "crashed") {
          stopHoldLoop();
          setPhase("crashed");
          triggerHaptic("error", hapticsEnabled);
        } else if (tick.status === "cashed") {
          stopHoldLoop();
          if (typeof tick.new_balance === "number") setBalance(tick.new_balance);
          setWinAmount(tick.win_amount ?? bet * tick.multiplier);
          setPhase("cashed");
          triggerHaptic("success", hapticsEnabled);
        } else {
          triggerHaptic("light", hapticsEnabled);
        }
      } catch {
        // Tolérance micro-coupure
      }
    }, 360);
  };

  const handlePressOutPedal = () => {
    if (!holdingActiveRef.current) return;
    stopHoldLoop();
    void api.accelerator
      .tickHold(true)
      .then((res) => {
        setMultiplier(res.multiplier);
        if (res.status === "crashed") {
          setPhase("crashed");
          triggerHaptic("error", hapticsEnabled);
        }
      })
      .catch(() => {});
  };

  const handleCashout = async () => {
    stopHoldLoop();
    setBusy(true);
    try {
      const res = await api.accelerator.cashout(multiplier);
      setMultiplier(res.multiplier);
      if (res.status === "cashed") {
        if (typeof res.new_balance === "number") setBalance(res.new_balance);
        setWinAmount(res.win_amount ?? bet * res.multiplier);
        setPhase("cashed");
        triggerHaptic("success", hapticsEnabled);
      } else {
        setPhase("crashed");
        triggerHaptic("error", hapticsEnabled);
      }
    } catch (err) {
      toast({
        kind: "error",
        title: "Encaissement échoué",
        subtitle: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const progress = Math.min(1, Math.log10(Math.max(1, multiplier)) / 1.4);
  const strokeColor =
    phase === "crashed"
      ? "#ef4444"
      : progress > 0.65
        ? "#f59e0b"
        : "#10b981";

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={18} color={colors.white} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.title}>ACCELERATOR PRO</Text>
        <View style={{ width: 34 }} />
      </View>

      <View style={styles.gaugeZone}>
        <Svg width={250} height={140} viewBox="0 0 250 140">
          <Path
            d="M 25 125 A 100 100 0 0 1 225 125"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="16"
            strokeLinecap="round"
            fill="none"
          />
          <Path
            d="M 25 125 A 100 100 0 0 1 225 125"
            stroke={strokeColor}
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={`${Math.round(progress * 314)} 314`}
            fill="none"
          />
        </Svg>

        <Text
          style={[
            styles.multVal,
            phase === "crashed" && { color: "#f87171" },
            phase === "cashed" && { color: "#34d399" },
          ]}
        >
          ×{multiplier.toFixed(2)}
        </Text>
        <Text style={styles.subInfo}>
          {phase === "ready" || phase === "holding"
            ? `Gain potentiel : ${eur(bet * multiplier)}`
            : phase === "cashed" && winAmount !== null
              ? `ENCAISSÉ : +${eur(winAmount)}`
              : phase === "crashed"
                ? "SURCHAUFFE MOTEUR · CRASH !"
                : "Engagez une mise puis maintenez la pédale d'accélération"}
        </Text>

        {(phase === "ready" || phase === "holding") && (
          <Pressable
            onPressIn={() => void handlePressInPedal()}
            onPressOut={handlePressOutPedal}
            style={[
              styles.pedalBtn,
              phase === "holding" && styles.pedalBtnActive,
            ]}
          >
            <Gauge size={34} color={colors.white} strokeWidth={2.3} />
            <Text style={styles.pedalText}>
              {phase === "holding" ? "ACCÉLÉRATION…" : "MAINTENIR POUR ACCÉLÉRER"}
            </Text>
          </Pressable>
        )}
      </View>

      <View style={styles.controls}>
        <View style={styles.chipsRow}>
          {BET_CHIPS.map((c) => {
            const active = bet === c;
            return (
              <Pressable
                key={c}
                disabled={phase === "ready" || phase === "holding"}
                onPress={() => setBet(c)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && { color: colors.ink }]}>
                  {c} €
                </Text>
              </Pressable>
            );
          })}
        </View>

        {phase === "ready" || phase === "holding" ? (
          <Pressable
            disabled={busy || multiplier <= 1.0}
            onPress={() => void handleCashout()}
            style={[
              styles.cashoutBtn,
              multiplier <= 1.0 && { opacity: 0.5 },
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.actionText}>
                ENCAISSER {eur(bet * multiplier)}
              </Text>
            )}
          </Pressable>
        ) : (
          <Pressable
            disabled={busy}
            onPress={() => void handleStartRound()}
            style={styles.startBtn}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.actionText}>
                DÉMARRER · MISE {eur(bet)}
              </Text>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#090d16",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 15.5,
    fontWeight: "900",
    letterSpacing: 1.1,
    color: colors.white,
  },
  gaugeZone: {
    alignItems: "center",
    gap: 10,
  },
  multVal: {
    marginTop: -24,
    fontSize: 44,
    fontWeight: "900",
    color: colors.white,
    fontVariant: ["tabular-nums"],
  },
  subInfo: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#94a3b8",
    textAlign: "center",
  },
  pedalBtn: {
    marginTop: 12,
    width: "100%",
    height: 92,
    borderRadius: 20,
    backgroundColor: "#1e293b",
    borderWidth: 2,
    borderColor: "#38bdf8",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  pedalBtnActive: {
    backgroundColor: colors.betclicRed,
    borderColor: "#fca5a5",
  },
  pedalText: {
    fontSize: 13.5,
    fontWeight: "900",
    color: colors.white,
    letterSpacing: 0.5,
  },
  controls: {
    gap: 12,
    paddingBottom: 10,
  },
  chipsRow: {
    flexDirection: "row",
    gap: 7,
  },
  chip: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: colors.white,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.white,
  },
  startBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: colors.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  cashoutBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: "#059669",
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    fontSize: 15,
    fontWeight: "900",
    color: colors.white,
  },
});
