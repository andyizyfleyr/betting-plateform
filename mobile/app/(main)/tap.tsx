import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle } from "react-native-svg";
import {
  Eye,
  EyeOff,
  HandCoins,
  Play,
  Trophy,
} from "lucide-react-native";
import { useApp } from "@/context/app-context";
import { api } from "@/lib/api";
import { useRouter } from "@/lib/router";
import { triggerHaptic } from "@/theme/tokens";

const SYM = "$";
const DEC = 2;
const MIN_BET = 1;
const MAX_BET = 100;

interface Game {
  active: boolean;
  clicks: number;
  mult: number;
  bet: number;
}

interface ModalState {
  show: boolean;
  type: "win" | "lose";
  title: string;
  msg: string;
  amount: string;
  bet: number;
  mult: number;
}

interface PopItem {
  id: number;
  x: number;
  y: number;
  rot: number;
  anim: Animated.Value;
}

interface ConfettiPiece {
  id: number;
  leftPct: number;
  col: string;
  anim: Animated.Value;
}

function fmt(n: number): string {
  const safe = Number.isFinite(n) ? n : 0;
  const fixed = safe.toFixed(DEC).replace(".", ",");
  const [intPart, decPart] = fixed.split(",");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped},${decPart} ${SYM}`;
}

export default function TapScreen() {
  const router = useRouter();
  const { user, setBalance, hapticsEnabled } = useApp();

  const [bal, setBal] = useState<number>(() => user?.balance ?? 0);
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [balFlash, setBalFlash] = useState(false);
  const [game, setGame] = useState<Game>({
    active: false,
    clicks: 0,
    mult: 1.0,
    bet: 0,
  });
  const [growth, setGrowth] = useState(1.05);
  const [locked, setLocked] = useState(false);
  const [crashed, setCrashed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [stake, setStake] = useState("1.00");
  const [sliderPct, setSliderPct] = useState(0);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<ModalState>({
    show: false,
    type: "win",
    title: "",
    msg: "",
    amount: "",
    bet: 0,
    mult: 1.0,
  });
  const [pops, setPops] = useState<PopItem[]>([]);
  const [confetti, setConfetti] = useState<ConfettiPiece[]>([]);

  const ringSpin = useRef(new Animated.Value(0)).current;
  const tapScale = useRef(new Animated.Value(1)).current;

  const gameRef = useRef(game);
  const activeRef = useRef(game.active);
  const multRef = useRef(game.mult);
  const balRef = useRef(bal);
  const pendingRef = useRef(0);
  const isSyncingRef = useRef(false);
  const lockRef = useRef(false);
  const lastPopRef = useRef(0);
  const popIdRef = useRef(0);
  const confIdRef = useRef(0);
  const endRef = useRef<
    (
      d: {
        multiplier?: string | number;
        new_balance?: string | number;
        win_amount?: string | number;
      },
      win: boolean
    ) => void
  >(() => {});

  const screen = Dimensions.get("window");
  const circleSize = Math.min(
    Math.round(screen.width * 0.82),
    Math.round(screen.height * 0.44),
    360
  );

  // Rotation continue de l'anneau multicolore (20s linear infinite comme tap-game.module.css)
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(ringSpin, {
        toValue: 1,
        duration: 20_000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [ringSpin]);

  const upGame = useCallback((patch: Partial<Game>) => {
    setGame((prev) => {
      const next = { ...prev, ...patch };
      gameRef.current = next;
      activeRef.current = next.active;
      multRef.current = next.mult;
      return next;
    });
  }, []);

  const syncGlobalBal = useCallback(
    (next: number) => {
      setBal(next);
      setBalance(next);
    },
    [setBalance]
  );

  const fireConfetti = useCallback(() => {
    const cols = ["#f9a602", "#ffd700", "#e74c3c", "#2ecc71", "#3498db"];
    const pieces: ConfettiPiece[] = Array.from({ length: 26 }, () => ({
      id: ++confIdRef.current,
      leftPct: Math.random() * 94 + 3,
      col: cols[Math.floor(Math.random() * cols.length)],
      anim: new Animated.Value(0),
    }));
    setConfetti(pieces);
    for (const p of pieces) {
      Animated.timing(p.anim, {
        toValue: 1,
        duration: 2200 + Math.random() * 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
    }
    setTimeout(() => setConfetti([]), 3800);
  }, []);

  const addPop = useCallback((x: number, y: number) => {
    const id = ++popIdRef.current;
    const anim = new Animated.Value(0);
    const rot = Math.round((Math.random() - 0.5) * 36);
    setPops((prev) => [...prev.slice(-12), { id, x, y, rot, anim }]);
    Animated.timing(anim, {
      toValue: 1,
      duration: 500,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setPops((prev) => prev.filter((p) => p.id !== id));
    });
  }, []);

  const end = useCallback(
    (
      d: {
        multiplier?: string | number;
        new_balance?: string | number;
        win_amount?: string | number;
      },
      win: boolean
    ) => {
      upGame({ active: false });
      pendingRef.current = 0;
      lockRef.current = false;
      setLocked(false);
      if (d.multiplier !== undefined) {
        upGame({ mult: parseFloat(String(d.multiplier)) });
      }
      if (d.new_balance !== undefined) {
        syncGlobalBal(parseFloat(String(d.new_balance)));
      }

      if (win) {
        triggerHaptic("success", hapticsEnabled);
        fireConfetti();
        setModal({
          show: true,
          type: "win",
          title: "Encaissé !",
          msg: "Félicitations",
          amount: "Gain : " + fmt(Number(d.win_amount ?? 0)),
          bet: gameRef.current.bet,
          mult: gameRef.current.mult,
        });
      } else {
        triggerHaptic("error", hapticsEnabled);
        setCrashed(true);
        setModal({
          show: true,
          type: "lose",
          title: gameRef.current.bet > 10 ? "Aïe, ça pique..." : "Crashed !",
          msg: "Dommage",
          amount: "Perte : " + fmt(gameRef.current.bet),
          bet: gameRef.current.bet,
          mult: gameRef.current.mult,
        });
      }

      setTimeout(() => {
        setCrashed(false);
        setLoading(false);
        setPlaying(false);
        upGame({ mult: 1.0, bet: 0 });
      }, 1500);
    },
    [fireConfetti, hapticsEnabled, syncGlobalBal, upGame]
  );

  useEffect(() => {
    gameRef.current = game;
    activeRef.current = game.active;
    multRef.current = game.mult;
    balRef.current = bal;
    endRef.current = end;
  }, [bal, end, game]);

  const getBounds = useCallback(() => {
    const effectiveMax = Math.max(MIN_BET, Math.min(balRef.current, MAX_BET));
    return { min: MIN_BET, max: effectiveMax };
  }, []);

  const clampPct = (n: number) => Math.max(0, Math.min(100, n));

  const onSliderChange = useCallback(
    (percent: number) => {
      const pct = clampPct(percent);
      const b = getBounds();
      let amount = b.min + ((b.max - b.min) * pct) / 100;
      if (pct >= 100) amount = b.max;
      if (pct <= 0) amount = b.min;
      setStake(amount.toFixed(DEC));
      setSliderPct(pct);
    },
    [getBounds]
  );

  const onStakeChange = (val: string) => {
    const clean = val.replace(/[^0-9.,]/g, "").replace(",", ".");
    setStake(clean);
    if (clean === "") {
      setSliderPct(0);
      return;
    }
    const num = parseFloat(clean);
    const b = getBounds();
    if (!isNaN(num) && num > b.max) {
      setStake(b.max.toFixed(DEC));
      setSliderPct(100);
      return;
    }
    if (isNaN(num)) {
      setSliderPct(0);
    } else {
      const range = b.max - b.min;
      const pct =
        range <= 0 ? (num >= b.max ? 100 : 0) : ((num - b.min) / range) * 100;
      setSliderPct(clampPct(pct));
    }
  };

  const onStakeBlur = () => {
    const num = parseFloat(stake);
    const b = getBounds();
    if (isNaN(num) || num < b.min) {
      setStake(b.min.toFixed(DEC));
      setSliderPct(0);
    }
  };

  const start = async () => {
    if (!user) {
      router.push("/auth");
      return;
    }
    if (isSyncingRef.current) return;
    const amt = parseFloat(stake);
    if (isNaN(amt) || amt <= 0) {
      setError("Mise invalide");
      return;
    }
    if (amt < MIN_BET) {
      setError(`Mise minimale : ${MIN_BET} ${SYM}`);
      setStake(MIN_BET.toFixed(DEC));
      setSliderPct(0);
      return;
    }
    isSyncingRef.current = true;
    setError("");
    setLoading(true);
    try {
      const d = await api.tap.post({ action: "start_game", bet: amt });
      if (d.status === "success") {
        if (d.new_balance !== undefined) {
          syncGlobalBal(parseFloat(String(d.new_balance)));
        }
        pendingRef.current = 0;
        lockRef.current = false;
        setLocked(false);
        setCrashed(false);
        if (d.factor) setGrowth(parseFloat(String(d.factor)));
        upGame({
          active: true,
          clicks: 0,
          mult: d.multiplier ? parseFloat(String(d.multiplier)) : 1.0,
          bet: amt,
        });
        setLoading(false);
        setPlaying(true);
      } else {
        setError(d.message || "Erreur");
        setLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
      setLoading(false);
    }
    isSyncingRef.current = false;
  };

  const cashout = async () => {
    if (!activeRef.current || isSyncingRef.current) return;
    isSyncingRef.current = true;
    try {
      const d = await api.tap.post({ action: "cashout" });
      if (d.status === "success") {
        endRef.current(d, true);
      } else if (d.message === "Jeu inactif") {
        endRef.current({ multiplier: multRef.current }, false);
      } else if (d.message) {
        setError(d.message);
      }
    } catch {
      /* silencieux */
    }
    isSyncingRef.current = false;
  };

  const action = () => {
    if (activeRef.current) void cashout();
    else void start();
  };

  const handleTap = (e: GestureResponderEvent) => {
    if (!activeRef.current || lockRef.current) return;

    triggerHaptic("light", hapticsEnabled);
    const now = Date.now();
    if (now - lastPopRef.current > 80) {
      lastPopRef.current = now;
      addPop(e.nativeEvent.pageX, e.nativeEvent.pageY);
    }

    tapScale.setValue(0.96);
    Animated.spring(tapScale, {
      toValue: 1,
      speed: 28,
      bounciness: 6,
      useNativeDriver: true,
    }).start();

    pendingRef.current += 1;
    const newClicks = gameRef.current.clicks + 1;
    const newMult = Math.floor(1.0 * Math.pow(growth, newClicks) * 100) / 100;
    upGame({ clicks: newClicks, mult: newMult });

    lockRef.current = true;
    setLocked(true);
    setTimeout(() => {
      if (activeRef.current) {
        lockRef.current = false;
        setLocked(false);
      }
    }, 1000);
  };

  // Chargement initial du solde
  useEffect(() => {
    api.tap
      .state()
      .then((d) => {
        if (d.status === "success" && typeof d.balance === "number") {
          syncGlobalBal(d.balance);
          setStake(Math.min(MIN_BET, Math.max(MIN_BET, d.balance)).toFixed(DEC));
        }
      })
      .catch(() => {});
  }, [syncGlobalBal]);

  // Synchronisation batch des clics toutes les 300 ms
  useEffect(() => {
    const id = setInterval(async () => {
      if (
        !activeRef.current ||
        pendingRef.current === 0 ||
        isSyncingRef.current
      ) {
        return;
      }
      isSyncingRef.current = true;
      const count = pendingRef.current;
      pendingRef.current = 0;
      try {
        const d = await api.tap.post({ action: "tap_batch", count });
        if (d.status === "crashed") endRef.current(d, false);
        else if (d.status === "autocashout") endRef.current(d, true);
        else if (d.status === "ok" && d.multiplier !== undefined) {
          const sM = parseFloat(String(d.multiplier));
          if (Math.abs(sM - multRef.current) > 0.1) upGame({ mult: sM });
        }
      } catch {
        pendingRef.current += count;
      }
      isSyncingRef.current = false;
    }, 300);
    return () => clearInterval(id);
  }, [upGame]);

  // Rafraîchissement du solde hors partie (5 s)
  useEffect(() => {
    const id = setInterval(async () => {
      if (activeRef.current) return;
      try {
        const d = await api.tap.state();
        if (
          d.status === "success" &&
          typeof d.balance === "number" &&
          Math.abs(balRef.current - d.balance) > 0.01
        ) {
          syncGlobalBal(d.balance);
          setBalFlash(true);
          setTimeout(() => setBalFlash(false), 500);
        }
      } catch {
        /* silencieux */
      }
    }, 5000);
    return () => clearInterval(id);
  }, [syncGlobalBal]);

  const spinInterpolate = ringSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const balText = balanceHidden ? "******" : fmt(bal).replace(SYM, "").trim();
  const circumference = Math.PI * (circleSize - 10);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      {/* En-tête identique à src/app/(main)/tap/page.tsx */}
      <View style={styles.header}>
        <Text style={styles.logo}>
          Tap <Text style={styles.logoGold}>Win</Text>
        </Text>

        <View style={styles.headerRight}>
          <View style={styles.balancePill}>
            <Text
              style={[
                styles.amountHl,
                balFlash && { color: "#4ade80" },
              ]}
            >
              {balText}
            </Text>
            <Text style={styles.symText}>{SYM}</Text>
            <Pressable
              hitSlop={8}
              onPress={() => setBalanceHidden((h) => !h)}
            >
              {balanceHidden ? (
                <EyeOff size={16} color="#9ca3af" strokeWidth={2} />
              ) : (
                <Eye size={16} color="#9ca3af" strokeWidth={2} />
              )}
            </Pressable>
          </View>

          <Pressable
            onPress={() => router.push("/predictions")}
            style={styles.trophyBtn}
          >
            <Trophy size={16} color="#f9a602" strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      {/* Zone centrale avec anneau rotatif + disque or */}
      <View style={styles.matchBox}>
        <View
          style={{
            width: circleSize,
            height: circleSize,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Anneau multicolore rotatif (#22c55e -> #ffd700 -> #f9a602 -> #ef4444) */}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFillObject,
              { transform: [{ rotate: spinInterpolate }] },
            ]}
          >
            <Svg width={circleSize} height={circleSize}>
              {[
                { color: "#22c55e", offset: 0 },
                { color: "#ffd700", offset: 0.25 },
                { color: "#f9a602", offset: 0.5 },
                { color: "#ef4444", offset: 0.75 },
              ].map((seg) => (
                <Circle
                  key={seg.color}
                  cx={circleSize / 2}
                  cy={circleSize / 2}
                  r={(circleSize - 10) / 2}
                  stroke={seg.color}
                  strokeWidth={10}
                  fill="none"
                  strokeDasharray={`${circumference * 0.26} ${circumference}`}
                  strokeDashoffset={-circumference * seg.offset}
                />
              ))}
            </Svg>
          </Animated.View>

          {/* Cercle central cliquable */}
          <Animated.View
            style={[
              {
                width: circleSize * 0.9,
                height: circleSize * 0.9,
                borderRadius: (circleSize * 0.9) / 2,
                transform: [{ scale: tapScale }],
                opacity: locked ? 0.5 : 1,
              },
            ]}
          >
            <Pressable
              onPress={handleTap}
              style={{ flex: 1, borderRadius: (circleSize * 0.9) / 2 }}
            >
              <LinearGradient
                colors={
                  crashed ? ["#ef4444", "#550000"] : ["#f9a602", "#e65100"]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[
                  styles.circleInner,
                  { borderRadius: (circleSize * 0.9) / 2 },
                ]}
              >
                <Text
                  style={[
                    styles.multiplierDisplay,
                    { fontSize: Math.round(circleSize * 0.21) },
                  ]}
                >
                  x{game.mult.toFixed(2)}
                </Text>
                <Text style={styles.gainLabel}>Gain actuel</Text>
                <Text style={styles.gainValue}>
                  {fmt(game.bet * game.mult)}
                </Text>
              </LinearGradient>
            </Pressable>
          </Animated.View>
        </View>
      </View>

      {/* Panneau de contrôles mobile bas */}
      <View style={styles.mobileControlsPanel}>
        <StakeSliderControl
          stake={stake}
          sliderPct={sliderPct}
          onStake={onStakeChange}
          onBlur={onStakeBlur}
          onSlider={onSliderChange}
          disabled={playing}
        />

        <Pressable
          disabled={loading && !playing}
          onPress={action}
          style={({ pressed }) => [
            styles.btnPlace,
            playing && styles.btnCashout,
            loading && !playing && styles.btnDisabled,
            pressed && { transform: [{ scale: 0.985 }] },
          ]}
        >
          {playing ? (
            <HandCoins size={20} color="#ffffff" strokeWidth={2.2} />
          ) : (
            <Play
              size={20}
              color={loading ? "#6b7280" : "#000000"}
              strokeWidth={2.2}
            />
          )}
          <Text
            style={[
              styles.btnPlaceText,
              playing && { color: "#ffffff" },
              loading && !playing && { color: "#6b7280" },
            ]}
          >
            {playing ? "ENCAISSER" : "JOUER"}
          </Text>
        </Pressable>

        <Text style={styles.errorMsg}>{error}</Text>
      </View>

      {/* Pops +1 flottants */}
      {pops.map((p) => {
        const translateY = p.anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -70],
        });
        const opacity = p.anim.interpolate({
          inputRange: [0, 0.25, 1],
          outputRange: [0, 1, 0],
        });
        const scale = p.anim.interpolate({
          inputRange: [0, 0.3, 1],
          outputRange: [0.6, 1.3, 1],
        });
        return (
          <Animated.View
            key={p.id}
            pointerEvents="none"
            style={[
              styles.tapPop,
              {
                left: p.x - 22,
                top: p.y - 36,
                opacity,
                transform: [
                  { translateY },
                  { scale },
                  { rotate: `${p.rot}deg` },
                ],
              },
            ]}
          >
            <Text style={styles.tapPopText}>+1</Text>
          </Animated.View>
        );
      })}

      {/* Confettis en cas de gain */}
      {confetti.length > 0 ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
          {confetti.map((c) => {
            const translateY = c.anim.interpolate({
              inputRange: [0, 1],
              outputRange: [-20, screen.height + 30],
            });
            const rotate = c.anim.interpolate({
              inputRange: [0, 1],
              outputRange: ["0deg", "360deg"],
            });
            return (
              <Animated.View
                key={c.id}
                style={[
                  styles.confettiPiece,
                  {
                    left: `${c.leftPct}%`,
                    backgroundColor: c.col,
                    transform: [{ translateY }, { rotate }],
                  },
                ]}
              />
            );
          })}
        </View>
      ) : null}

      {/* Modale de résultat */}
      <Modal
        visible={modal.show}
        transparent
        animationType="fade"
        onRequestClose={() => setModal((m) => ({ ...m, show: false }))}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalBox,
              modal.type === "win" ? styles.modalWin : styles.modalLose,
            ]}
          >
            <Text
              style={[
                styles.modalTitle,
                { color: modal.type === "win" ? "#22c55e" : "#ef4444" },
              ]}
            >
              {modal.title}
            </Text>
            <Text style={styles.modalMsg}>{modal.msg}</Text>

            <View style={styles.modalDetails}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Mise :</Text>
                <Text style={styles.detailValue}>{fmt(modal.bet)}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Multiplicateur :</Text>
                <Text style={[styles.detailValue, { color: "#f9a602" }]}>
                  x{modal.mult.toFixed(2)}
                </Text>
              </View>
            </View>

            <Text style={styles.modalAmount}>{modal.amount}</Text>

            <Pressable
              onPress={() => setModal((m) => ({ ...m, show: false }))}
              style={styles.btnCloseModal}
            >
              <Text style={styles.btnCloseModalText}>Fermer</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function StakeSliderControl({
  stake,
  sliderPct,
  onStake,
  onBlur,
  onSlider,
  disabled,
}: {
  stake: string;
  sliderPct: number;
  onStake: (val: string) => void;
  onBlur: () => void;
  onSlider: (pct: number) => void;
  disabled: boolean;
}) {
  const trackWidthRef = useRef(0);
  const startPctRef = useRef(0);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onPanResponderGrant: (evt) => {
          const w = trackWidthRef.current;
          if (w <= 0) return;
          const pct = Math.max(
            0,
            Math.min(100, (evt.nativeEvent.locationX / w) * 100)
          );
          startPctRef.current = pct;
          onSlider(pct);
        },
        onPanResponderMove: (_, g) => {
          const w = trackWidthRef.current;
          if (w <= 0) return;
          const pct = Math.max(
            0,
            Math.min(100, startPctRef.current + (g.dx / w) * 100)
          );
          onSlider(pct);
        },
      }),
    [disabled, onSlider]
  );

  return (
    <View>
      <View style={styles.inputGroup}>
        <TextInput
          value={stake}
          onChangeText={onStake}
          onBlur={onBlur}
          editable={!disabled}
          keyboardType="decimal-pad"
          placeholder="Mise"
          placeholderTextColor="#6b7280"
          style={styles.stakeIn}
        />
        <Text style={styles.currencyBadge}>{SYM}</Text>
      </View>

      <View style={styles.limitInfo}>
        <Text style={styles.limitText}>
          Min: {MIN_BET} {SYM}
        </Text>
        <Text style={styles.limitText}>
          Max: {MAX_BET} {SYM}
        </Text>
      </View>

      <View style={styles.rangeWrapper}>
        <LinearGradient
          colors={["#f9a602", "#e65100"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.rangeValBadge}
        >
          <Text style={styles.rangeValText}>{Math.floor(sliderPct)}%</Text>
        </LinearGradient>

        <View
          onLayout={(e) => {
            trackWidthRef.current = e.nativeEvent.layout.width;
          }}
          {...panResponder.panHandlers}
          style={styles.sliderTouchZone}
        >
          <View style={styles.sliderTrack}>
            <LinearGradient
              colors={["#f9a602", "#ffd700"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.sliderFill, { width: `${sliderPct}%` }]}
            />
          </View>
          <View
            pointerEvents="none"
            style={[
              styles.sliderThumb,
              { left: `${sliderPct}%`, marginLeft: -14 },
            ]}
          />
        </View>

        <View style={styles.rangeTicks}>
          {["0", "", "50", "", "MAX"].map((lbl, idx) => (
            <View key={idx} style={styles.tickItem}>
              <View style={styles.tickLine} />
              {lbl ? <Text style={styles.tickLabel}>{lbl}</Text> : null}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#020617",
  },
  header: {
    height: 56,
    backgroundColor: "#06152b",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  logo: {
    fontSize: 22,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: -0.8,
  },
  logoGold: {
    color: "#f9a602",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  balancePill: {
    backgroundColor: "#0b1220",
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  amountHl: {
    fontSize: 13.5,
    fontWeight: "700",
    color: "#22c55e",
    fontVariant: ["tabular-nums"],
  },
  symText: {
    fontSize: 13.5,
    fontWeight: "700",
    color: "#e5e7eb",
  },
  trophyBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1f2937",
    backgroundColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  matchBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 12,
  },
  circleInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#f9a602",
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  multiplierDisplay: {
    fontWeight: "800",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
  gainLabel: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.9)",
  },
  gainValue: {
    fontSize: 19,
    fontWeight: "700",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
  mobileControlsPanel: {
    backgroundColor: "#020617",
    borderTopWidth: 1,
    borderTopColor: "#1f2937",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 10,
  },
  inputGroup: {
    position: "relative",
    justifyContent: "center",
  },
  stakeIn: {
    height: 50,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1f2937",
    backgroundColor: "#020617",
    paddingHorizontal: 14,
    paddingRight: 36,
    fontSize: 19,
    fontWeight: "800",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
  currencyBadge: {
    position: "absolute",
    right: 14,
    fontSize: 15,
    fontWeight: "700",
    color: "#9ca3af",
  },
  limitInfo: {
    marginTop: 6,
    paddingHorizontal: 4,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  limitText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#9ca3af",
  },
  rangeWrapper: {
    position: "relative",
    paddingTop: 22,
    paddingHorizontal: 6,
    paddingBottom: 14,
  },
  rangeValBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  rangeValText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#000000",
  },
  sliderTouchZone: {
    height: 30,
    justifyContent: "center",
  },
  sliderTrack: {
    height: 14,
    borderRadius: 999,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
  },
  sliderFill: {
    height: "100%",
    borderRadius: 999,
  },
  sliderThumb: {
    position: "absolute",
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#f8fafc",
    borderWidth: 4,
    borderColor: "#f9a602",
  },
  rangeTicks: {
    marginTop: 2,
    paddingHorizontal: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  tickItem: {
    alignItems: "center",
  },
  tickLine: {
    width: 1,
    height: 6,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  tickLabel: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: "600",
    color: "rgba(156,163,175,0.65)",
  },
  btnPlace: {
    height: 54,
    borderRadius: 8,
    backgroundColor: "#f9a602",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  btnCashout: {
    backgroundColor: "#22c55e",
  },
  btnDisabled: {
    backgroundColor: "#1f2937",
  },
  btnPlaceText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#000000",
    letterSpacing: 0.4,
  },
  errorMsg: {
    minHeight: 18,
    textAlign: "center",
    fontSize: 12.5,
    fontWeight: "600",
    color: "#ef4444",
  },
  tapPop: {
    position: "absolute",
    zIndex: 999,
  },
  tapPopText: {
    fontSize: 30,
    fontWeight: "900",
    color: "#f9a602",
  },
  confettiPiece: {
    position: "absolute",
    top: -12,
    width: 8,
    height: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalBox: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: "#020617",
    padding: 24,
    alignItems: "center",
  },
  modalWin: {
    borderColor: "#22c55e",
  },
  modalLose: {
    borderColor: "#ef4444",
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 6,
  },
  modalMsg: {
    fontSize: 14,
    color: "#9ca3af",
    marginBottom: 16,
  },
  modalDetails: {
    width: "100%",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 12,
    gap: 8,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  detailLabel: {
    fontSize: 14.5,
    fontWeight: "500",
    color: "#9ca3af",
  },
  detailValue: {
    fontSize: 14.5,
    fontWeight: "700",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
  modalAmount: {
    fontSize: 26,
    fontWeight: "800",
    color: "#ffffff",
    marginBottom: 20,
    fontVariant: ["tabular-nums"],
  },
  btnCloseModal: {
    width: "100%",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#1f2937",
    backgroundColor: "#0b1220",
    paddingVertical: 11,
    alignItems: "center",
  },
  btnCloseModalText: {
    fontSize: 14.5,
    fontWeight: "700",
    color: "#ffffff",
  },
});
