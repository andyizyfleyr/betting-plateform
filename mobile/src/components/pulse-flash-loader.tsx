import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, {
  ClipPath,
  Defs,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";
import { COLORS } from "@/theme/tokens";

const FLASH_BOLT_PATH =
  "M 68.5 10 L 89.5 10 L 64.5 53.5 H 91.5 L 39.5 110 L 53 65.5 H 30.5 Z";

const AnimatedRect = Animated.createAnimatedComponent(Rect);

export function PulseFlashLoader({
  compact = false,
  fullScreen = false,
}: {
  compact?: boolean;
  fullScreen?: boolean;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  const charge = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 560,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 590,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    const chargeLoop = Animated.loop(
      Animated.timing(charge, {
        toValue: 1,
        duration: 1150,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: false,
      })
    );

    pulseLoop.start();
    chargeLoop.start();
    return () => {
      pulseLoop.stop();
      chargeLoop.stop();
    };
  }, [charge, pulse]);

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
    outputRange: [0.95, 1.06],
  });
  const fillY = charge.interpolate({
    inputRange: [0, 0.55, 0.82, 1],
    outputRange: [114, 6, 6, -104],
  });
  const sheenY = charge.interpolate({
    inputRange: [0, 0.2, 0.78, 1],
    outputRange: [114, 96, 8, -24],
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
        <Animated.View style={{ transform: [{ scale: boltScale }] }}>
          <Svg width={62} height={62} viewBox="0 0 120 120">
            <Defs>
              <ClipPath id="pbRnFlashClip">
                <Path d={FLASH_BOLT_PATH} />
              </ClipPath>
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

            <Path d={FLASH_BOLT_PATH} fill="rgba(225, 0, 20, 0.14)" />

            <G clipPath="url(#pbRnFlashClip)">
              <AnimatedRect
                x="16"
                y={fillY}
                width="88"
                height="108"
                fill="url(#pbRnFlashGrad)"
              />
              <AnimatedRect
                x="12"
                y={sheenY}
                width="96"
                height="16"
                fill="rgba(255, 255, 255, 0.62)"
              />
            </G>

            <Path
              d={FLASH_BOLT_PATH}
              fill="none"
              stroke={COLORS.betclicRed}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
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
  halo: {
    position: "absolute",
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "rgba(225, 0, 20, 0.22)",
  },
});
