import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useRouter } from "@/lib/router";
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
} from "@/components/icons";
import { api, type ClientWalletResponse } from "@/lib/api";
import { getCachedWalletSnapshot } from "@/lib/entity-cache";
import { eur } from "@/lib/format";
import { useSmartPolling } from "@/lib/polling";
import { cardSurface, colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

/**
 * Page `/parametres` (`Compte`) épurée fidèle à `src/app/(main)/parametres/page.tsx` :
 * - Onglets `Portefeuille | Réglages`
 * - Carte solde unique + actions `Déposer` / `Retirer`
 * - Annulation des retraits en attente (`canCancel && rawId != null`)
 * - Lien unique vers `/parametres/transactions` (sans doublon d'historique en ligne)
 * - Accès rapides `Mini-jeux`, `Résultats` (+ `Administration` si admin)
 * - Réglages : format des cotes (`1,85` / `17/20`), Sons, Vibrations Android, Mode économie 3G, Déconnexion.
 */
export default function CompteScreen() {
  const router = useRouter();
  const {
    user,
    balance,
    setBalance,
    applyUser,
    clearCombo,
    oddsFormat,
    soundEnabled,
    hapticsEnabled,
    dataSaverMode,
    setDataSaverMode,
    toast,
  } = useApp();

  const [tab, setTab] = useState<"wallet" | "settings">("wallet");
  const [wallet, setWallet] = useState<ClientWalletResponse | null>(() =>
    getCachedWalletSnapshot()
  );
  const [refreshing, setRefreshing] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const loadWallet = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.wallet();
      setWallet(res);
      setBalance(res.balance);
    } catch {
      // Conserve le snapshot
    }
  }, [setBalance, user]);

  useSmartPolling(loadWallet, 18_000, {
    enabled: Boolean(user),
    dataSaver: dataSaverMode,
    runImmediately: true,
  });

  if (!user) {
    return (
      <View style={[styles.root, { justifyContent: "center", padding: 20 }]}>
        <View style={[cardSurface.glassCard, styles.guestCard]}>
          <UserIcon size={28} color={colors.dim} />
          <Text style={styles.guestTitle}>Votre espace Compte & Portefeuille</Text>
          <Text style={styles.guestSub}>
            Connectez-vous pour déposer, retirer vos gains et personnaliser vos cotes.
          </Text>
          <Pressable
            onPress={() => router.push("/auth")}
            style={styles.loginBtn}
          >
            <Text style={styles.loginBtnText}>Connexion / Inscription</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const pendingWithdrawals = (wallet?.entries ?? []).filter(
    (e) => e.canCancel && e.rawId != null
  );

  const handleCancelWithdrawal = async (rawId: number) => {
    setCancellingId(rawId);
    try {
      const res = await api.withdrawals.cancel(rawId);
      setBalance(res.balance);
      await loadWallet();
      toast({
        kind: "success",
        title: "Retrait annulé",
        subtitle: "Le montant a été recrédité sur votre solde",
      });
    } catch (err) {
      toast({
        kind: "error",
        title: "Annulation impossible",
        subtitle: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setCancellingId(null);
    }
  };

  const handlePatchSetting = async (
    patch: Parameters<typeof api.updateSettings>[0]
  ) => {
    try {
      const res = await api.updateSettings(patch);
      applyUser(res.user);
    } catch {
      toast({ kind: "error", title: "Impossible d'enregistrer ce réglage" });
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await api.auth.logout();
      clearCombo();
      applyUser(null);
      router.replace("/auth");
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await loadWallet();
            setRefreshing(false);
          }}
          tintColor={colors.betclicRed}
          colors={[colors.betclicRed]}
        />
      }
    >
      {/* Profil compact */}
      <View style={styles.profileRow}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarInitial}>
            {(user.name || "J").slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.userName}>{user.name}</Text>
          <Text style={styles.userEmail}>{user.email}</Text>
        </View>
      </View>

      {/* Onglets Portefeuille / Réglages */}
      <View style={styles.segmentWrap}>
        <Pressable
          onPress={() => setTab("wallet")}
          style={[
            styles.segmentBtn,
            tab === "wallet" && styles.segmentBtnActive,
          ]}
        >
          <Text
            style={[
              styles.segmentText,
              tab === "wallet" && styles.segmentTextActive,
            ]}
          >
            Portefeuille
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab("settings")}
          style={[
            styles.segmentBtn,
            tab === "settings" && styles.segmentBtnActive,
          ]}
        >
          <Text
            style={[
              styles.segmentText,
              tab === "settings" && styles.segmentTextActive,
            ]}
          >
            Réglages
          </Text>
        </Pressable>
      </View>

      {tab === "wallet" ? (
        <>
          <View style={[cardSurface.glassCard, styles.walletCard]}>
            <Text style={styles.walletLabel}>Solde disponible</Text>
            <Text style={styles.walletAmount}>{eur(balance)}</Text>

            {wallet && wallet.summary.bonusLocked > 0 && (
              <Text style={styles.retirableNote}>
                Retirable immédiatement : {eur(wallet.summary.withdrawable)}
              </Text>
            )}

            <View style={styles.walletActions}>
              <Pressable
                onPress={() => {
                  triggerHaptic("light", hapticsEnabled);
                  router.push("/parametres/depot");
                }}
                style={styles.depositBtn}
              >
                <ArrowDownLeft size={16} color={colors.white} strokeWidth={2.5} />
                <Text style={styles.depositBtnText}>Déposer</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  triggerHaptic("light", hapticsEnabled);
                  router.push("/parametres/retrait");
                }}
                style={styles.withdrawBtn}
              >
                <ArrowUpRight size={16} color={colors.ink} strokeWidth={2.5} />
                <Text style={styles.withdrawBtnText}>Retirer</Text>
              </Pressable>
            </View>
          </View>

          {/* Retraits en attente annulables */}
          {pendingWithdrawals.map((w) => (
            <View key={w.id} style={[cardSurface.glassCard, styles.pendingCard]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pendingTitle}>
                  {w.title} · {eur(Math.abs(w.amount))}
                </Text>
                <Text style={styles.pendingSub}>{w.subtitle}</Text>
              </View>
              <Pressable
                disabled={cancellingId === w.rawId}
                onPress={() => {
                  if (w.rawId != null) void handleCancelWithdrawal(w.rawId);
                }}
                style={styles.cancelWdBtn}
              >
                <Text style={styles.cancelWdText}>Annuler</Text>
              </Pressable>
            </View>
          ))}

          {/* Liens de navigation épurés */}
          <View style={[cardSurface.glassCard, styles.navGroup]}>
            <NavRow
              Icon={History}
              label="Historique des mouvements"
              onPress={() => router.push("/parametres/transactions")}
            />
            <View style={styles.rowSep} />
            <NavRow
              Icon={Trophy}
              label="Résultats des matchs"
              onPress={() => router.push("/resultats")}
            />
            <View style={styles.rowSep} />
            <NavRow
              Icon={Gamepad2}
              label="Mini-jeux instantanés"
              onPress={() => router.push("/jeux")}
            />
            {user.role === "admin" && (
              <>
                <View style={styles.rowSep} />
                <NavRow
                  Icon={ShieldCheck}
                  label="Console d'administration"
                  onPress={() => router.push("/admin")}
                />
              </>
            )}
          </View>
        </>
      ) : (
        <>
          <View style={[cardSurface.glassCard, styles.settingsCard]}>
            <View style={styles.settingLine}>
              <Text style={styles.settingTitle}>Format d&apos;affichage des cotes</Text>
              <View style={styles.oddsSwitchRow}>
                {(["decimal", "fractional"] as const).map((fmt) => {
                  const active = oddsFormat === fmt;
                  return (
                    <Pressable
                      key={fmt}
                      onPress={() => void handlePatchSetting({ oddsFormat: fmt })}
                      style={[
                        styles.fmtPill,
                        active && styles.fmtPillActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.fmtPillText,
                          active && { color: colors.white },
                        ]}
                      >
                        {fmt === "decimal" ? "1,85" : "17/20"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.rowSep} />

            <View style={styles.settingLine}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingTitle}>Effets sonores</Text>
                <Text style={styles.settingSub}>Sons des mini-jeux & gains</Text>
              </View>
              <Switch
                value={soundEnabled}
                onValueChange={(v) => void handlePatchSetting({ soundEnabled: v })}
                trackColor={{ false: colors.edge, true: colors.betclicRed }}
              />
            </View>

            <View style={styles.rowSep} />

            <View style={styles.settingLine}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingTitle}>Vibrations haptiques Android</Text>
                <Text style={styles.settingSub}>Retour tactile sur cotes et Cash Out</Text>
              </View>
              <Switch
                value={hapticsEnabled}
                onValueChange={(v) =>
                  void handlePatchSetting({ hapticsEnabled: v })
                }
                trackColor={{ false: colors.edge, true: colors.betclicRed }}
              />
            </View>

            <View style={styles.rowSep} />

            <View style={styles.settingLine}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingTitle}>Mode économie 3G / Données</Text>
                <Text style={styles.settingSub}>
                  Réduit la fréquence de rafraîchissement réseau
                </Text>
              </View>
              <Switch
                value={dataSaverMode}
                onValueChange={setDataSaverMode}
                trackColor={{ false: colors.edge, true: colors.win }}
              />
            </View>
          </View>

          <Pressable
            disabled={loggingOut}
            onPress={() => void handleLogout()}
            style={styles.logoutFullBtn}
          >
            {loggingOut ? (
              <ActivityIndicator size="small" color={colors.betclicRed} />
            ) : (
              <>
                <LogOut size={16} color={colors.betclicRed} strokeWidth={2.4} />
                <Text style={styles.logoutFullText}>Se déconnecter</Text>
              </>
            )}
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

function NavRow({
  Icon,
  label,
  onPress,
}: {
  Icon: typeof History;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.navRow}>
      <Icon size={17} color={colors.ink} strokeWidth={2.2} />
      <Text style={styles.navRowText}>{label}</Text>
      <ChevronRight size={16} color={colors.dim} strokeWidth={2.4} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.deep,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 12,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  avatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontSize: 17,
    fontWeight: "900",
    color: colors.white,
  },
  userName: {
    fontSize: 16.5,
    fontWeight: "900",
    color: colors.ink,
  },
  userEmail: {
    fontSize: 12,
    color: colors.dim,
    fontWeight: "500",
  },
  segmentWrap: {
    flexDirection: "row",
    backgroundColor: colors.elev,
    borderRadius: 12,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    height: 36,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentBtnActive: {
    backgroundColor: colors.white,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.dim,
  },
  segmentTextActive: {
    color: colors.ink,
    fontWeight: "900",
  },
  walletCard: {
    padding: 16,
    gap: 8,
  },
  walletLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.dim,
  },
  walletAmount: {
    fontSize: 28,
    fontWeight: "900",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  retirableNote: {
    fontSize: 11.5,
    fontWeight: "600",
    color: colors.mist,
  },
  walletActions: {
    marginTop: 6,
    flexDirection: "row",
    gap: 8,
  },
  depositBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.betclicRed,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  depositBtnText: {
    fontSize: 13.5,
    fontWeight: "900",
    color: colors.white,
  },
  withdrawBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.elev,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  withdrawBtnText: {
    fontSize: 13.5,
    fontWeight: "800",
    color: colors.ink,
  },
  pendingCard: {
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pendingTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.ink,
  },
  pendingSub: {
    fontSize: 11.5,
    color: colors.dim,
  },
  cancelWdBtn: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: "rgba(225,0,20,0.10)",
  },
  cancelWdText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.betclicRed,
  },
  navGroup: {
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  navRow: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  navRowText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: colors.ink,
  },
  rowSep: {
    height: 1,
    backgroundColor: colors.edgeSoft,
  },
  settingsCard: {
    padding: 14,
    gap: 11,
  },
  settingLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  settingTitle: {
    fontSize: 13.5,
    fontWeight: "800",
    color: colors.ink,
  },
  settingSub: {
    fontSize: 11.5,
    color: colors.dim,
    marginTop: 1,
  },
  oddsSwitchRow: {
    flexDirection: "row",
    gap: 5,
  },
  fmtPill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.elev,
  },
  fmtPillActive: {
    backgroundColor: colors.ink,
  },
  fmtPillText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.ink,
  },
  logoutFullBtn: {
    height: 46,
    borderRadius: 13,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: "rgba(225,0,20,0.28)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  logoutFullText: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.betclicRed,
  },
  guestCard: {
    padding: 22,
    alignItems: "center",
    gap: 8,
  },
  guestTitle: {
    fontSize: 15.5,
    fontWeight: "900",
    color: colors.ink,
    textAlign: "center",
  },
  guestSub: {
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.mist,
    textAlign: "center",
  },
  loginBtn: {
    marginTop: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.betclicRed,
  },
  loginBtnText: {
    fontSize: 13.5,
    fontWeight: "800",
    color: colors.white,
  },
});
