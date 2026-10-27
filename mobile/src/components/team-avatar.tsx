import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { hslClubBackground, initials } from "@/lib/format";
import { colors } from "@/theme/tokens";

const SIZES = {
  xs: { box: 20, img: 15, font: 8.5, radius: 10 },
  sm: { box: 26, img: 19, font: 10, radius: 13 },
  md: { box: 32, img: 24, font: 11.5, radius: 16 },
  lg: { box: 42, img: 31, font: 14, radius: 21 },
} as const;

export function TeamAvatar({
  name,
  logo,
  size = "sm",
}: {
  name: string;
  logo?: string | null;
  size?: keyof typeof SIZES;
}) {
  const [failed, setFailed] = useState(false);
  const dim = SIZES[size];

  if (logo && !failed) {
    return (
      <View
        style={[
          styles.logoWrap,
          {
            width: dim.box,
            height: dim.box,
            borderRadius: dim.radius,
          },
        ]}
      >
        <Image
          source={{ uri: logo }}
          style={{ width: dim.img, height: dim.img }}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={120}
          onError={() => setFailed(true)}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        {
          width: dim.box,
          height: dim.box,
          borderRadius: dim.radius,
          backgroundColor: hslClubBackground(name || "FC"),
        },
      ]}
    >
      <Text style={[styles.fallbackText, { fontSize: dim.font }]}>
        {initials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  logoWrap: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.edgeSoft,
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackText: {
    color: colors.white,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
});
