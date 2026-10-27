import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import { COLORS } from "@/theme/tokens";

export function PulseMark({
  size = 28,
  inverted = false,
}: {
  size?: number;
  inverted?: boolean;
}) {
  if (inverted) {
    return (
      <Svg width={size} height={size} viewBox="0 0 512 512">
        <Rect width="512" height="512" rx="128" fill="#FFFFFF" />
        <Path
          d="M 76 274 H 128 L 150 232 L 174 302 L 198 258"
          fill="none"
          stroke="#E10014"
          strokeWidth="28"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M 298 84 L 368 84 L 284 232 H 374 L 198 432 L 244 278 H 168 Z"
          fill="#E10014"
        />
        <Path
          d="M 356 286 L 378 252 L 398 286 H 436"
          fill="none"
          stroke="#E10014"
          strokeWidth="26"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx="404" cy="132" r="24" fill="#E10014" />
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <Defs>
        <LinearGradient
          id="pbMobileBg"
          x1="48"
          y1="24"
          x2="464"
          y2="488"
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset="0%" stopColor="#FF2638" />
          <Stop offset="48%" stopColor="#E10014" />
          <Stop offset="100%" stopColor="#96000D" />
        </LinearGradient>
        <RadialGradient
          id="pbMobileGlow"
          cx="148"
          cy="104"
          r="280"
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset="0%" stopColor="#FF7A85" stopOpacity="0.38" />
          <Stop offset="70%" stopColor="#FF2638" stopOpacity="0" />
        </RadialGradient>
        <LinearGradient
          id="pbMobileRim"
          x1="48"
          y1="32"
          x2="440"
          y2="480"
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.45" />
          <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.06" />
        </LinearGradient>
      </Defs>

      <Rect width="512" height="512" rx="128" fill="url(#pbMobileBg)" />
      <Rect width="512" height="512" rx="128" fill="url(#pbMobileGlow)" />
      <Rect
        x="10"
        y="10"
        width="492"
        height="492"
        rx="118"
        fill="none"
        stroke="url(#pbMobileRim)"
        strokeWidth="10"
      />
      <Path
        d="M 76 274 H 128 L 150 232 L 174 302 L 198 258"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="28"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M 298 84 L 368 84 L 284 232 H 374 L 198 432 L 244 278 H 168 Z"
        fill="#FFFFFF"
      />
      <Path
        d="M 356 286 L 378 252 L 398 286 H 436"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="26"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx="404" cy="132" r="24" fill="#FFFFFF" />
    </Svg>
  );
}

export function PulseLogo({
  size = "sm",
  variant = "light",
  subtitle,
}: {
  size?: "sm" | "md" | "lg";
  variant?: "light" | "dark" | "onRed";
  subtitle?: string;
}) {
  const markPx = size === "lg" ? 38 : size === "md" ? 32 : 28;
  const isOnRed = variant === "onRed";
  const isDark = variant === "dark";

  return (
    <View style={styles.root}>
      <PulseMark size={markPx} inverted={isOnRed} />
      <View style={styles.textCol}>
        <View style={styles.wordRow}>
          <Text
            style={[
              styles.pulseWord,
              size === "lg"
                ? { fontSize: 19 }
                : size === "md"
                  ? { fontSize: 20 }
                  : { fontSize: 17 },
              { color: isOnRed || isDark ? "#FFFFFF" : COLORS.ink },
            ]}
          >
            PULSE
          </Text>
          <View
            style={[
              styles.betPill,
              size === "lg"
                ? { paddingHorizontal: 6, paddingVertical: 2 }
                : { paddingHorizontal: 5.5, paddingVertical: 1.5 },
              {
                backgroundColor: isOnRed ? "#FFFFFF" : COLORS.betclicRed,
              },
            ]}
          >
            <Text
              style={[
                styles.betWord,
                size === "lg"
                  ? { fontSize: 11 }
                  : size === "md"
                    ? { fontSize: 11.5 }
                    : { fontSize: 10 },
                { color: isOnRed ? COLORS.betclicRed : "#FFFFFF" },
              ]}
            >
              BET
            </Text>
          </View>
        </View>
        {subtitle ? (
          <Text
            style={[
              styles.subtitle,
              {
                color: isOnRed
                  ? "rgba(255,255,255,0.8)"
                  : isDark
                    ? "#9CA3AF"
                    : COLORS.dim,
              },
            ]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  textCol: {
    justifyContent: "center",
  },
  wordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  pulseWord: {
    fontWeight: "900",
    fontStyle: "italic",
    letterSpacing: -0.5,
    includeFontPadding: false,
  },
  betPill: {
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  betWord: {
    fontWeight: "900",
    fontStyle: "italic",
    letterSpacing: 0.4,
    includeFontPadding: false,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "500",
  },
});
