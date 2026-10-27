import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Check,
  Dices,
  Lock,
  RefreshCw,
  ShieldCheck,
  Unlock,
  X,
} from "lucide-react-native";
import { useApp } from "@/context/app-context";
import { api, ApiHttpError } from "@/lib/api";
import { eur } from "@/lib/format";
import { useSmartPolling } from "@/lib/polling";
import { Redirect } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

interface ForecastInfo {
  matchId: number;
  homeScore: number;
  awayScore: number;
  locked: boolean;
}

interface AdminMatchRow {
  id: number;
  league: string;
  source: "virtual" | "manual";
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  minute: string | null;
}

interface AdminDepositRow {
  id: number;
  userId: number;
  userName: string;
  provider: string;
  providerRef: string;
  amount: number;
  status: string;
}

interface AdminWithdrawalRow {
  id: number;
  userId: number;
  userName: string;
  method: string;
  destination: string;
  amount: number;
  status: string;
}

interface AdminUserRow {
  id: number;
  name: string;
  email?: string;
  balance: number;
  role: string;
}

interface AdminPanelData {
  scenarioMode?: "dynamic" | "locked";
  matchForecasts?: Record<string, ForecastInfo>;
  stats?: {
    totalUsers: number;
    totalBets: number;
    netRevenue: number;
    balance: number;
    pendingDeposits: number;
    pendingWithdrawals: number;
    liveMatches: number;
    openQuestions: number;
  };
  matches?: AdminMatchRow[];
  deposits?: AdminDepositRow[];
  withdrawals?: AdminWithdrawalRow[];
  users?: AdminUserRow[];
}

