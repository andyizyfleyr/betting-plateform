import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { COLORS } from "@/theme/tokens";

const FLASH_BOLT_PATH =
  "M 68.5 10 L 89.5 10 L 64.5 53.5 H 91.5 L 39.5 110 L 53 65.5 H 30.5 Z";

/**
 * Loader icône seule 100 % `useNativeDriver: true` :
 * tourne intégralement sur le RenderThread natif Android (60/120 Hz)
 * sans jamais solliciter ni figer le thread JS React Native.
 */
export function PulseFlashLoader({
  compact = false,
  fullScreen = false,
}: {
  compact?: boolean;
  fullScreen?: boolean;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 540,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 560,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    pulseLoop.start();
    return () => {
      pulseLoop.stop();
    };
  }, [pulse]);

  const haloScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.86, 1.18],
  });
  const haloOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.16, 0.42],
  });
  const boltScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1.05],
  });
  const fillOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.28, 1],
  });

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Chargement"
      style={[
        styles.container,
        compact && styles.compactContainer,
        fullScreen && styles.fullScreenContainer,
      ]}
    >
      <View style={styles.iconBox}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              opacity: haloOpacity,
              transform: [{ scale: haloScale }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.boltWrap,
            { transform: [{ scale: boltScale }] },
          ]}
        >
          <Svg width={62} height={62} viewBox="0 0 120 120">
            <Path
              d={FLASH_BOLT_PATH}
              fill="rgba(225, 0, 20, 0.14)"
              stroke={COLORS.betclicRed}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { opacity: fillOpacity }]}
          >
            <Svg width={62} height={62} viewBox="0 0 120 120">
              <Defs>
                <LinearGradient
                  id="pbRnFlashGrad"
                  x1="34"
                  y1="10"
                  x2="86"
                  y2="110"
                  gradientUnits="userSpaceOnUse"
                >
                  <Stop offset="0%" stopColor="#FF3B4B" />
                  <Stop offset="52%" stopColor="#E10014" />
                  <Stop offset="100%" stopColor="#B80010" />
                </LinearGradient>
              </Defs>
              <Path
                d={FLASH_BOLT_PATH}
                fill="url(#pbRnFlashGrad)"
                stroke={COLORS.betclicRed}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 420,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
  },
  compactContainer: {
    flex: 0,
    minHeight: 240,
    paddingVertical: 40,
  },
  fullScreenContainer: {
    flex: 1,
    minHeight: "100%",
    backgroundColor: COLORS.deep,
  },
  iconBox: {
    width: 80,
    height: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  boltWrap: {
    width: 62,
    height: 62,
  },
  halo: {
    position: "absolute",
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "rgba(225, 0, 20, 0.22)",
  },
});
