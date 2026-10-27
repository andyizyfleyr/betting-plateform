import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import Svg, {
  Circle,
  Defs,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import { PulseMark } from "./pulse-logo";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

/**
 * Splash Screen natif React Native haute définition (WQHD+ vectoriel)
 * - Alignement chromatique exact (#090D16) avec le splash système Android (`splash-icon.png`)
 * - Halo télémétrique respirant à 60/120 fps (`useNativeDriver: true`)
 * - Trois dots de chargement animés en onde fluide décalée (`0ms`, `160ms`, `320ms`)
 * - Transition de sortie soyeuse vers l'application une fois l'hydratation terminée
 */
export function PulseSplashScreen({
  exiting = false,
  onExited,
}: {
  exiting?: boolean;
  onExited?: () => void;
}) {
  const containerOpacity = useRef(new Animated.Value(1)).current;
  const containerScale = useRef(new Animated.Value(1)).current;
  const haloPulse = useRef(new Animated.Value(0)).current;
  const dot0 = useRef(new Animated.Value(0)).current;
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;
  const didNotifyExitRef = useRef(false);

  useEffect(() => {
    const haloLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(haloPulse, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(haloPulse, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    haloLoop.start();

    const makeDotWave = (val: Animated.Value, delayMs: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delayMs),
          Animated.timing(val, {
            toValue: 1,
            duration: 380,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(val, {
            toValue: 0,
            duration: 420,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.delay(Math.max(0, 340 - delayMs)),
        ])
      );

    const w0 = makeDotWave(dot0, 0);
    const w1 = makeDotWave(dot1, 160);
    const w2 = makeDotWave(dot2, 320);

    w0.start();
    w1.start();
    w2.start();

    return () => {
      haloLoop.stop();
      w0.stop();
      w1.stop();
      w2.stop();
    };
  }, [dot0, dot1, dot2, haloPulse]);

  useEffect(() => {
    if (!exiting) return;
    const notifyOnce = () => {
      if (didNotifyExitRef.current) return;
      didNotifyExitRef.current = true;
      onExitedRef.current?.();
    };
    const safetyTimer = setTimeout(notifyOnce, 340);
    Animated.parallel([
      Animated.timing(containerOpacity, {
        toValue: 0,
        duration: 280,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(containerScale, {
        toValue: 1.035,
        duration: 280,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => {
      notifyOnce();
    });
    return () => {
      clearTimeout(safetyTimer);
    };
  }, [containerOpacity, containerScale, exiting]);

  const haloScale = haloPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1.09],
  });
  const haloOpacity = haloPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.72],
  });

  const cx = SCREEN_W / 2;
  const cy = SCREEN_H * 0.45;
  const gradRadius = Math.max(SCREEN_W * 0.62, 240);

  const dots = [dot0, dot1, dot2];

  return (
    <Animated.View
      pointerEvents={exiting ? "none" : "auto"}
      style={[
        styles.overlay,
        {
          opacity: containerOpacity,
          transform: [{ scale: containerScale }],
        },
      ]}
    >
      <StatusBar style="light" backgroundColor="#090D16" translucent />

      {/* Arrière-plan vectoriel HD (résolution native infinie sur écrans OLED / WQHD+) */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={SCREEN_W} height={SCREEN_H}>
          <Defs>
            <RadialGradient
              id="splashStadiumHalo"
              cx={cx}
              cy={cy}
              r={gradRadius}
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0%" stopColor="#E10014" stopOpacity="0.28" />
              <Stop offset="55%" stopColor="#E10014" stopOpacity="0.06" />
              <Stop offset="100%" stopColor="#090D16" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect width={SCREEN_W} height={SCREEN_H} fill="#090D16" />
          <Rect
            width={SCREEN_W}
            height={SCREEN_H}
            fill="url(#splashStadiumHalo)"
          />
          <Circle
            cx={cx}
            cy={cy}
            r={104}
            fill="none"
            stroke="#E10014"
            strokeOpacity="0.16"
            strokeWidth="1.2"
          />
          <Circle
            cx={cx}
            cy={cy}
            r={148}
            fill="none"
            stroke="#FFFFFF"
            strokeOpacity="0.05"
            strokeWidth="1"
          />
        </Svg>
      </View>

      {/* Bloc central : emblème HD + signature PULSE BET */}
      <View style={styles.centerStage}>
        <View style={styles.emblemWrap}>
          <Animated.View
            style={[
              styles.breathingHalo,
              {
                opacity: haloOpacity,
                transform: [{ scale: haloScale }],
              },
            ]}
          />
          <View style={styles.emblemShadow}>
            <PulseMark size={98} />
          </View>
        </View>

        <View style={styles.brandLockup}>
          <View style={styles.wordRow}>
            <Text style={styles.pulseText}>PULSE</Text>
            <View style={styles.betBadge}>
              <Text style={styles.betText}>BET</Text>
            </View>
          </View>
          <Text style={styles.tagline}>PARIS SPORTIFS & PRÉDICTIONS</Text>
        </View>
      </View>

      {/* Pied d'écran : trois dots de chargement HD animés */}
      <View style={styles.footerLoader} accessibilityLabel="Chargement en cours">
        <View style={styles.dotsRow}>
          {dots.map((anim, idx) => {
            const scale = anim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.75, 1.32],
            });
            const translateY = anim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, -5],
            });
            const opacity = anim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.3, 1],
            });
            return (
              <Animated.View
                key={idx}
                style={[
                  styles.dot,
                  {
                    opacity,
                    transform: [{ translateY }, { scale }],
                  },
                ]}
              />
            );
          })}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: "#090D16",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 56,
  },
  centerStage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  emblemWrap: {
    width: 132,
    height: 132,
    alignItems: "center",
    justifyContent: "center",
  },
  breathingHalo: {
    position: "absolute",
    width: 128,
    height: 128,
    borderRadius: 36,
    backgroundColor: "rgba(225, 0, 20, 0.22)",
    borderWidth: 1.5,
    borderColor: "rgba(255, 56, 74, 0.38)",
  },
  emblemShadow: {
    shadowColor: "#E10014",
    shadowOpacity: 0.45,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  brandLockup: {
    marginTop: 18,
    alignItems: "center",
  },
  wordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  pulseText: {
    color: "#FFFFFF",
    fontSize: 32,
    fontWeight: "900",
    fontStyle: "italic",
    letterSpacing: -0.8,
    includeFontPadding: false,
  },
  betBadge: {
    backgroundColor: "#E10014",
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  betText: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "900",
    fontStyle: "italic",
    letterSpacing: 0.6,
    includeFontPadding: false,
  },
  tagline: {
    marginTop: 8,
    color: "#9CA3AF",
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 2.2,
  },
  footerLoader: {
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 14,
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 11,
    height: 24,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#E10014",
    shadowColor: "#FF2638",
    shadowOpacity: 0.75,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
});
