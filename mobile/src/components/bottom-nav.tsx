import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Layers,
  SlidersHorizontal,
  Ticket,
  TrendingUp,
  Trophy,
} from "lucide-react-native";
import { useApp } from "@/context/app-context";
import { usePathname, useRouter } from "@/lib/router";
import { COLORS, triggerHaptic } from "@/theme/tokens";

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { pendingCount, comboLegs, hapticsEnabled } = useApp();

  if (
    pathname === "/auth" ||
    pathname.startsWith("/admin") ||
    pathname === "/tap" ||
    pathname === "/accelerator"
  ) {
    return null;
  }

  const tabs = [
    {
      href: "/matchs",
      label: "Matchs",
      Icon: Trophy,
      active:
        pathname === "/" ||
        pathname.startsWith("/matchs") ||
        pathname.startsWith("/resultats"),
      badge: 0,
      badgeRed: false,
    },
    {
      href: "/predictions",
      label: "Prédictions",
      Icon: TrendingUp,
      active: pathname.startsWith("/predictions"),
      badge: 0,
      badgeRed: false,
    },
    {
      href: "/betslip",
      label: "Betslip",
      Icon: Layers,
      active: pathname.startsWith("/betslip"),
      badge: comboLegs.length,
      badgeRed: true,
    },
    {
      href: "/paris",
      label: "Mes paris",
      Icon: Ticket,
      active: pathname.startsWith("/paris"),
      badge: pendingCount,
      badgeRed: false,
    },
    {
      href: "/parametres",
      label: "Compte",
      Icon: SlidersHorizontal,
      active: pathname.startsWith("/parametres") || pathname === "/jeux",
      badge: 0,
      badgeRed: false,
    },
  ] as const;

  return (
    <SafeAreaView edges={["bottom"]} style={styles.safeBottom}>
      <View style={styles.row}>
        {tabs.map((tab) => {
          const { Icon } = tab;
          const color = tab.active ? COLORS.betclicRed : COLORS.dim;
          return (
            <Pressable
              key={tab.href}
              onPress={() => {
                triggerHaptic("light", hapticsEnabled);
                router.push(tab.href);
              }}
              style={styles.tab}
            >
              {tab.active ? <View style={styles.activeTopBar} /> : null}
              <View style={styles.iconBox}>
                <Icon
                  size={18}
                  color={color}
                  strokeWidth={tab.active ? 2.4 : 1.9}
                />
                {tab.badge > 0 ? (
                  <View
                    style={[
                      styles.badge,
                      tab.badgeRed || tab.active
                        ? styles.badgeRed
                        : styles.badgeInk,
                    ]}
                  >
                    <Text style={styles.badgeText}>{tab.badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text
                numberOfLines={1}
                style={[styles.label, tab.active && styles.labelActive]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeBottom: {
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: COLORS.edge,
  },
  row: {
    height: 58,
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: "#ffffff",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    position: "relative",
  },
  activeTopBar: {
    position: "absolute",
    top: 0,
    width: 28,
    height: 2.5,
    borderRadius: 999,
    backgroundColor: COLORS.betclicRed,
  },
  iconBox: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeRed: {
    backgroundColor: COLORS.betclicRed,
  },
  badgeInk: {
    backgroundColor: COLORS.ink,
  },
  badgeText: {
    fontSize: 9.5,
    fontWeight: "700",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
  label: {
    fontSize: 10.5,
    fontWeight: "600",
    color: COLORS.dim,
  },
  labelActive: {
    fontWeight: "700",
    color: COLORS.betclicRed,
  },
});
