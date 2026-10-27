import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { ArrowLeft, Flame, Zap } from "lucide-react-native";
import { api } from "@/lib/api";
import { eur } from "@/lib/format";
import { colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

const BET_CHIPS = [1, 2, 5, 10, 25];

/**
 * Jeu initial `/tap` (`Tap Win`) porté en React Native Android,
 * avec agrégation des frappes (`tap_batch` toutes les 250 ms) pour minimiser les requêtes HTTP.
 */
export default function TapGameScreen() {
  const router = useRouter();
  const { user, balance, setBalance, hapticsEnabled, toast } = useApp();

  const [bet, setBet] = useState<number>(2);
  const [phase, setPhase] = useState<"idle" | "playing" | "crashed" | "won">("idle");
  const [multiplier, setMultiplier] = useState<number>(1.0);
  const [growthFactor, setGrowthFactor] = useState<number>(1.06);
  const [lastWin, setLastWin] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const pendingTapsRef = useRef<number>(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushingRef = useRef<boolean>(false);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, []);

  const flushBatch = async () => {
    if (flushingRef.current || pendingTapsRef.current <= 0) return;
    const count = pendingTapsRef.current;
    pendingTapsRef.current = 0;
    flushingRef.current = true;
    try {
      const res = await api.tap.tapBatch(count);
      setMultiplier(res.multiplier);
      if (res.status === "crashed") {
        setPhase("crashed");
        if (typeof res.new_balance === "number") setBalance(res.new_balance);
        triggerHaptic("error", hapticsEnabled);
      } else if (res.status === "autocashout") {
        setPhase("won");
        setLastWin(res.win_amount ?? bet * res.multiplier);
        if (typeof res.new_balance === "number") setBalance(res.new_balance);
        triggerHaptic("success", hapticsEnabled);
      }
    } catch {
      // Silencieux
    } finally {
      flushingRef.current = false;
      if (pendingTapsRef.current > 0 && phase === "playing") {
        void flushBatch();
      }
    }
  };

  const handleStart = async () => {
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
      const res = await api.tap.startGame(bet);
      setBalance(res.new_balance);
      setMultiplier(res.multiplier);
      setGrowthFactor(res.factor || 1.06);
      setLastWin(null);
      pendingTapsRef.current = 0;
      setPhase("playing");
      triggerHaptic("medium", hapticsEnabled);
    } catch (err) {
      toast({
        kind: "error",
        title: "Impossible de démarrer",
        subtitle: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleTapOrb = () => {
    if (phase !== "playing") return;
    triggerHaptic("light", hapticsEnabled);

    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.92,
        duration: 55,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();

    // Retour visuel optimiste immédiat + envoi groupé `tap_batch` toutes les 240 ms
    setMultiplier((m) => Math.round(m * growthFactor * 100) / 100);
    pendingTapsRef.current += 1;
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        void flushBatch();
      }, 240);
    }
  };

  const handleCashout = async () => {
    if (phase !== "playing" || busy) return;
    setBusy(true);
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    try {
      if (pendingTapsRef.current > 0) {
        await flushBatch();
      }
      const res = await api.tap.cashout();
      setBalance(res.new_balance);
      setLastWin(res.win_amount);
      setPhase("won");
      triggerHaptic("success", hapticsEnabled);
    } catch (err) {
      toast({
        kind: "error",
        title: "Encaissement impossible",
        subtitle: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={18} color={colors.white} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.title}>TAP WIN</Text>
        <View style={{ width: 34 }} />
      </View>

      <View style={styles.arena}>
        <Text
          style={[
            styles.multDisplay,
            phase === "crashed" && { color: "#f87171" },
            phase === "won" && { color: "#34d399" },
          ]}
        >
          ×{multiplier.toFixed(2)}
        </Text>
        <Text style={styles.statusSub}>
          {phase === "playing"
            ? `Gain actuel : ${eur(bet * multiplier)}`
            : phase === "crashed"
              ? "EXPLOSÉ ! Retentez votre chance"
              : phase === "won" && lastWin !== null
                ? `ENCAISSÉ : +${eur(lastWin)}`
                : "Appuyez sur l'orbe pour faire monter la cote"}
        </Text>

        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          <Pressable
            disabled={phase !== "playing"}
            onPress={handleTapOrb}
            style={[
              styles.orb,
              phase === "crashed" && styles.orbCrashed,
              phase === "won" && styles.orbWon,
            ]}
          >
            {phase === "crashed" ? (
              <Flame size={48} color={colors.white} />
            ) : (
              <Zap size={50} color={colors.white} fill={colors.white} />
            )}
            <Text style={styles.orbLabel}>
              {phase === "playing" ? "TAP !" : "PULSE"}
            </Text>
          </Pressable>
        </Animated.View>
      </View>

      <View style={styles.controls}>
        <View style={styles.chipsRow}>
          {BET_CHIPS.map((c) => {
            const active = bet === c;
            return (
              <Pressable
                key={c}
                disabled={phase === "playing"}
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

        {phase === "playing" ? (
          <Pressable
            disabled={busy}
            onPress={() => void handleCashout()}
            style={styles.cashoutBtn}
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
            onPress={() => void handleStart()}
            style={styles.startBtn}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.actionText}>
                JOUER · MISE {eur(bet)}
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
    backgroundColor: "#0b0f1a",
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
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1.2,
    color: colors.white,
  },
  arena: {
    alignItems: "center",
    gap: 14,
  },
  multDisplay: {
    fontSize: 48,
    fontWeight: "900",
    color: colors.white,
    fontVariant: ["tabular-nums"],
  },
  statusSub: {
    fontSize: 13,
    fontWeight: "700",
    color: "#94a3b8",
  },
  orb: {
    marginTop: 12,
    width: 176,
    height: 176,
    borderRadius: 88,
    backgroundColor: colors.betclicRed,
    borderWidth: 5,
    borderColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    elevation: 8,
  },
  orbCrashed: {
    backgroundColor: "#374151",
  },
  orbWon: {
    backgroundColor: "#059669",
  },
  orbLabel: {
    fontSize: 18,
    fontWeight: "900",
    color: colors.white,
    letterSpacing: 1,
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
