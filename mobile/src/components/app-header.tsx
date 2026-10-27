import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LogOut, Plus, ShieldCheck, Zap } from "lucide-react-native";
import { api } from "@/lib/api";
import { eur } from "@/lib/format";
import { colors } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

/**
 * Barre supérieure mobile `52 px` identique au Web mobile (`src/components/app-header.tsx`).
 */
export function AppHeader() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const { user, balance, applyUser, clearCombo, openRecharge, toast } = useApp();
  const [loggingOut, setLoggingOut] = useState(false);

  const isAdminShell =
    user?.role === "admin" || pathname === "/admin" || pathname.startsWith("/admin/");

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api.auth.logout();
      clearCombo();
      applyUser(null);
      router.replace("/auth");
    } catch {
      toast({ kind: "error", title: "Impossible de se déconnecter" });
    } finally {
      setLoggingOut(false);
    }
  };

  if (isAdminShell) {
    return (
      <View style={[styles.wrap, { paddingTop: insets.top }]}>
        <View style={styles.bar}>
          <Pressable
            onPress={() => router.push("/admin")}
            style={styles.logoGroup}
          >
            <View style={styles.logoIcon}>
              <Zap size={16} color={colors.white} fill={colors.white} strokeWidth={2.2} />
            </View>
            <Text style={styles.logoText}>PULSE</Text>
            <View style={styles.adminPill}>
              <ShieldCheck size={11} color={colors.betclicRed} strokeWidth={2.4} />
              <Text style={styles.adminPillText}>Admin</Text>
            </View>
          </Pressable>

          <View style={styles.rightRow}>
            {user?.name ? (
              <Text numberOfLines={1} style={styles.adminName}>
                {user.name}
              </Text>
            ) : null}
            <Pressable
              onPress={handleLogout}
              disabled={loggingOut}
              style={styles.logoutBtn}
            >
              {loggingOut ? (
                <ActivityIndicator size="small" color={colors.dim} />
              ) : (
                <LogOut size={14} color={colors.betclicRed} strokeWidth={2.2} />
              )}
              <Text style={styles.logoutText}>Déconnexion</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Pressable
          onPress={() => router.push("/matchs")}
          style={styles.logoGroup}
        >
          <View style={styles.logoIcon}>
            <Zap size={16} color={colors.white} fill={colors.white} strokeWidth={2.2} />
          </View>
          <Text style={styles.logoText}>PULSE</Text>
        </Pressable>

        <View style={styles.rightRow}>
          {user ? (
            <Pressable
              onPress={openRecharge}
              accessibilityLabel="Solde et rechargement"
              style={styles.balanceBtn}
            >
              <Text style={styles.balanceText}>{eur(balance)}</Text>
              <View style={styles.plusCircle}>
                <Plus size={14} color={colors.white} strokeWidth={2.8} />
              </View>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => router.push("/auth")}
              style={styles.loginBtn}
            >
              <Text style={styles.loginBtnText}>Connexion</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.edge,
    zIndex: 30,
  },
  bar: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  logoGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  logoIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: {
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: -0.4,
    color: colors.ink,
  },
  adminPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "rgba(225, 0, 20, 0.10)",
  },
  adminPillText: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    color: colors.betclicRed,
  },
  rightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  adminName: {
    maxWidth: 110,
    fontSize: 12,
    fontWeight: "600",
    color: colors.mist,
  },
  logoutBtn: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.edge,
    backgroundColor: colors.elev,
  },
  logoutText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.ink,
  },
  balanceBtn: {
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 12,
    paddingRight: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.edge,
    backgroundColor: colors.elev,
  },
  balanceText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  plusCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  loginBtn: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  loginBtnText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: colors.white,
  },
});