export default function AdminScreen() {
  const { user, authReady, dataSaverMode, toast } = useApp();

  const [panel, setPanel] = useState<AdminPanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [tab, setTab] = useState<"virtuals" | "official" | "finance" | "users">(
    "virtuals"
  );
  const [scoreDrafts, setScoreDrafts] = useState<
    Record<number, { h: string; a: string }>
  >({});
  const [balanceDrafts, setBalanceDrafts] = useState<Record<number, string>>(
    {}
  );

  const load = useCallback(async () => {
    if (user?.role !== "admin") return;
    try {
      const res = (await api.admin.panel()) as unknown as AdminPanelData;
      setPanel(res);
    } catch {
      /* garde snapshot */
    } finally {
      setLoading(false);
    }
  }, [user?.role]);

  useEffect(() => {
    void load();
  }, [load]);

  useSmartPolling(load, 10_000, {
    enabled: user?.role === "admin",
    dataSaver: dataSaverMode,
    runImmediately: false,
  });

  if (authReady && (!user || user.role !== "admin")) {
    return <Redirect href="/matchs" />;
  }

  const runAction = async (
    key: string,
    body: Record<string, unknown>,
    okMsg: string
  ) => {
    setBusyKey(key);
    try {
      await api.admin.action(body);
      await load();
      toast({ kind: "success", title: okMsg });
    } catch (err) {
      toast({
        kind: "error",
        title: "Opération refusée",
        description:
          err instanceof ApiHttpError ? err.message : "Erreur serveur.",
      });
    } finally {
      setBusyKey(null);
    }
  };

  const virtualMatches = (panel?.matches ?? []).filter(
    (m) => m.source !== "manual" && m.status !== "finished"
  );
  const officialMatches = (panel?.matches ?? []).filter(
    (m) => m.source === "manual" && m.status !== "finished"
  );
  const pendingDeposits = (panel?.deposits ?? []).filter(
    (d) => d.status === "pending_review"
  );
  const pendingWithdrawals = (panel?.withdrawals ?? []).filter(
    (w) => w.status === "pending"
  );

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          colors={[COLORS.betclicRed]}
          tintColor={COLORS.betclicRed}
        />
      }
    >
      {/* En-tête Console Admin */}
      <View style={styles.headerCard}>
        <View style={styles.headerTop}>
          <View style={styles.titleRow}>
            <ShieldCheck size={18} color={COLORS.amber} strokeWidth={2.4} />
            <Text style={styles.pageTitle}>Pilotage Bookmaker</Text>
          </View>
          <Pressable
            disabled={busyKey === "sync"}
            onPress={() =>
              runAction(
                "sync",
                { action: "syncAllRealMatches" },
                "Flux officiels synchronisés"
              )
            }
            style={styles.syncBtn}
          >
            <RefreshCw size={13} color={COLORS.ink} strokeWidth={2.3} />
            <Text style={styles.syncText}>Sync ESPN</Text>
          </Pressable>
        </View>

        {panel?.stats ? (
          <View style={styles.kpiGrid}>
            <View style={styles.kpiCell}>
              <Text style={styles.kpiLabel}>Produit Net (GGR)</Text>
              <Text
                style={[
                  styles.kpiVal,
                  {
                    color:
                      panel.stats.netRevenue >= 0
                        ? COLORS.win
                        : COLORS.betclicRed,
                  },
                ]}
              >
                {eur(panel.stats.netRevenue)}
              </Text>
            </View>
            <View style={styles.kpiCell}>
              <Text style={styles.kpiLabel}>Joueurs ({panel.stats.totalUsers})</Text>
              <Text style={styles.kpiVal}>{eur(panel.stats.balance)}</Text>
            </View>
            <View style={styles.kpiCell}>
              <Text style={styles.kpiLabel}>Tickets totaux</Text>
              <Text style={styles.kpiVal}>{panel.stats.totalBets}</Text>
            </View>
            <View style={styles.kpiCell}>
              <Text style={styles.kpiLabel}>À valider</Text>
              <Text style={styles.kpiVal}>
                {panel.stats.pendingDeposits + panel.stats.pendingWithdrawals}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* Navigation des onglets Admin */}
      <View style={styles.tabsRow}>
        {[
          { key: "virtuals", label: "Virtuels" },
          { key: "official", label: "Officiels" },
          {
            key: "finance",
            label: `Finance (${pendingDeposits.length + pendingWithdrawals.length})`,
          },
          { key: "users", label: "Joueurs" },
        ].map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() =>
                setTab(t.key as "virtuals" | "official" | "finance" | "users")
              }
              style={[styles.tabPill, active && styles.tabPillActive]}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading && !panel ? (
        <View style={styles.loader}>
          <ActivityIndicator size="small" color={COLORS.betclicRed} />
        </View>
      ) : tab === "virtuals" ? (
        <View style={styles.section}>
          {/* Sélecteur Mode 1 (dynamique + verrouillage manuel) vs Mode 2 (100 % pré-verrouillé) */}
          <View style={styles.modeCard}>
            <Text style={styles.cardHeading}>Moteur des scénarios virtuels</Text>
            <View style={styles.modeButtons}>
              <Pressable
                onPress={() =>
                  runAction(
                    "mode-dyn",
                    { action: "setScenarioMode", mode: "dynamic" },
                    "Mode 1 activé : aperçu dynamique"
                  )
                }
                style={[
                  styles.modeBtn,
                  panel?.scenarioMode !== "locked" && styles.modeBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.modeBtnTitle,
                    panel?.scenarioMode !== "locked" && { color: "#ffffff" },
                  ]}
                >
                  Mode 1 · Dynamique
                </Text>
                <Text
                  style={[
                    styles.modeBtnSub,
                    panel?.scenarioMode !== "locked" && {
                      color: "rgba(255,255,255,0.8)",
                    },
                  ]}
                >
                  Aperçu + verrouillage manuel
                </Text>
              </Pressable>

              <Pressable
                onPress={() =>
                  runAction(
                    "mode-lock",
                    { action: "setScenarioMode", mode: "locked" },
                    "Mode 2 activé : scores 100 % pré-verrouillés"
                  )
                }
                style={[
                  styles.modeBtn,
                  panel?.scenarioMode === "locked" && styles.modeBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.modeBtnTitle,
                    panel?.scenarioMode === "locked" && { color: "#ffffff" },
                  ]}
                >
                  Mode 2 · Pré-verrouillé
                </Text>
                <Text
                  style={[
                    styles.modeBtnSub,
                    panel?.scenarioMode === "locked" && {
                      color: "rgba(255,255,255,0.8)",
                    },
                  ]}
                >
                  100 % figé dès création
                </Text>
              </Pressable>
            </View>
          </View>

          {virtualMatches.map((m) => {
            const fc = panel?.matchForecasts?.[String(m.id)];
            const draft = scoreDrafts[m.id] ?? {
              h: String(fc?.homeScore ?? m.homeScore ?? 0),
              a: String(fc?.awayScore ?? m.awayScore ?? 0),
            };
            return (
              <View key={m.id} style={styles.itemCard}>
                <View style={styles.itemHead}>
                  <Text numberOfLines={1} style={styles.itemTitle}>
                    {m.homeTeam} – {m.awayTeam}
                  </Text>
                  <Text style={styles.itemMeta}>
                    {m.status === "live" ? m.minute ?? "LIVE" : "À venir"}
                  </Text>
                </View>

                {fc ? (
                  <Text style={styles.forecastLine}>
                    Score final prévu : {fc.homeScore} - {fc.awayScore}{" "}
                    {fc.locked ? "(Verrouillé)" : "(Dynamique)"}
                  </Text>
                ) : null}

                <View style={styles.controlsRow}>
                  <Pressable
                    onPress={() =>
                      runAction(
                        `lock-${m.id}`,
                        {
                          action: fc?.locked
                            ? "unlockMatchScenario"
                            : "lockMatchScenario",
                          matchId: m.id,
                        },
                        fc?.locked
                          ? "Scénario déverrouillé"
                          : "Scénario verrouillé"
                      )
                    }
                    style={styles.ctrlBtn}
                  >
                    {fc?.locked ? (
                      <Unlock size={13} color={COLORS.ink} strokeWidth={2.2} />
                    ) : (
                      <Lock size={13} color={COLORS.ink} strokeWidth={2.2} />
                    )}
                    <Text style={styles.ctrlBtnText}>
                      {fc?.locked ? "Déverrouiller" : "Verrouiller"}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() =>
                      runAction(
                        `reroll-${m.id}`,
                        { action: "rerollMatchScenario", matchId: m.id },
                        "Nouveau scénario tiré"
                      )
                    }
                    style={styles.ctrlBtn}
                  >
                    <Dices size={13} color={COLORS.ink} strokeWidth={2.2} />
                    <Text style={styles.ctrlBtnText}>Relancer</Text>
                  </Pressable>
                </View>

                <View style={styles.forceScoreRow}>
                  <TextInput
                    value={draft.h}
                    onChangeText={(v) =>
                      setScoreDrafts((prev) => ({
                        ...prev,
                        [m.id]: { ...draft, h: v },
                      }))
                    }
                    keyboardType="number-pad"
                    style={styles.scoreInput}
                  />
                  <Text style={{ fontWeight: "800", color: COLORS.dim }}>-</Text>
                  <TextInput
                    value={draft.a}
                    onChangeText={(v) =>
                      setScoreDrafts((prev) => ({
                        ...prev,
                        [m.id]: { ...draft, a: v },
                      }))
                    }
                    keyboardType="number-pad"
                    style={styles.scoreInput}
                  />
                  <Pressable
                    onPress={() =>
                      runAction(
                        `force-${m.id}`,
                        {
                          action: "forceMatchFinalScore",
                          matchId: m.id,
                          homeScore: Number(draft.h || 0),
                          awayScore: Number(draft.a || 0),
                        },
                        "Score final personnalisé verrouillé"
                      )
                    }
                    style={styles.applyScoreBtn}
                  >
                    <Text style={styles.applyScoreText}>Fixer FT</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      ) : tab === "official" ? (
        <View style={styles.section}>
          {officialMatches.map((m) => (
            <View key={m.id} style={styles.itemCard}>
              <View style={styles.itemHead}>
                <Text numberOfLines={1} style={styles.itemTitle}>
                  {m.homeTeam} – {m.awayTeam}
                </Text>
                <Text style={styles.itemMeta}>
                  {m.league} ·{" "}
                  {m.status === "live"
                    ? `${m.homeScore ?? 0}-${m.awayScore ?? 0} (${m.minute ?? "LIVE"})`
                    : "À venir"}
                </Text>
              </View>
              <View style={styles.controlsRow}>
                <Pressable
                  onPress={() =>
                    runAction(
                      `sync-${m.id}`,
                      { action: "syncRealMatch", matchId: m.id },
                      "Match synchronisé avec ESPN"
                    )
                  }
                  style={styles.ctrlBtn}
                >
                  <RefreshCw size={13} color={COLORS.ink} strokeWidth={2.2} />
                  <Text style={styles.ctrlBtnText}>Sync ESPN</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    runAction(
                      `susp-${m.id}`,
                      { action: "toggleMatch", matchId: m.id },
                      "Statut des marchés basculé"
                    )
                  }
                  style={styles.ctrlBtn}
                >
                  <Text style={styles.ctrlBtnText}>Suspendre / Ouvrir</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : tab === "finance" ? (
        <View style={styles.section}>
          <Text style={styles.cardHeading}>
            Dépôts manuels en attente ({pendingDeposits.length})
          </Text>
          {pendingDeposits.length === 0 ? (
            <Text style={styles.mutedLine}>Aucun dépôt en attente.</Text>
          ) : (
            pendingDeposits.map((d) => (
              <View key={d.id} style={styles.itemCard}>
                <Text style={styles.itemTitle}>
                  {d.userName} · {eur(d.amount)}
                </Text>
                <Text style={styles.itemMeta}>
                  {d.provider} · Réf. {d.providerRef}
                </Text>
                <View style={styles.controlsRow}>
                  <Pressable
                    onPress={() =>
                      runAction(
                        `dep-ok-${d.id}`,
                        { action: "approveDeposit", depositId: d.id },
                        "Dépôt approuvé et crédité"
                      )
                    }
                    style={[styles.ctrlBtn, { backgroundColor: COLORS.winSoft }]}
                  >
                    <Check size={14} color={COLORS.win} strokeWidth={2.6} />
                    <Text style={[styles.ctrlBtnText, { color: COLORS.win }]}>
                      Approuver
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      runAction(
                        `dep-ko-${d.id}`,
                        { action: "rejectDeposit", depositId: d.id },
                        "Dépôt rejeté"
                      )
                    }
                    style={[
                      styles.ctrlBtn,
                      { backgroundColor: "rgba(225, 0, 20, 0.09)" },
                    ]}
                  >
                    <X size={14} color={COLORS.betclicRed} strokeWidth={2.6} />
                    <Text
                      style={[styles.ctrlBtnText, { color: COLORS.betclicRed }]}
                    >
                      Rejeter
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}

          <Text style={[styles.cardHeading, { marginTop: 8 }]}>
            Retraits en attente ({pendingWithdrawals.length})
          </Text>
          {pendingWithdrawals.length === 0 ? (
            <Text style={styles.mutedLine}>Aucun retrait en attente.</Text>
          ) : (
            pendingWithdrawals.map((w) => (
              <View key={w.id} style={styles.itemCard}>
                <Text style={styles.itemTitle}>
                  {w.userName} · {eur(w.amount)}
                </Text>
                <Text style={styles.itemMeta}>
                  {w.method} · {w.destination}
                </Text>
                <View style={styles.controlsRow}>
                  <Pressable
                    onPress={() =>
                      runAction(
                        `wd-ok-${w.id}`,
                        { action: "approveWithdrawal", withdrawalId: w.id },
                        "Retrait approuvé"
                      )
                    }
                    style={[styles.ctrlBtn, { backgroundColor: COLORS.winSoft }]}
                  >
                    <Check size={14} color={COLORS.win} strokeWidth={2.6} />
                    <Text style={[styles.ctrlBtnText, { color: COLORS.win }]}>
                      Valider
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      runAction(
                        `wd-ko-${w.id}`,
                        { action: "rejectWithdrawal", withdrawalId: w.id },
                        "Retrait rejeté et recrédité"
                      )
                    }
                    style={[
                      styles.ctrlBtn,
                      { backgroundColor: "rgba(225, 0, 20, 0.09)" },
                    ]}
                  >
                    <X size={14} color={COLORS.betclicRed} strokeWidth={2.6} />
                    <Text
                      style={[styles.ctrlBtnText, { color: COLORS.betclicRed }]}
                    >
                      Rejeter
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>
      ) : (
        <View style={styles.section}>
          {(panel?.users ?? []).map((u) => {
            const val =
              balanceDrafts[u.id] ?? u.balance.toFixed(2).replace(".", ",");
            return (
              <View key={u.id} style={styles.itemCard}>
                <View style={styles.itemHead}>
                  <Text style={styles.itemTitle}>
                    {u.name} {u.role === "admin" ? "· Admin" : ""}
                  </Text>
                  <Text style={styles.itemMeta}>{eur(u.balance)}</Text>
                </View>
                <View style={styles.forceScoreRow}>
                  <TextInput
                    value={val}
                    onChangeText={(next) =>
                      setBalanceDrafts((prev) => ({ ...prev, [u.id]: next }))
                    }
                    keyboardType="decimal-pad"
                    style={[styles.scoreInput, { flex: 1 }]}
                  />
                  <Pressable
                    onPress={() =>
                      runAction(
                        `bal-${u.id}`,
                        { action: "setBalance", userId: u.id, amount: val },
                        `Solde de ${u.name} mis à jour`
                      )
                    }
                    style={styles.applyScoreBtn}
                  >
                    <Text style={styles.applyScoreText}>Définir solde</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: COLORS.deep },
  content: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 28, gap: 12 },
  headerCard: {
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 14,
    gap: 12,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  pageTitle: { fontSize: 16.5, fontWeight: "800", color: COLORS.ink },
  syncBtn: {
    height: 32,
    borderRadius: 9,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  syncText: { fontSize: 12, fontWeight: "700", color: COLORS.ink },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 8,
  },
  kpiCell: {
    width: "48.5%",
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    padding: 10,
    gap: 2,
  },
  kpiLabel: { fontSize: 11, fontWeight: "600", color: COLORS.dim },
  kpiVal: {
    fontSize: 15,
    fontWeight: "900",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  tabsRow: { flexDirection: "row", gap: 6 },
  tabPill: {
    flex: 1,
    height: 38,
    borderRadius: 11,
    backgroundColor: COLORS.pillDefault,
    alignItems: "center",
    justifyContent: "center",
  },
  tabPillActive: { backgroundColor: COLORS.betclicRed },
  tabText: { fontSize: 12, fontWeight: "700", color: COLORS.ink },
  tabTextActive: { color: "#ffffff" },
  loader: { paddingVertical: 36, alignItems: "center" },
  section: { gap: 10 },
  modeCard: {
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 13,
    gap: 9,
  },
  cardHeading: { fontSize: 13.5, fontWeight: "800", color: COLORS.ink },
  modeButtons: { flexDirection: "row", gap: 8 },
  modeBtn: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    padding: 10,
    gap: 2,
  },
  modeBtnActive: { backgroundColor: COLORS.outerSpace },
  modeBtnTitle: { fontSize: 12.5, fontWeight: "800", color: COLORS.ink },
  modeBtnSub: { fontSize: 10.5, color: COLORS.dim },
  itemCard: {
    borderRadius: 15,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 13,
    gap: 8,
  },
  itemHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  itemTitle: {
    fontSize: 13.5,
    fontWeight: "800",
    color: COLORS.ink,
    flex: 1,
  },
  itemMeta: { fontSize: 11.5, fontWeight: "600", color: COLORS.dim },
  forecastLine: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.betclicRed,
  },
  controlsRow: { flexDirection: "row", gap: 8 },
  ctrlBtn: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.elev,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  ctrlBtnText: { fontSize: 12, fontWeight: "700", color: COLORS.ink },
  forceScoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  scoreInput: {
    width: 48,
    height: 36,
    borderRadius: 9,
    backgroundColor: COLORS.elev,
    borderWidth: 1,
    borderColor: COLORS.edge,
    textAlign: "center",
    fontSize: 13.5,
    fontWeight: "800",
    color: COLORS.ink,
  },
  applyScoreBtn: {
    height: 36,
    borderRadius: 9,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  applyScoreText: { fontSize: 12, fontWeight: "800", color: "#ffffff" },
  mutedLine: { fontSize: 12.5, color: COLORS.dim, paddingVertical: 4 },
});
