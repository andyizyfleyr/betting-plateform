import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { RefreshCw, ShieldCheck } from "@/components/icons";
import { api } from "@/lib/api";
import { eur } from "@/lib/format";
import { useSmartPolling } from "@/lib/polling";
import { BareInfiniteSpinner } from "@/components/infinite-scroll-loader";
import { cardSurface, colors } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

interface AdminPayload {
  stats?: {
    usersCount?: number;
    totalBalance?: number;
    pendingBetsCount?: number;
    houseNetProfit?: number;
  };
  scenarioMode?: "dynamic_preview" | "prelocked";
  pendingDeposits?: Array<{
    id: number;
    userName?: string;
    provider: string;
    amount: number;
    providerRef: string;
  }>;
  pendingWithdrawals?: Array<{
    id: number;
    userName?: string;
    method: string;
    amount: number;
    destination: string;
  }>;
}

/**
 * Console mobile `/admin` permettant le pilotage complet depuis Android :
 * - KPIs globaux, bascule Mode 1 (aperçu dynamique) / Mode 2 (100 % pré-verrouillé),
 * - Synchronisation ESPN officielle et validation des dépôts / retraits en attente.
 */
export default function AdminScreen() {
  const { user, dataSaverMode, toast } = useApp();
  const [data, setData] = useState<AdminPayload | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (user?.role !== "admin") return;
    try {
      const res = (await api.admin.dashboard()) as AdminPayload;
      setData(res);
    } catch {
      // Conserve le snapshot
    }
  }, [user?.role]);

  useSmartPolling(load, 15_000, {
    enabled: user?.role === "admin",
    dataSaver: dataSaverMode,
    runImmediately: true,
  });

  const runAction = async (key: string, body: Record<string, unknown>, okTitle: string) => {
    setBusyAction(key);
    try {
      await api.admin.action(body);
      await load();
      toast({ kind: "success", title: okTitle });
    } catch (err) {
      toast({
        kind: "error",
        title: "Action refusée",
        subtitle: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  };

  if (user?.role !== "admin") {
    return (
      <View style={[styles.root, { justifyContent: "center", padding: 20 }]}>
        <View style={[cardSurface.glassCard, { padding: 20, alignItems: "center" }]}>
          <Text style={{ fontSize: 14, fontWeight: "800", color: colors.ink }}>
            Accès réservé à l&apos;administrateur.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          tintColor={colors.betclicRed}
          colors={[colors.betclicRed]}
        />
      }
    >
      <View style={styles.headerRow}>
        <ShieldCheck size={18} color={colors.betclicRed} strokeWidth={2.4} />
        <Text style={styles.pageTitle}>Pilotage Administration</Text>
      </View>

      {!data ? (
        <BareInfiniteSpinner visible />
      ) : (
        <>
          <View style={styles.kpiGrid}>
            <View style={[cardSurface.glassCard, styles.kpiCard]}>
              <Text style={styles.kpiLabel}>Joueurs</Text>
              <Text style={styles.kpiVal}>{data.stats?.usersCount ?? 0}</Text>
            </View>
            <View style={[cardSurface.glassCard, styles.kpiCard]}>
              <Text style={styles.kpiLabel}>Paris en cours</Text>
              <Text style={styles.kpiVal}>
                {data.stats?.pendingBetsCount ?? 0}
              </Text>
            </View>
            <View style={[cardSurface.glassCard, styles.kpiCard]}>
              <Text style={styles.kpiLabel}>Solde joueurs</Text>
              <Text style={styles.kpiVal}>
                {eur(data.stats?.totalBalance ?? 0)}
              </Text>
            </View>
            <View style={[cardSurface.glassCard, styles.kpiCard]}>
              <Text style={styles.kpiLabel}>Résultat net maison</Text>
              <Text style={[styles.kpiVal, { color: colors.win }]}>
                {eur(data.stats?.houseNetProfit ?? 0)}
              </Text>
            </View>
          </View>

          {/* Mode simulateur virtuel (Mode 1 vs Mode 2) */}
          <View style={[cardSurface.glassCard, styles.sectionCard]}>
            <Text style={styles.sectionTitle}>Mode des scores virtuels</Text>
            <View style={styles.modeRow}>
              {(
                [
                  { key: "dynamic_preview", label: "Mode 1 · Dynamique" },
                  { key: "prelocked", label: "Mode 2 · Pré-verrouillé" },
                ] as const
              ).map((m) => {
                const active = data.scenarioMode === m.key;
                return (
                  <Pressable
                    key={m.key}
                    onPress={() =>
                      void runAction(
                        `mode-${m.key}`,
                        { action: "set_scenario_mode", mode: m.key },
                        `Simulateur passé en ${m.label}`
                      )
                    }
                    style={[styles.modeBtn, active && styles.modeBtnActive]}
                  >
                    <Text
                      style={[
                        styles.modeBtnText,
                        active && { color: colors.white },
                      ]}
                    >
                      {m.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              disabled={busyAction === "sync-real"}
              onPress={() =>
                void runAction(
                  "sync-real",
                  { action: "discover_real_matches" },
                  "Calendrier officiel ESPN synchronisé"
                )
              }
              style={styles.syncBtn}
            >
              {busyAction === "sync-real" ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <>
                  <RefreshCw size={14} color={colors.white} strokeWidth={2.4} />
                  <Text style={styles.syncBtnText}>
                    Synchroniser les matchs officiels ESPN
                  </Text>
                </>
              )}
            </Pressable>
          </View>

          {/* Dépôts manuels en attente */}
          {(data.pendingDeposits ?? []).length > 0 && (
            <View style={[cardSurface.glassCard, styles.sectionCard]}>
              <Text style={styles.sectionTitle}>Dépôts à valider</Text>
              {(data.pendingDeposits ?? []).map((d) => (
                <View key={d.id} style={styles.queueRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.queueTitle}>
                      {eur(d.amount)} · {d.provider}
                    </Text>
                    <Text style={styles.queueSub}>
                      {d.userName ?? "Joueur"} · Réf {d.providerRef}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() =>
                      void runAction(
                        `dep-ok-${d.id}`,
                        { action: "approve_deposit", depositId: d.id },
                        "Dépôt crédité"
                      )
                    }
                    style={styles.approveBtn}
                  >
                    <Text style={styles.approveText}>Valider</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {/* Retraits en attente */}
          {(data.pendingWithdrawals ?? []).length > 0 && (
            <View style={[cardSurface.glassCard, styles.sectionCard]}>
              <Text style={styles.sectionTitle}>Retraits en attente</Text>
              {(data.pendingWithdrawals ?? []).map((w) => (
                <View key={w.id} style={styles.queueRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.queueTitle}>
                      {eur(w.amount)} · {w.method.toUpperCase()}
                    </Text>
                    <Text style={styles.queueSub}>
                      {w.userName ?? "Joueur"} · {w.destination}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() =>
                      void runAction(
                        `wd-ok-${w.id}`,
                        { action: "approve_withdrawal", withdrawalId: w.id },
                        "Retrait approuvé"
                      )
                    }
                    style={styles.approveBtn}
                  >
                    <Text style={styles.approveText}>Approuver</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.deep },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 28, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pageTitle: { fontSize: 18, fontWeight: "900", color: colors.ink },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 8,
  },
  kpiCard: { width: "48.6%", padding: 12, gap: 3 },
  kpiLabel: { fontSize: 11, fontWeight: "600", color: colors.dim },
  kpiVal: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  sectionCard: { padding: 14, gap: 10 },
  sectionTitle: { fontSize: 13.5, fontWeight: "900", color: colors.ink },
  modeRow: { flexDirection: "row", gap: 7 },
  modeBtn: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  modeBtnActive: { backgroundColor: colors.ink },
  modeBtnText: { fontSize: 11.5, fontWeight: "800", color: colors.ink },
  syncBtn: {
    height: 42,
    borderRadius: 11,
    backgroundColor: colors.betclicRed,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  syncBtnText: { fontSize: 12.5, fontWeight: "800", color: colors.white },
  queueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.edgeSoft,
  },
  queueTitle: { fontSize: 13, fontWeight: "800", color: colors.ink },
  queueSub: { fontSize: 11.5, color: colors.dim },
  approveBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: colors.win,
  },
  approveText: { fontSize: 12, fontWeight: "800", color: colors.white },
});
