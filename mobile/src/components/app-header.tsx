import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LogOut, Plus, ShieldCheck } from "lucide-react-native";
import { useApp } from "@/context/app-context";
import { api } from "@/lib/api";
import { eur } from "@/lib/format";
import { usePathname, useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";
import { PulseLogo } from "./pulse-logo";

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    authReady,
    sessionRestoring,
    user,
    balance,
    applyUser,
    clearCombo,
    openRecharge,
    toast,
  } = useApp();
  const authPending = !authReady || sessionRestoring;
  const [loggingOut, setLoggingOut] = useState(false);

  if (
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname === "/tap" ||
    pathname.startsWith("/tap/") ||
    pathname === "/accelerator" ||
    pathname.startsWith("/accelerator/")
  ) {
    return null;
  }

  const isAdminShell =
    user?.role === "admin" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/");

  const handleAdminLogout = async () => {
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
      <SafeAreaView edges={["top"]} style={styles.safeTop}>
        <View style={styles.bar}>
          <Pressable
            onPress={() => router.push("/admin")}
            style={({ pressed }) => [styles.brand, pressed && { opacity: 0.8 }]}
          >
            <PulseLogo size="sm" variant="light" />
            <View style={styles.adminPill}>
              <ShieldCheck size={12} color={COLORS.betclicRed} strokeWidth={2.4} />
              <Text style={styles.adminPillText}>ADMIN</Text>
            </View>
          </Pressable>

          <View style={styles.rightRow}>
            {user?.name ? (
              <Text numberOfLines={1} style={styles.adminName}>
                {user.name}
              </Text>
            ) : null}
            <Pressable
              onPress={handleAdminLogout}
              disabled={loggingOut}
              style={({ pressed }) => [
                styles.logoutPill,
                pressed && { backgroundColor: COLORS.edge },
                loggingOut && { opacity: 0.6 },
              ]}
            >
              {loggingOut ? (
                <ActivityIndicator size="small" color={COLORS.dim} />
              ) : (
                <LogOut size={14} color={COLORS.betclicRed} strokeWidth={2.2} />
              )}
              <Text style={styles.logoutText}>Déconnexion</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.safeTop}>
      <View style={styles.bar}>
        <Pressable
          onPress={() => router.push("/matchs")}
          style={({ pressed }) => [styles.brand, pressed && { opacity: 0.8 }]}
        >
          <PulseLogo size="sm" variant="light" />
        </Pressable>

        <View style={styles.rightRow}>
          {user ? (
            <Pressable
              onPress={openRecharge}
              style={({ pressed }) => [
                styles.balancePill,
                pressed && { transform: [{ scale: 0.98 }] },
              ]}
            >
              <Text style={styles.balanceText}>{eur(balance)}</Text>
              <View style={styles.plusCircle}>
                <Plus size={14} color="#ffffff" strokeWidth={2.8} />
              </View>
            </Pressable>
          ) : authPending ? (
            <View style={[styles.balancePill, { minWidth: 106 }]}>
              <View style={styles.balanceSkeletonBar} />
              <View style={styles.plusCircle}>
                <Plus size={14} color="#ffffff" strokeWidth={2.8} />
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => router.push("/auth")}
              style={({ pressed }) => [
                styles.loginBtn,
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text style={styles.loginText}>Connexion</Text>
            </Pressable>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeTop: {
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.edge,
  },
  bar: {
    height: 52,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  brandIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  brandText: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: COLORS.ink,
  },
  adminPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    backgroundColor: "rgba(225, 0, 20, 0.10)",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  adminPillText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.betclicRed,
    letterSpacing: 0.3,
  },
  adminName: {
    maxWidth: 110,
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.mist,
  },
  logoutPill: {
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  logoutText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.ink,
  },
  rightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  balancePill: {
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: COLORS.elev,
    paddingLeft: 12,
    paddingRight: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  balanceText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  balanceSkeletonBar: {
    width: 54,
    height: 11,
    borderRadius: 999,
    backgroundColor: "rgba(17, 24, 39, 0.14)",
  },
  plusCircle: {
    width: 24,
    height: 24,
    borderRadius: 999,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  loginBtn: {
    height: 36,
    borderRadius: 999,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  loginText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#ffffff",
  },
});
