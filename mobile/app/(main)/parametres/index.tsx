import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Gamepad2,
  History,
  LogOut,
  ShieldCheck,
  Trophy,
  User as UserIcon,
} from "lucide-react-native";
import { useApp } from "@/context/app-context";
import { api } from "@/lib/api";
import { eur, initials } from "@/lib/format";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

export default function CompteScreen() {
  const router = useRouter();
  const {
    user,
    balance,
    applyUser,
    oddsPolicy,
    setOddsPolicy,
    dataSaverMode,
    setDataSaverMode,
    toast,
  } = useApp();

  const togglePref = async (
    key: "notifications" | "sound" | "haptics",
    nextVal: boolean
  ) => {
    if (!user) return;
    applyUser({ ...user, [key]: nextVal });
    try {
      const res = await api.patchSettings({ [key]: nextVal });
      applyUser(res.user);
    } catch {
      toast({
        kind: "error",
        title: "Impossible d'enregistrer le réglage",
      });
    }
  };

  const toggleOddsFormat = async (fmt: "decimal" | "fractional") => {
    if (!user || user.oddsFormat === fmt) return;
    applyUser({ ...user, oddsFormat: fmt });
    try {
      const res = await api.patchSettings({ oddsFormat: fmt });
      applyUser(res.user);
    } catch {
      /* ignore */
    }
  };

  const handleLogout = async () => {
    await api.auth.logout();
    applyUser(null);
    router.replace("/auth");
  };

  if (!user) {
    return (
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.guestCard}>
          <View style={styles.guestAvatar}>
            <UserIcon size={24} color={COLORS.betclicRed} strokeWidth={2.2} />
          </View>
          <Text style={styles.guestTitle}>Espace Compte PULSE</Text>
          <Text style={styles.guestDesc}>
            Connectez-vous ou créez un compte gratuit pour déposer, retirer vos
            gains et personnaliser vos cotes.
          </Text>
          <Pressable
            onPress={() => router.push("/auth")}
            style={styles.loginBtn}
          >
            <Text style={styles.loginText}>Se connecter / S&apos;inscrire</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => router.push("/jeux")}
          style={styles.gamesPromoCard}
        >
          <View style={styles.gamesIconBox}>
            <Gamepad2 size={20} color="#ffffff" strokeWidth={2.3} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.gamesPromoTitle}>Mini-jeux instantanés</Text>
            <Text style={styles.gamesPromoSub}>
              Tap & Win · Accelerator Pro
            </Text>
          </View>
          <ChevronRight size={17} color={COLORS.dim} strokeWidth={2.3} />
        </Pressable>

        <Pressable
          onPress={() => router.push("/resultats")}
          style={styles.linkCard}
        >
          <Trophy size={17} color={COLORS.betclicRed} strokeWidth={2.2} />
          <Text style={styles.linkTitle}>Résultats officiels des matchs</Text>
          <ChevronRight size={16} color={COLORS.dim} strokeWidth={2.2} />
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Profil & Solde */}
      <View style={styles.profileCard}>
        <View style={styles.profileTop}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(user.name)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={styles.userName}>
              {user.name}
            </Text>
            {user.email ? (
              <Text numberOfLines={1} style={styles.userEmail}>
                {user.email}
              </Text>
            ) : null}
          </View>
          <View style={styles.balanceBox}>
            <Text style={styles.balanceCaption}>Solde disponible</Text>
            <Text style={styles.balanceVal}>{eur(balance)}</Text>
          </View>
        </View>

        <View style={styles.walletGrid}>
          <Pressable
            onPress={() => router.push("/parametres/depot")}
            style={[styles.walletTile, styles.walletTilePrimary]}
          >
            <ArrowDownLeft size={16} color="#ffffff" strokeWidth={2.5} />
            <Text style={[styles.walletTileText, { color: "#ffffff" }]}>
              Dépôt
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/parametres/retrait")}
            style={styles.walletTile}
          >
            <ArrowUpRight size={16} color={COLORS.ink} strokeWidth={2.4} />
            <Text style={styles.walletTileText}>Retrait</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/parametres/transactions")}
            style={styles.walletTile}
          >
            <History size={16} color={COLORS.ink} strokeWidth={2.3} />
            <Text style={styles.walletTileText}>Historique</Text>
          </Pressable>
        </View>
      </View>

      {/* Accès Jeux & Résultats & Admin */}
      <Pressable
        onPress={() => router.push("/jeux")}
        style={styles.gamesPromoCard}
      >
        <View style={styles.gamesIconBox}>
          <Gamepad2 size={20} color="#ffffff" strokeWidth={2.3} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.gamesPromoTitle}>Jeux instantanés</Text>
          <Text style={styles.gamesPromoSub}>
            Tap & Win · Accelerator Pro
          </Text>
        </View>
        <ChevronRight size={17} color={COLORS.dim} strokeWidth={2.3} />
      </Pressable>

      <Pressable
        onPress={() => router.push("/resultats")}
        style={styles.linkCard}
      >
        <Trophy size={17} color={COLORS.betclicRed} strokeWidth={2.2} />
        <Text style={styles.linkTitle}>Résultats officiels des matchs</Text>
        <ChevronRight size={16} color={COLORS.dim} strokeWidth={2.2} />
      </Pressable>

      {user.role === "admin" ? (
        <Pressable
          onPress={() => router.push("/admin")}
          style={[styles.linkCard, styles.adminCard]}
        >
          <ShieldCheck size={18} color={COLORS.amber} strokeWidth={2.3} />
          <Text style={styles.linkTitle}>Console d&apos;administration</Text>
          <ChevronRight size={16} color={COLORS.amber} strokeWidth={2.2} />
        </Pressable>
      ) : null}

      {/* Préférences de jeu */}
      <View style={styles.prefsCard}>
        <Text style={styles.sectionTitle}>Préférences de cotes & confort</Text>

        <View style={styles.fmtRow}>
          <Text style={styles.prefLabel}>Format des cotes</Text>
          <View style={styles.fmtSwitch}>
            <Pressable
              onPress={() => toggleOddsFormat("decimal")}
              style={[
                styles.fmtPill,
                user.oddsFormat === "decimal" && styles.fmtPillActive,
              ]}
            >
              <Text
                style={[
                  styles.fmtText,
                  user.oddsFormat === "decimal" && styles.fmtTextActive,
                ]}
              >
                1,85
              </Text>
            </Pressable>
            <Pressable
              onPress={() => toggleOddsFormat("fractional")}
              style={[
                styles.fmtPill,
                user.oddsFormat === "fractional" && styles.fmtPillActive,
              ]}
            >
              <Text
                style={[
                  styles.fmtText,
                  user.oddsFormat === "fractional" && styles.fmtTextActive,
                ]}
              >
                17/20
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.prefItem}>
          <View style={{ flex: 1 }}>
            <Text style={styles.prefLabel}>Accepter les hausses de cotes</Text>
            <Text style={styles.prefSub}>
              Valide sans reconfirmation quand la cote augmente
            </Text>
          </View>
          <Switch
            value={oddsPolicy === "accept_higher"}
            onValueChange={(v) =>
              setOddsPolicy(v ? "accept_higher" : "confirm_all")
            }
            trackColor={{ false: COLORS.edge, true: COLORS.betclicRed }}
            thumbColor="#ffffff"
          />
        </View>

        <View style={styles.prefItem}>
          <Text style={styles.prefLabel}>Notifications de gains</Text>
          <Switch
            value={user.notifications}
            onValueChange={(v) => togglePref("notifications", v)}
            trackColor={{ false: COLORS.edge, true: COLORS.betclicRed }}
            thumbColor="#ffffff"
          />
        </View>

        <View style={styles.prefItem}>
          <Text style={styles.prefLabel}>Vibrations haptiques</Text>
          <Switch
            value={user.haptics}
            onValueChange={(v) => togglePref("haptics", v)}
            trackColor={{ false: COLORS.edge, true: COLORS.betclicRed }}
            thumbColor="#ffffff"
          />
        </View>

        <View style={styles.prefItem}>
          <Text style={styles.prefLabel}>Effets sonores</Text>
          <Switch
            value={user.sound}
            onValueChange={(v) => togglePref("sound", v)}
            trackColor={{ false: COLORS.edge, true: COLORS.betclicRed }}
            thumbColor="#ffffff"
          />
        </View>

        <View style={[styles.prefItem, { borderBottomWidth: 0 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.prefLabel}>Mode Économie de données</Text>
            <Text style={styles.prefSub}>
              Espace le rafraîchissement automatique sur réseau mobile
            </Text>
          </View>
          <Switch
            value={dataSaverMode}
            onValueChange={setDataSaverMode}
            trackColor={{ false: COLORS.edge, true: COLORS.betclicRed }}
            thumbColor="#ffffff"
          />
        </View>
      </View>

      <Pressable onPress={handleLogout} style={styles.logoutBtn}>
        <LogOut size={16} color={COLORS.betclicRed} strokeWidth={2.3} />
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: COLORS.deep,
  },
  content: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 11,
  },
  guestCard: {
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 22,
    alignItems: "center",
    gap: 10,
  },
  guestAvatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "rgba(225, 0, 20, 0.09)",
    alignItems: "center",
    justifyContent: "center",
  },
  guestTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.ink,
  },
  guestDesc: {
    fontSize: 13,
    color: COLORS.dim,
    textAlign: "center",
    lineHeight: 19,
  },
  loginBtn: {
    marginTop: 4,
    height: 44,
    borderRadius: 13,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  loginText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#ffffff",
  },
  profileCard: {
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 15,
    gap: 14,
  },
  profileTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: COLORS.outerSpace,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#ffffff",
  },
  userName: {
    fontSize: 15.5,
    fontWeight: "800",
    color: COLORS.ink,
  },
  userEmail: {
    fontSize: 12,
    color: COLORS.dim,
    marginTop: 1,
  },
  balanceBox: {
    alignItems: "flex-end",
  },
  balanceCaption: {
    fontSize: 10.5,
    fontWeight: "600",
    color: COLORS.dim,
  },
  balanceVal: {
    fontSize: 17,
    fontWeight: "900",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  walletGrid: {
    flexDirection: "row",
    gap: 8,
  },
  walletTile: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  walletTilePrimary: {
    backgroundColor: COLORS.betclicRed,
  },
  walletTileText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: COLORS.ink,
  },
  gamesPromoCard: {
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  gamesIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  gamesPromoTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.ink,
  },
  gamesPromoSub: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.dim,
    marginTop: 1,
  },
  linkCard: {
    borderRadius: 15,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  adminCard: {
    backgroundColor: COLORS.amberSoft,
    borderColor: COLORS.amberBorder,
  },
  linkTitle: {
    fontSize: 13.5,
    fontWeight: "700",
    color: COLORS.ink,
    flex: 1,
  },
  prefsCard: {
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 15,
    gap: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.ink,
    marginBottom: 6,
  },
  fmtRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.edgeSoft,
  },
  fmtSwitch: {
    flexDirection: "row",
    borderRadius: 10,
    backgroundColor: COLORS.elev,
    padding: 3,
    gap: 3,
  },
  fmtPill: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 8,
  },
  fmtPillActive: {
    backgroundColor: COLORS.betclicRed,
  },
  fmtText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.ink,
  },
  fmtTextActive: {
    color: "#ffffff",
  },
  prefItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.edgeSoft,
  },
  prefLabel: {
    fontSize: 13.5,
    fontWeight: "600",
    color: COLORS.ink,
  },
  prefSub: {
    fontSize: 11,
    color: COLORS.dim,
    marginTop: 1,
  },
  logoutBtn: {
    height: 46,
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(225, 0, 20, 0.25)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  logoutText: {
    fontSize: 13.5,
    fontWeight: "800",
    color: COLORS.betclicRed,
  },
});
