import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowLeft, Minus, Plus } from "lucide-react-native";
import { useApp } from "@/context/app-context";
import { api, ApiHttpError } from "@/lib/api";
import { Redirect, useRouter } from "@/lib/router";
import { triggerHaptic } from "@/theme/tokens";

const STAKES = [1, 2, 5, 10, 25, 50] as const;

interface PopItem {
  id: number;
  anim: Animated.Value;
}

/**
 * Jeu Tap & Win initial (« Remet le jeu tap initial ») :
 * Arène sombre #020617, anneau lumineux rotatif, bouton circulaire or #f9a602,
 * animations +1 flottantes, sélecteur de mise $ et encaissement instantané.
 */
export default function TapGameScreen() {
  const router = useRouter();
  const { user, authReady, balance, setBalance, hapticsEnabled } = useApp();

  const [bet, setBet] = useState<number>(2);
  const [phase, setPhase] = useState<
    "idle" | "playing" | "crashed" | "cashed"
  >("idle");
  const [multiplier, setMultiplier] = useState<number>(1.0);
  const [winBanner, setWinBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pops, setPops] = useState<PopItem[]>([]);

  const spinAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const popSeqRef = useRef(0);
  const pendingTapsRef = useRef(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 2800,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [spinAnim]);

  useEffect(() => {
    if (!user) return;
    api.tap
      .state()
      .then((res) => {
        if (typeof res.balance === "number") setBalance(res.balance);
      })
      .catch(() => {});
  }, [setBalance, user]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, []);

  if (authReady && !user) {
    return <Redirect href="/auth" />;
  }

  const spawnPop = () => {
    const id = ++popSeqRef.current;
    const anim = new Animated.Value(0);
    setPops((prev) => [...prev.slice(-5), { id, anim }]);
    Animated.timing(anim, {
      toValue: 1,
      duration: 650,
      useNativeDriver: true,
    }).start(() => {
      setPops((prev) => prev.filter((p) => p.id !== id));
    });
  };

  const flushTaps = async () => {
    flushTimerRef.current = null;
    if (phaseRef.current !== "playing" || pendingTapsRef.current <= 0) return;
    const batch = pendingTapsRef.current;
    pendingTapsRef.current = 0;

    try {
      const res = await api.tap.tapBatch(batch);
      if (res.status === "crashed") {
        pendingTapsRef.current = 0;
        setPhase("crashed");
        triggerHaptic("error", hapticsEnabled);
        setWinBanner("CRASH !");
        if (res.new_balance !== undefined) setBalance(Number(res.new_balance));
      } else if (res.status === "autocashout") {
        pendingTapsRef.current = 0;
        const m = Number(res.multiplier ?? multiplier);
        const w = Number(res.win_amount ?? bet * m);
        setMultiplier(m);
        setPhase("cashed");
        if (res.new_balance !== undefined) setBalance(Number(res.new_balance));
        triggerHaptic("success", hapticsEnabled);
        setWinBanner(`+${w.toFixed(2)} $`);
      } else if (res.multiplier !== undefined) {
        setMultiplier(Number(res.multiplier));
      }
    } catch {
      /* ignore */
    }
  };

  const handleStart = async () => {
    if (busy || bet > balance + 0.001) return;
    setBusy(true);
    setWinBanner(null);
    try {
      const res = await api.tap.startGame(bet);
      if (res.new_balance !== undefined) setBalance(Number(res.new_balance));
      setMultiplier(Number(res.multiplier ?? 1.0));
      setPhase("playing");
      triggerHaptic("medium", hapticsEnabled);
    } catch (err) {
      setWinBanner(
        err instanceof ApiHttpError ? err.message : "Mise refusée"
      );
    } finally {
      setBusy(false);
    }
  };

  const handleTapCircle = () => {
    if (phase === "idle" || phase === "crashed" || phase === "cashed") {
      void handleStart();
      return;
    }
    triggerHaptic("light", hapticsEnabled);
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.93,
        duration: 55,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        speed: 30,
      }),
    ]).start();
    spawnPop();
    pendingTapsRef.current += 1;
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(() => {
        void flushTaps();
      }, 140);
    }
  };

  const handleCashout = async () => {
    if (phase !== "playing" || busy) return;
    setBusy(true);
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (pendingTapsRef.current > 0) {
      await flushTaps();
    }
    if (phaseRef.current !== "playing") {
      setBusy(false);
      return;
    }
    try {
      const res = await api.tap.cashout();
      if (res.status === "crashed") {
        setPhase("crashed");
        triggerHaptic("error", hapticsEnabled);
        setWinBanner("CRASH !");
      } else {
        const m = Number(res.multiplier ?? multiplier);
        const w = Number(res.win_amount ?? bet * m);
        setMultiplier(m);
        setPhase("cashed");
        if (res.new_balance !== undefined) setBalance(Number(res.new_balance));
        triggerHaptic("success", hapticsEnabled);
        setWinBanner(`+${w.toFixed(2)} $`);
      }
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const rotateInterpolate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const livePayout = (bet * multiplier).toFixed(2);

  return (
    <SafeAreaView style={styles.screen}>
      {/* Barre supérieure sombre */}
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back("/jeux")}
          style={styles.backBtn}
        >
          <ArrowLeft size={18} color="#f8fafc" strokeWidth={2.3} />
          <Text style={styles.backLabel}>Jeux</Text>
        </Pressable>

        <View style={styles.balancePill}>
          <Text style={styles.dollarSign}>$</Text>
          <Text style={styles.balanceVal}>{balance.toFixed(2)}</Text>
        </View>
      </View>

      {/* Zone centrale : Multiplicateur + Anneau rotatif + Cercle Or #f9a602 */}
      <View style={styles.arena}>
        <Text
          style={[
            styles.multDisplay,
            phase === "crashed" && { color: "#ef4444" },
            phase === "cashed" && { color: "#22c55e" },
          ]}
        >
          ×{multiplier.toFixed(2)}
        </Text>

        {winBanner ? (
          <View
            style={[
              styles.bannerPill,
              phase === "crashed"
                ? styles.bannerCrash
                : styles.bannerWin,
            ]}
          >
            <Text style={styles.bannerText}>{winBanner}</Text>
          </View>
        ) : (
          <Text style={styles.subHint}>
            {phase === "playing"
              ? `Gain actuel : ${livePayout} $`
              : "Touchez le cercle d'or pour lancer et multiplier"}
          </Text>
        )}

        <View style={styles.circleStage}>
          <Animated.View
            style={[
              styles.conicRing,
              { transform: [{ rotate: rotateInterpolate }] },
            ]}
          >
            <LinearGradient
              colors={
                phase === "crashed"
                  ? ["#ef4444", "#7f1d1d", "#ef4444"]
                  : ["#f9a602", "#fde047", "#020617", "#f9a602"]
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
          </Animated.View>

          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            <Pressable onPress={handleTapCircle} style={styles.goldCircleWrap}>
              <LinearGradient
                colors={
                  phase === "crashed"
                    ? ["#dc2626", "#991b1b"]
                    : ["#fde047", "#f9a602", "#d97706"]
                }
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={styles.goldCircle}
              >
                <Text style={styles.goldMainText}>
                  {phase === "playing"
                    ? "TAP !"
                    : phase === "crashed"
                      ? "REJOUER"
                      : "JOUER"}
                </Text>
                <Text style={styles.goldSubText}>
                  {phase === "playing" ? "+ Cote" : `${bet.toFixed(2)} $`}
                </Text>
              </LinearGradient>
            </Pressable>
          </Animated.View>

          {pops.map((p) => (
            <Animated.View
              key={p.id}
              pointerEvents="none"
              style={[
                styles.popWrap,
                {
                  opacity: p.anim.interpolate({
                    inputRange: [0, 0.2, 1],
                    outputRange: [0, 1, 0],
                  }),
                  transform: [
                    {
                      translateY: p.anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-10, -95],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Text style={styles.popText}>+TAP</Text>
            </Animated.View>
          ))}
        </View>
      </View>

      {/* Panneau inférieur : Contrôle de mise $ + Bouton ENCAISSER */}
      <View style={styles.bottomDock}>
        <View style={styles.stakeRow}>
          <Pressable
            disabled={phase === "playing"}
            onPress={() => setBet((b) => Math.max(1, Math.round((b - 1) * 100) / 100))}
            style={[styles.stepBtn, phase === "playing" && { opacity: 0.4 }]}
          >
            <Minus size={16} color="#f8fafc" strokeWidth={2.5} />
          </Pressable>

          <View style={styles.stakeDisplay}>
            <Text style={styles.stakeCaption}>MISE ($)</Text>
            <Text style={styles.stakeVal}>{bet.toFixed(2)} $</Text>
          </View>

          <Pressable
            disabled={phase === "playing"}
            onPress={() =>
              setBet((b) => Math.min(100, Math.round((b + 1) * 100) / 100))
            }
            style={[styles.stepBtn, phase === "playing" && { opacity: 0.4 }]}
          >
            <Plus size={16} color="#f8fafc" strokeWidth={2.5} />
          </Pressable>
        </View>

        <View style={styles.presetsRow}>
          {STAKES.map((s) => {
            const active = Math.abs(bet - s) < 0.01;
            return (
              <Pressable
                key={s}
                disabled={phase === "playing"}
                onPress={() => setBet(s)}
                style={[
                  styles.presetChip,
                  active && styles.presetChipActive,
                  phase === "playing" && { opacity: 0.45 },
                ]}
              >
                <Text
                  style={[
                    styles.presetText,
                    active && styles.presetTextActive,
                  ]}
                >
                  {s} $
                </Text>
              </Pressable>
            );
          })}
        </View>

        {phase === "playing" ? (
          <Pressable
            disabled={busy || multiplier <= 1.0}
            onPress={handleCashout}
            style={[
              styles.cashoutBtn,
              (busy || multiplier <= 1.0) && { opacity: 0.6 },
            ]}
          >
            <Text style={styles.cashoutText}>
              ENCAISSER {livePayout} $
            </Text>
          </Pressable>
        ) : (
          <Pressable
            disabled={busy || bet > balance + 0.001}
            onPress={handleStart}
            style={[
              styles.startBtn,
              (busy || bet > balance + 0.001) && { opacity: 0.55 },
            ]}
          >
            <Text style={styles.startText}>
              LANCER LA MANCHE · {bet.toFixed(2)} $
            </Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#020617",
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
    height: 38,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  backLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#f8fafc",
  },
  balancePill: {
    height: 38,
    borderRadius: 999,
    backgroundColor: "rgba(249, 166, 2, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(249, 166, 2, 0.40)",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  dollarSign: {
    fontSize: 14,
    fontWeight: "900",
    color: "#f9a602",
  },
  balanceVal: {
    fontSize: 14.5,
    fontWeight: "900",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
  arena: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  multDisplay: {
    fontSize: 44,
    fontWeight: "900",
    color: "#f9a602",
    fontVariant: ["tabular-nums"],
    letterSpacing: -1,
  },
  subHint: {
    fontSize: 12.5,
    fontWeight: "600",
    color: "#94a3b8",
  },
  bannerPill: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 5,
  },
  bannerWin: {
    backgroundColor: "rgba(34, 197, 94, 0.22)",
  },
  bannerCrash: {
    backgroundColor: "rgba(239, 68, 68, 0.25)",
  },
  bannerText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#ffffff",
  },
  circleStage: {
    marginTop: 12,
    width: 214,
    height: 214,
    alignItems: "center",
    justifyContent: "center",
  },
  conicRing: {
    position: "absolute",
    width: 214,
    height: 214,
    borderRadius: 107,
    overflow: "hidden",
  },
  goldCircleWrap: {
    width: 194,
    height: 194,
    borderRadius: 97,
    padding: 5,
    backgroundColor: "#020617",
  },
  goldCircle: {
    flex: 1,
    borderRadius: 92,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  goldMainText: {
    fontSize: 25,
    fontWeight: "900",
    color: "#0f172a",
    letterSpacing: 0.5,
  },
  goldSubText: {
    fontSize: 13,
    fontWeight: "800",
    color: "rgba(15, 23, 42, 0.78)",
  },
  popWrap: {
    position: "absolute",
  },
  popText: {
    fontSize: 18,
    fontWeight: "900",
    color: "#fde047",
  },
  bottomDock: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: "#0f172a",
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 20,
    gap: 11,
  },
  stakeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.09)",
    alignItems: "center",
    justifyContent: "center",
  },
  stakeDisplay: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  stakeCaption: {
    fontSize: 9.5,
    fontWeight: "700",
    color: "#94a3b8",
  },
  stakeVal: {
    fontSize: 15,
    fontWeight: "900",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
  presetsRow: {
    flexDirection: "row",
    gap: 6,
  },
  presetChip: {
    flex: 1,
    height: 32,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  presetChipActive: {
    backgroundColor: "#f9a602",
  },
  presetText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#e2e8f0",
  },
  presetTextActive: {
    color: "#0f172a",
  },
  startBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: "#f9a602",
    alignItems: "center",
    justifyContent: "center",
  },
  startText: {
    fontSize: 14.5,
    fontWeight: "900",
    color: "#0f172a",
  },
  cashoutBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: "#10b981",
    alignItems: "center",
    justifyContent: "center",
  },
  cashoutText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
});
