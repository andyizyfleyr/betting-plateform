import React, { useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { initials, teamHue } from "@/lib/format";
import { teamLogoCandidates } from "@/lib/team-logos";

export type TeamAvatarSize = "2xs" | "xs" | "sm" | "md" | "lg";

const SIZES: Record<
  TeamAvatarSize,
  { box: number; radius: number; pad: number; font: number }
> = {
  "2xs": { box: 18, radius: 6, pad: 1.5, font: 8 },
  xs: { box: 24, radius: 8, pad: 2, font: 9.5 },
  sm: { box: 32, radius: 10, pad: 3, font: 11 },
  md: { box: 38, radius: 12, pad: 4, font: 12 },
  lg: { box: 48, radius: 16, pad: 5, font: 14 },
};

export function TeamAvatar({
  name,
  logo,
  size = "md",
}: {
  name: string;
  logo?: string | null;
  size?: TeamAvatarSize;
}) {
  const candidates = useMemo(
    () => teamLogoCandidates(name, logo),
    [name, logo]
  );
  const candidateKey = candidates.join("|");
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [candidateKey]);

  const spec = SIZES[size];
  const src = candidates[idx];

  if (src) {
    return (
      <View
        style={[
          styles.logoBox,
          {
            width: spec.box,
            height: spec.box,
            borderRadius: spec.radius,
            padding: spec.pad,
          },
        ]}
      >
        <Image
          source={{ uri: src }}
          resizeMode="contain"
          style={styles.logoImage}
          onError={() => setIdx((prev) => prev + 1)}
        />
      </View>
    );
  }

  const hue = teamHue(name);
  const hue2 = (hue + 35) % 360;

  return (
    <LinearGradient
      colors={[`hsl(${hue}, 70%, 52%)`, `hsl(${hue2}, 75%, 38%)`]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.fallbackBox,
        {
          width: spec.box,
          height: spec.box,
          borderRadius: spec.radius,
        },
      ]}
    >
      <Text style={[styles.fallbackText, { fontSize: spec.font }]}>
        {initials(name)}
      </Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  logoBox: {
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.08)",
    overflow: "hidden",
    flexShrink: 0,
  },
  logoImage: {
    width: "100%",
    height: "100%",
  },
  fallbackBox: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.06)",
    overflow: "hidden",
    flexShrink: 0,
  },
  fallbackText: {
    color: "#ffffff",
    fontWeight: "700",
    letterSpacing: -0.3,
  },
});
