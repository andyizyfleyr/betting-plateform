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

const ITEMS = [
  { href: "/matchs", label: "Matchs", Icon: Trophy },
  { href: "/predictions", label: "Prédictions", Icon: TrendingUp },
  { href: "/betslip", label: "Betslip", Icon: Layers },
  { href: "/paris", label: "Mes paris", Icon: Ticket },
  { href: "/parametres", label: "Compte", Icon: SlidersHorizontal },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    user,
    pendingCount,
    comboLegs,
    closeMarkets,
    closeBet,
    closeCombo,
    hapticsEnabled,
  } = useApp();

  if (
    user?.role === "admin" ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/tap" ||
    pathname.startsWith("/tap/") ||
    pathname === "/accelerator" ||
    pathname.startsWith("/accelerator/")
  ) {
    return null;
  }

  const slipCount = comboLegs.length;

  return (
    <SafeAreaView edges={["bottom"]} style={styles.safeBottom}>
      <View style={styles.row}>
        {ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const badgeCount =
            href === "/betslip"
              ? slipCount
              : href === "/paris"
                ? pendingCount
                : 0;

          return (
            <Pressable
              key={href}
              onPress={() => {
                triggerHaptic("light", hapticsEnabled);
                closeMarkets();
                closeBet();
                closeCombo();
                router.push(href);
              }}
              style={({ pressed }) => [
                styles.tab,
                pressed && { backgroundColor: "rgba(238,240,244,0.6)" },
              ]}
            >
              {active ? <View style={styles.activeTopBar} /> : null}
              <View style={styles.iconBox}>
                <Icon
                  size={19}
                  color={active ? COLORS.betclicRed : COLORS.dim}
                  strokeWidth={active ? 2.4 : 1.9}
                />
                {badgeCount > 0 ? (
                  <View
                    style={[
                      styles.badge,
                      href === "/betslip" ? styles.badgeRed : styles.badgeInk,
                    ]}
                  >
                    <Text style={styles.badgeText}>
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text
                numberOfLines={1}
                style={[styles.label, active && styles.labelActive]}
              >
                {label}
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
    shadowColor: "#111827",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -2 },
    elevation: 6,
  },
  row: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: "#ffffff",
  },
  tab: {
    flex: 1,
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 4,
    paddingVertical: 8,
    position: "relative",
  },
  activeTopBar: {
    position: "absolute",
    top: 0,
    width: 28,
    height: 2.5,
    borderBottomLeftRadius: 999,
    borderBottomRightRadius: 999,
    backgroundColor: COLORS.betclicRed,
  },
  iconBox: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 999,
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
    fontWeight: "500",
    color: "#ffffff",
    lineHeight: 11,
    fontVariant: ["tabular-nums"],
  },
  label: {
    fontSize: 9.5,
    fontWeight: "500",
    color: COLORS.dim,
    lineHeight: 12,
  },
  labelActive: {
    fontWeight: "500",
    color: COLORS.betclicRed,
  },
});
