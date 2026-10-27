import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Flame,
  ReceiptText,
  Sparkles,
  Ticket,
  User,
} from "lucide-react-native";
import { colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

const TABS = [
  { href: "/matchs", label: "Matchs", Icon: Flame },
  { href: "/predictions", label: "Prédictions", Icon: Sparkles },
  { href: "/betslip", label: "Betslip", Icon: Ticket, isSlip: true },
  { href: "/paris", label: "Mes paris", Icon: ReceiptText, isBets: true },
  { href: "/parametres", label: "Compte", Icon: User },
] as const;

/**
 * Barre de navigation inférieure `58 px` sur fond blanc plein (`bg-white`),
 * démarrant sur `Matchs` et masquée sur `/tap`, `/accelerator` et `/admin`.
 */
export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, comboLegs, pendingCount, hapticsEnabled } = useApp();

  if (
    user?.role === "admin" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/tap" ||
    pathname.startsWith("/tap/") ||
    pathname === "/accelerator" ||
    pathname.startsWith("/accelerator/")
  ) {
    return null;
  }

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 2) }]}>
      <View style={styles.row}>
        {TABS.map((t) => {
          const active =
            pathname === t.href || pathname.startsWith(`${t.href}/`);
          const badgeCount =
            "isSlip" in t && t.isSlip
              ? comboLegs.length
              : "isBets" in t && t.isBets
                ? pendingCount
                : 0;

          return (
            <Pressable
              key={t.href}
              onPress={() => {
                if (!active) {
                  triggerHaptic("light", hapticsEnabled);
                  router.push(t.href);
                }
              }}
              style={styles.tab}
            >
              {active && <View style={styles.activeTopIndicator} />}
              <View style={styles.iconBox}>
                <t.Icon
                  size={20}
                  color={active ? colors.betclicRed : colors.dim}
                  strokeWidth={active ? 2.4 : 1.9}
                />
                {badgeCount > 0 && (
                  <View
                    style={[
                      styles.badge,
                      "isSlip" in t && t.isSlip
                        ? styles.badgeRed
                        : active
                          ? styles.badgeRed
                          : styles.badgeInk,
                    ]}
                  >
                    <Text style={styles.badgeText}>{badgeCount}</Text>
                  </View>
                )}
              </View>
              <Text
                numberOfLines={1}
                style={[styles.label, active && styles.labelActive]}
              >
                {t.label}
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
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.edge,
  },
  row: {
    height: 58,
    flexDirection: "row",
    alignItems: "stretch",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    position: "relative",
  },
  activeTopIndicator: {
    position: "absolute",
    top: 0,
    width: 28,
    height: 2.5,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: colors.betclicRed,
  },
  iconBox: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -12,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeRed: {
    backgroundColor: colors.betclicRed,
  },
  badgeInk: {
    backgroundColor: colors.ink,
  },
  badgeText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: colors.white,
    fontVariant: ["tabular-nums"],
  },
  label: {
    fontSize: 10.5,
    fontWeight: "500",
    color: colors.dim,
  },
  labelActive: {
    fontWeight: "700",
    color: colors.betclicRed,
  },
});
