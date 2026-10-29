import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  ChevronRight,
  Globe,
  History,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Vibrate,
  Volume2,
  Wallet,
  X,
  Zap,
} from "lucide-react-native";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import { useApp } from "@/context/app-context";
import { api, type ClientUser, type ClientWalletData } from "@/lib/api";
import { getCachedWallet } from "@/lib/entity-cache";
import { eur, formatPlacedAt, initials, teamHue } from "@/lib/format";
import { createIdempotencyKey, isBiometricLoginEnabled, setBiometricLoginEnabled } from "@/lib/http";
import { registerPushDevice, unregisterPushDevice } from "@/lib/push-notifications";
import {
  getOtaRuntimeDiagnostics,
  manualCheckAndApplyOtaUpdate,
} from "@/lib/ota-updates";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

function walletSignature(w: ClientWalletData | null): string {
  if (!w) return "";
  const s = w.summary;
  const first = w.entries[0];
  return [
    w.balance.toFixed(6),
    (s.withdrawable ?? 0).toFixed(6),
    (s.bonusRemaining ?? 0).toFixed(6),
    s.pendingWithdrawals.toFixed(6),
    (s.pendingDeposits ?? 0).toFixed(6),
    w.entries.length,
    first ? `${first.id}:${first.status}:${first.amount.toFixed(6)}` : "",
  ].join("|");
}

