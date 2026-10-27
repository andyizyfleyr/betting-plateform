import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Lock, TrendingUp, Zap } from "lucide-react-native";
import type { OddsLockPolicy } from "@/lib/api";
import { colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

const POLICIES: Array<{
  key: OddsLockPolicy;
  label: string;
  Icon: typeof Lock;
}> = [
  { key: "strict", label: "Bloquer", Icon: Lock },
  { key: "accept_higher", label: "Hausse OK", Icon: TrendingUp },
  { key: "accept_any", label: "Auto", Icon: Zap },
];

export function OddsLockControls({
  value,
  onChange,
}: {
  value: OddsLockPolicy;
  onChange: (p: OddsLockPolicy) => void;
}) {
  const { hapticsEnabled } = useApp();

  return (
    <View style={styles.wrap}>
      <Text style={styles.caption}>Variation de cote :</Text>
      <View style={styles.pills}>
        {POLICIES.map((p) => {
          const active = value === p.key;
          return (
            <Pressable
              key={p.key}
              onPress={() => {
                triggerHaptic("light", hapticsEnabled);
                onChange(p.key);
              }}
              style={[styles.pill, active && styles.pillActive]}
            >
              <p.Icon
                size={11.5}
                color={active ? colors.white : colors.mist}
                strokeWidth={2.4}
              />
              <Text style={[styles.pillText, active && styles.pillTextActive]}>
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  caption: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.dim,
  },
  pills: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  pill: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: colors.elev,
  },
  pillActive: {
    backgroundColor: colors.ink,
  },
  pillText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.mist,
  },
  pillTextActive: {
    color: colors.white,
  },
});
