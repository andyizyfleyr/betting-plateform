import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LogOut, Plus, ShieldCheck, Zap } from "lucide-react-native";
import { useApp } from "@/context/app-context";
import { api } from "@/lib/api";
import { eur } from "@/lib/format";
import { usePathname, useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, balance, applyUser, openRecharge } = useApp();

  const prevBalanceRef = useRef<number>(balance);
  const [deltaFlash, setDeltaFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const prev = prevBalanceRef.current;
    prevBalanceRef.current = balance;
    if (Math.abs(balance - prev) >= 0.01) {
      setDeltaFlash(balance > prev ? "up" : "down");
      const timer = setTimeout(() => setDeltaFlash(null), 900);
      return () => clearTimeout(timer);
    }
  }, [balance]);

  if (
    pathname === "/auth" ||
    pathname === "/tap" ||
    pathname === "/accelerator"
  ) {
    return null;
  }

  const onAdminPage = pathname.startsWith("/admin");

  const handleLogout = async () => {
    await api.auth.logout();
    applyUser(null);
    router.replace("/auth");
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safeTop}>
      <View style={styles.bar}>
        <Pressable
          onPress={() => {
            if (!onAdminPage) router.push("/matchs");
          }}
          style={styles.brand}
        >
          <View style={styles.brandIcon}>
            <Zap size={15} color="#ffffff" fill="#ffffff" strokeWidth={2.5} />
          </View>
          <Text style={styles.brandText}>PULSE</Text>
        </Pressable>

        {onAdminPage ? (
          <View style={styles.rightRow}>
            <View style={styles.adminPill}>
              <ShieldCheck size={14} color={COLORS.amber} strokeWidth={2.2} />
              <Text style={styles.adminPillText}>Admin</Text>
            </View>
            <Pressable
              onPress={() => router.push("/matchs")}
              style={styles.playerViewBtn}
            >
              <Text style={styles.playerViewText}>Vue joueur</Text>
            </Pressable>
            <Pressable onPress={handleLogout} style={styles.iconBtn}>
              <LogOut size={16} color={COLORS.mist} strokeWidth={2} />
            </Pressable>
          </View>
        ) : user ? (
          <View style={styles.rightRow}>
            {user.role === "admin" ? (
              <Pressable
                onPress={() => router.push("/admin")}
                style={styles.adminShortcut}
              >
                <ShieldCheck size={14} color={COLORS.amber} strokeWidth={2.2} />
              </Pressable>
            ) : null}

            <Pressable
              onPress={openRecharge}
              style={[
                styles.balancePill,
                deltaFlash === "up" && styles.balancePillUp,
                deltaFlash === "down" && styles.balancePillDown,
              ]}
            >
              <Text
                style={[
                  styles.balanceText,
                  deltaFlash === "up" && { color: COLORS.win },
                  deltaFlash === "down" && { color: COLORS.betclicRed },
                ]}
              >
                {eur(balance)}
              </Text>
              <View style={styles.plusBox}>
                <Plus size={14} color="#ffffff" strokeWidth={2.75} />
              </View>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => router.push("/auth")}
            style={styles.loginBtn}
          >
            <Text style={styles.loginText}>Connexion</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeTop: {
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.edge,
  },
  bar: {
    height: 52,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#ffffff",
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
    fontWeight: "800",
    letterSpacing: -0.4,
    color: COLORS.ink,
  },
  rightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  balancePill: {
    height: 36,
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    paddingLeft: 12,
    paddingRight: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  balancePillUp: {
    backgroundColor: "rgba(21, 128, 61, 0.12)",
  },
  balancePillDown: {
    backgroundColor: "rgba(225, 0, 20, 0.10)",
  },
  balanceText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  plusBox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  loginBtn: {
    height: 36,
    borderRadius: 12,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  loginText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
  },
  adminShortcut: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.amberSoft,
    borderWidth: 1,
    borderColor: COLORS.amberBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  adminPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: COLORS.amberSoft,
    borderWidth: 1,
    borderColor: COLORS.amberBorder,
  },
  adminPillText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.amber,
  },
  playerViewBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: COLORS.elev,
  },
  playerViewText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.ink,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
});