export default function ParametresScreen() {
  const router = useRouter();
  const {
    authReady,
    sessionRestoring,
    user,
    applyUser,
    setBalance,
    toast,
    betsVersion,
    countryConfig,
    currencyConfig,
    dataSaverEnabled,
    setDataSaverEnabled,
  } = useApp();

  const userId = user?.id ?? null;
  const userBalance = user?.balance ?? 0;
  const userBalanceRef = useRef(userBalance);
  useEffect(() => {
    userBalanceRef.current = userBalance;
  }, [userBalance]);

  const [wallet, setWallet] = useState<ClientWalletData | null>(() =>
    getCachedWallet()
  );
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [checkingOta, setCheckingOta] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  useEffect(() => { void isBiometricLoginEnabled().then(setBiometricEnabled); }, []);
  const changeBiometrics = async (enabled: boolean) => {
    if (biometricBusy) return;
    setBiometricBusy(true);
    try {
      await setBiometricLoginEnabled(enabled);
      setBiometricEnabled(enabled);
      toast({ kind: "success", title: enabled ? "Connexion biométrique activée" : "Connexion biométrique désactivée" });
    } catch (error) {
      toast({ kind: "error", title: "Biométrie indisponible", description: error instanceof Error ? error.message : "Réessayez avec votre mot de passe." });
    } finally { setBiometricBusy(false); }
  };
  const [mobileTab, setMobileTab] = useState<"wallet" | "settings">("wallet");
  const [refreshing, setRefreshing] = useState(false);
  const otaDiag = useMemo(() => getOtaRuntimeDiagnostics(), []);

  const cancelSlotRef = useRef<Map<number, string>>(new Map());
  const cancelInFlightRef = useRef(false);

  const applyWalletSnapshot = useCallback(
    (w: ClientWalletData) => {
      setWallet((prev) =>
        walletSignature(prev) === walletSignature(w) ? prev : w
      );
      if (
        typeof w.balance === "number" &&
        Math.abs(userBalanceRef.current - w.balance) > 1e-5
      ) {
        setBalance(w.balance);
      }
    },
    [setBalance]
  );

  const loadWallet = useCallback(async () => {
    if (userId == null && !sessionRestoring) return;
    try {
      const w = await api.wallet();
      applyWalletSnapshot(w);
    } catch {
      /* silencieux */
    }
  }, [applyWalletSnapshot, sessionRestoring, userId]);

  useEffect(() => {
    void loadWallet();
    if (userId == null && !sessionRestoring) return;
    const id = setInterval(() => void loadWallet(), 8_000);
    return () => clearInterval(id);
  }, [loadWallet, betsVersion, sessionRestoring, userId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (userId != null || sessionRestoring) {
        const w = await api.wallet({ forceRefresh: true });
        applyWalletSnapshot(w);
      }
    } catch {
      /* silencieux */
    } finally {
      setRefreshing(false);
    }
  }, [applyWalletSnapshot, sessionRestoring, userId]);

  const pendingWithdrawalEntries = useMemo(
    () =>
      (wallet?.entries ?? []).filter(
        (e) => e.type === "withdrawal" && e.canCancel && e.rawId != null
      ),
    [wallet]
  );

  const cancelWithdrawal = async (withdrawalId: number) => {
    if (cancellingId != null || cancelInFlightRef.current) return;
    cancelInFlightRef.current = true;
    const idemKey =
      cancelSlotRef.current.get(withdrawalId) ??
      createIdempotencyKey("wdcancel");
    cancelSlotRef.current.set(withdrawalId, idemKey);
    setCancellingId(withdrawalId);
    try {
      const res = await api.cancelWithdrawal(withdrawalId, idemKey);
      cancelSlotRef.current.delete(withdrawalId);
      setBalance(res.balance);
      void loadWallet();
      toast({ kind: "success", title: "Retrait annulé et recrédité" });
    } catch (e) {
      toast({
        kind: "error",
        title: "Annulation impossible",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      cancelInFlightRef.current = false;
      setCancellingId(null);
    }
  };

  const patch = async (p: Partial<ClientUser>, label: string) => {
    try {
      const r = await api.patchSettings(p);
      applyUser(r.user);
      toast({ kind: "success", title: label });
    } catch {
      toast({ kind: "error", title: "Impossible d'enregistrer" });
    }
  };

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await unregisterPushDevice().catch(() => {});
      await api.auth.logout();
    } catch {
      /* déconnexion locale même en cas d'erreur réseau */
    }
    applyUser(null);
    router.replace("/auth");
    setLoggingOut(false);
  };

  const handleManualOtaCheck = async () => {
    if (checkingOta) return;
    setCheckingOta(true);
    try {
      const res = await manualCheckAndApplyOtaUpdate();
      if (res.status === "up_to_date") {
        toast({
          kind: "success",
          title: "Application à jour",
          description: `Version ${otaDiag.appVersion} active`,
        });
      } else if (res.status === "expo_go") {
        toast({
          kind: "info",
          title: "Client Expo Go détecté",
          description: "Les mises à jour OTA sont servies automatiquement par /api/expo.",
        });
      } else if (res.status === "disabled") {
        toast({
          kind: "info",
          title: `Version ${otaDiag.appVersion}`,
          description: "Les mises à jour OTA s'activent dans le build APK Release.",
        });
      } else if (res.status === "error") {
        toast({
          kind: "error",
          title: "Vérification OTA indisponible",
          description: res.message,
        });
      }
    } finally {
      setCheckingOta(false);
    }
  };

  if ((!authReady || sessionRestoring) && !user) {
    return (
      <View style={styles.page}>
        <PulseFlashLoader compact />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.page, styles.guestWrap]}>
        <View style={styles.guestCard}>
          <View style={styles.guestIconCircle}>
            <Lock size={22} color={COLORS.betclicRed} strokeWidth={2.2} />
          </View>
          <Text style={styles.guestTitle}>Accédez à votre compte PULSE</Text>
          <Text style={styles.guestSub}>
            Gérez votre portefeuille, vos dépôts, vos retraits et vos
            préférences de jeu.
          </Text>
          <Pressable
            onPress={() => router.push("/auth")}
            style={styles.guestBtn}
          >
            <Text style={styles.guestBtnText}>Se connecter</Text>
            <ArrowRight size={15} color="#ffffff" strokeWidth={2.4} />
          </Pressable>
        </View>
      </View>
    );
  }

  const hue = teamHue(user.name ?? "Pulse");

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      overScrollMode="never"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[COLORS.betclicRed]}
          tintColor={COLORS.betclicRed}
        />
      }
    >
      {/* En-tête + mini-badge profil mobile identiques à src/app/(main)/parametres/page.tsx */}
      <View style={styles.headerRow}>
        <Text style={styles.pageTitle}>Compte</Text>

        <View style={styles.profileMini}>
          <View style={styles.profileTextCol}>
            <Text numberOfLines={1} style={styles.profileName}>
              {user.name}
            </Text>
            <Text numberOfLines={1} style={styles.profileEmail}>
              {user.email}
            </Text>
          </View>
          <LinearGradient
            colors={[
              `hsl(${hue}, 60%, 44%)`,
              `hsl(${(hue + 36) % 360}, 68%, 30%)`,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatarBox}
          >
            <Text style={styles.avatarInitials}>{initials(user.name)}</Text>
          </LinearGradient>
        </View>
      </View>

      {/* Sélecteur mobile en 2 onglets nets : Portefeuille | Réglages */}
      <View style={styles.tabSwitch}>
        <Pressable
          onPress={() => setMobileTab("wallet")}
          style={[
            styles.tabBtn,
            mobileTab === "wallet" && styles.tabBtnActive,
          ]}
        >
          <Wallet
            size={14}
            color={mobileTab === "wallet" ? "#ffffff" : COLORS.mist}
            strokeWidth={2.3}
          />
          <Text
            style={[
              styles.tabBtnText,
              mobileTab === "wallet" && { color: "#ffffff" },
            ]}
          >
            Portefeuille
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setMobileTab("settings")}
          style={[
            styles.tabBtn,
            mobileTab === "settings" && styles.tabBtnActive,
          ]}
        >
          <SlidersHorizontal
            size={14}
            color={mobileTab === "settings" ? "#ffffff" : COLORS.mist}
            strokeWidth={2.3}
          />
          <Text
            style={[
              styles.tabBtnText,
              mobileTab === "settings" && { color: "#ffffff" },
            ]}
          >
            Réglages
          </Text>
        </Pressable>
      </View>

      {mobileTab === "wallet" ? (
        <View style={styles.sectionStack}>
          {/* Carte solde + Déposer / Retirer */}
          <View style={styles.cardPad}>
            <View style={styles.walletInnerBox}>
              <View style={styles.walletTopRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.walletLabel}>Solde disponible</Text>
                  <Text style={styles.walletAmount}>{eur(user.balance)}</Text>
                  {wallet &&
                  wallet.summary.withdrawable != null &&
                  (wallet.summary.bonusRemaining ?? 0) > 1e-4 &&
                  wallet.summary.withdrawable < user.balance - 1e-4 ? (
                    <Text style={styles.withdrawableNote}>
                      Retirable :{" "}
                      <Text style={{ fontWeight: "500", color: COLORS.win }}>
                        {eur(wallet.summary.withdrawable)}
                      </Text>
                      {wallet.summary.bonusRemaining != null &&
                      wallet.summary.bonusRemaining > 0 ? (
                        <Text style={{ color: COLORS.dim }}>
                          {" "}
                          · Bonus {eur(wallet.summary.bonusRemaining)}
                        </Text>
                      ) : null}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.pendingPillsCol}>
                  {wallet && wallet.summary.pendingWithdrawals > 0 ? (
                    <View style={styles.pendingWdPill}>
                      <Text style={styles.pendingWdText}>
                        {eur(wallet.summary.pendingWithdrawals)} en retrait
                      </Text>
                    </View>
                  ) : null}
                  {wallet && (wallet.summary.pendingDeposits ?? 0) > 0 ? (
                    <View style={styles.pendingDepPill}>
                      <Text style={styles.pendingDepText}>
                        +{eur(wallet.summary.pendingDeposits ?? 0)} en dépôt
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>

              <View style={styles.walletBtnsGrid}>
                <Pressable
                  onPress={() => router.push("/parametres/depot")}
                  style={styles.depositBtn}
                >
                  <Plus size={16} color="#ffffff" strokeWidth={2.6} />
                  <Text style={styles.depositBtnText}>Déposer</Text>
                </Pressable>
                <Pressable
                  onPress={() => router.push("/parametres/retrait")}
                  style={styles.withdrawBtn}
                >
                  <ArrowUpRight
                    size={16}
                    color={COLORS.betclicRed}
                    strokeWidth={2.4}
                  />
                  <Text style={styles.withdrawBtnText}>Retirer</Text>
                </Pressable>
              </View>
            </View>
          </View>

          {/* Retraits en attente avec annulation immédiate */}
          {pendingWithdrawalEntries.length > 0 ? (
            <View style={styles.listCard}>
              {pendingWithdrawalEntries.map((entry, idx) => (
                <View
                  key={entry.id}
                  style={[
                    styles.pendingRow,
                    idx > 0 && styles.rowDivider,
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={styles.pendingRowTitle}>
                      Retrait en attente · {eur(Math.abs(entry.amount))}
                    </Text>
                    <Text numberOfLines={1} style={styles.pendingRowSub}>
                      {entry.subtitle} · {formatPlacedAt(entry.createdAt)}
                    </Text>
                  </View>
                  <Pressable
                    disabled={cancellingId === entry.rawId}
                    onPress={() =>
                      entry.rawId != null && cancelWithdrawal(entry.rawId)
                    }
                    style={styles.cancelBtn}
                  >
                    {cancellingId === entry.rawId ? (
                      <ActivityIndicator size="small" color={COLORS.ink} />
                    ) : (
                      <X
                        size={14}
                        color={COLORS.betclicRed}
                        strokeWidth={2.4}
                      />
                    )}
                    <Text style={styles.cancelBtnText}>Annuler</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {/* Lien direct vers l'historique des mouvements */}
          <Pressable
            onPress={() => router.push("/parametres/transactions")}
            style={({ pressed }) => [
              styles.navRowCard,
              pressed && { backgroundColor: COLORS.elev },
            ]}
          >
            <View style={styles.redIconBox}>
              <History size={16} color={COLORS.betclicRed} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.navRowTitle}>Historique des mouvements</Text>
              <Text numberOfLines={1} style={styles.navRowSub}>
                {wallet
                  ? `${wallet.entries.length} opération${
                      wallet.entries.length > 1 ? "s" : ""
                    }`
                  : "Dépôts, retraits, mises et gains"}
              </Text>
            </View>
            <ChevronRight size={16} color={COLORS.dim} strokeWidth={2.2} />
          </Pressable>

          {/* Accès Admin (si administrateur) */}
          {user.role === "admin" ? (
            <Pressable
              onPress={() => router.push("/admin")}
              style={({ pressed }) => [
                styles.navRowCard,
                pressed && { backgroundColor: COLORS.elev },
              ]}
            >
              <View style={styles.redIconBox}>
                <ShieldCheck
                  size={16}
                  color={COLORS.betclicRed}
                  strokeWidth={2.2}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.navRowTitle}>Espace administrateur</Text>
              </View>
              <ChevronRight size={16} color={COLORS.dim} strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={styles.sectionStack}>
          <View style={styles.listCard}>
            {/* Pays & devise officielle verrouillés à l'inscription */}
            <View style={styles.prefRow}>
              <View style={[styles.prefLeft, { flex: 1 }]}>
                <View style={styles.grayIconBox}>
                  <Globe size={16} color={COLORS.ink} strokeWidth={2.1} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.prefLabel}>Pays & devise du compte</Text>
                  <Text numberOfLines={1} style={styles.navRowSub}>
                    {countryConfig.flag} {countryConfig.name} · {currencyConfig.name}
                  </Text>
                </View>
              </View>
              <View style={styles.lockedCurrencyPill}>
                <Lock size={11} color={COLORS.dim} strokeWidth={2.2} />
                <Text style={styles.lockedCurrencyPillText}>
                  {currencyConfig.code} ({currencyConfig.symbol})
                </Text>
              </View>
            </View>

            {/* Format des cotes */}
            <View style={styles.prefRow}>
              <View style={styles.prefLeft}>
                <View style={styles.grayIconBox}>
                  <SlidersHorizontal
                    size={16}
                    color={COLORS.ink}
                    strokeWidth={2.1}
                  />
                </View>
                <Text style={styles.prefLabel}>Format des cotes</Text>
              </View>
              <View style={styles.oddsFmtSwitch}>
                {(["decimal", "fractional"] as const).map((fmt) => {
                  const active = (user.oddsFormat ?? "decimal") === fmt;
                  return (
                    <Pressable
                      key={fmt}
                      onPress={() =>
                        patch(
                          { oddsFormat: fmt },
                          "Format des cotes mis à jour"
                        )
                      }
                      style={[
                        styles.oddsFmtBtn,
                        active && styles.oddsFmtBtnActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.oddsFmtText,
                          active && { color: COLORS.ink },
                        ]}
                      >
                        {fmt === "decimal" ? "1.85" : "17/20"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <SwitchRow
              icon={<Bell size={16} color={COLORS.ink} strokeWidth={2.1} />}
              label="Notifications de paris"
              checked={user.notifications ?? true}
              onChange={(v) =>
                patch({ notifications: v }, "Notifications mises à jour")
              }
            />
            <Pressable onPress={() => void (async () => {
              try {
                await registerPushDevice(true);
                const result = await api.patchSettings({ notifications: true });
                applyUser(result.user);
                toast({ kind: "success", title: "Notifications système activées" });
              } catch (e) {
                toast({ kind: "error", title: "Notifications indisponibles", description: e instanceof Error ? e.message : "Réessayez plus tard." });
              }
            })()} style={styles.prefRow}>
              <Text style={styles.prefLabel}>Activer les notifications système</Text>
              <ChevronRight size={16} color={COLORS.dim} />
            </Pressable>
            <SwitchRow
              icon={<ShieldCheck size={16} color={COLORS.ink} strokeWidth={2.1} />}
              label="Connexion biométrique"
              checked={biometricEnabled}
              onChange={(v) => void changeBiometrics(v)}
            />
            <SwitchRow
              icon={<Volume2 size={16} color={COLORS.ink} strokeWidth={2.1} />}
              label="Effets sonores"
              checked={user.sound ?? true}
              onChange={(v) => patch({ sound: v }, "Sons mis à jour")}
            />
            <SwitchRow
              icon={<Vibrate size={16} color={COLORS.ink} strokeWidth={2.1} />}
              label="Retour haptique"
              checked={user.haptics ?? true}
              onChange={(v) => patch({ haptics: v }, "Vibrations mises à jour")}
            />
            <SwitchRow
              icon={<Zap size={16} color={COLORS.ink} strokeWidth={2.1} />}
              label="Mode économie 3G"
              checked={dataSaverEnabled}
              onChange={(v) => {
                setDataSaverEnabled(v);
                toast({
                  kind: "success",
                  title: v
                    ? "Mode économie 3G activé"
                    : "Rafraîchissement rapide restauré",
                });
              }}
              last
            />
          </View>

          <Pressable
            disabled={checkingOta}
            onPress={() => void handleManualOtaCheck()}
            style={({ pressed }) => [
              styles.navRowCard,
              checkingOta && { opacity: 0.65 },
              pressed && { backgroundColor: COLORS.elev },
            ]}
          >
            <View style={styles.grayIconBox}>
              {checkingOta ? (
                <ActivityIndicator size="small" color={COLORS.ink} />
              ) : (
                <RefreshCw size={15} color={COLORS.ink} strokeWidth={2.1} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.navRowTitle}>
                Mises à jour OTA automatiques
              </Text>
              <Text numberOfLines={1} style={styles.navRowSub}>
                {`v${otaDiag.appVersion} · ${
                  otaDiag.shortUpdateId
                    ? `OTA #${otaDiag.shortUpdateId}`
                    : otaDiag.isSupported
                      ? "Active au lancement"
                      : "Serveur OTA configuré"
                }`}
              </Text>
            </View>
            <Text
              style={{
                fontSize: 10.5,
                fontWeight: "500",
                color: COLORS.betclicRed,
              }}
            >
              {checkingOta ? "Analyse…" : "Vérifier"}
            </Text>
          </Pressable>

          <Pressable
            disabled={loggingOut}
            onPress={logout}
            style={({ pressed }) => [
              styles.navRowCard,
              loggingOut && { opacity: 0.6 },
              pressed && { backgroundColor: "rgba(225,0,20,0.05)" },
            ]}
          >
            <View style={styles.redIconBox}>
              {loggingOut ? (
                <ActivityIndicator size="small" color={COLORS.betclicRed} />
              ) : (
                <LogOut
                  size={16}
                  color={COLORS.betclicRed}
                  strokeWidth={2.1}
                />
              )}
            </View>
            <Text style={styles.logoutText}>Se déconnecter</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.footerDisclaimer}>
        18+ · Jouer comporte des risques : endettement, isolement, dépendance.
      </Text>
    </ScrollView>
  );
}

function SwitchRow({
  icon,
  label,
  checked,
  onChange,
  last,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.prefRow, !last && styles.rowBottomDivider]}>
      <View style={styles.prefLeft}>
        <View style={styles.grayIconBox}>{icon}</View>
        <Text style={styles.prefLabel}>{label}</Text>
      </View>
      <Switch
        value={checked}
        onValueChange={onChange}
        trackColor={{ false: "#d1d5db", true: COLORS.betclicRed }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: COLORS.deep,
  },
  content: {
    paddingHorizontal: 8,
    paddingTop: 14,
    paddingBottom: 32,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  pageTitle: {
    fontSize: 14.5,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: COLORS.ink,
  },
  profileMini: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  profileTextCol: {
    maxWidth: 145,
    alignItems: "flex-end",
  },
  profileName: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.ink,
  },
  profileEmail: {
    fontSize: 10,
    color: COLORS.dim,
  },
  avatarBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: {
    fontSize: 11,
    fontWeight: "500",
    color: "#ffffff",
  },
  tabSwitch: {
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 4,
    flexDirection: "row",
    gap: 6,
  },
  tabBtn: {
    flex: 1,
    height: 38,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  tabBtnActive: {
    backgroundColor: COLORS.betclicRed,
  },
  tabBtnText: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.mist,
  },
  sectionStack: {
    marginTop: 12,
    gap: 12,
  },
  cardPad: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 16,
  },
  walletInnerBox: {
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    padding: 12,
  },
  walletTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  walletLabel: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.dim,
  },
  walletAmount: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: "500",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  withdrawableNote: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.mist,
  },
  pendingPillsCol: {
    alignItems: "flex-end",
    gap: 4,
  },
  pendingWdPill: {
    borderRadius: 999,
    backgroundColor: "rgba(245,158,11,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  pendingWdText: {
    fontSize: 9.5,
    fontWeight: "500",
    color: "#92400e",
  },
  pendingDepPill: {
    borderRadius: 999,
    backgroundColor: "rgba(14,165,233,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  pendingDepText: {
    fontSize: 9.5,
    fontWeight: "500",
    color: "#075985",
  },
  walletBtnsGrid: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
  },
  depositBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.betclicRed,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  depositBtnText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#ffffff",
  },
  withdrawBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  withdrawBtnText: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.ink,
  },
  listCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  pendingRow: {
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: COLORS.edge,
  },
  rowBottomDivider: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.edge,
  },
  pendingRowTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.ink,
  },
  pendingRowSub: {
    marginTop: 2,
    fontSize: 10,
    color: COLORS.dim,
  },
  cancelBtn: {
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  cancelBtnText: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.ink,
  },
  navRowCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  redIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(225,0,20,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  grayIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  navRowTitle: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  navRowSub: {
    marginTop: 1,
    fontSize: 10.5,
    color: COLORS.dim,
  },
  prefRow: {
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  prefLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  prefLabel: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: "500",
    color: COLORS.ink,
  },
  oddsFmtSwitch: {
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    padding: 2,
    flexDirection: "row",
  },
  oddsFmtBtn: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  oddsFmtBtnActive: {
    backgroundColor: "#ffffff",
  },
  oddsFmtText: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.mist,
  },
  logoutText: {
    fontSize: 11.5,
    fontWeight: "500",
    color: COLORS.betclicRed,
  },
  footerDisclaimer: {
    marginTop: 24,
    textAlign: "center",
    fontSize: 10,
    color: COLORS.dim,
    lineHeight: 16,
  },
  guestWrap: {
    paddingHorizontal: 8,
    justifyContent: "center",
  },
  guestCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 24,
    alignItems: "center",
  },
  guestIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(225,0,20,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  guestTitle: {
    marginTop: 12,
    fontSize: 12.5,
    fontWeight: "700",
    color: COLORS.ink,
    textAlign: "center",
  },
  guestSub: {
    marginTop: 6,
    fontSize: 11,
    color: COLORS.mist,
    textAlign: "center",
    lineHeight: 18,
  },
  guestBtn: {
    marginTop: 18,
    height: 44,
    borderRadius: 999,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  guestBtnText: {
    fontSize: 11.5,
    fontWeight: "500",
    color: "#ffffff",
  },
  lockedCurrencyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 8,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  lockedCurrencyPillText: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.ink,
  },
});
