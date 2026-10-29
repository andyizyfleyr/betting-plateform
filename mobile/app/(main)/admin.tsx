import React, { useCallback, useEffect, useRef, useState } from "react";
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
  BarChart3,
  Brain,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Dices,
  Eye,
  HelpCircle,
  Lock,
  Plus,
  RefreshCw,
  ShieldCheck,
  Ticket,
  Trash2,
  Trophy,
  Unlock,
  Users,
  X,
} from "lucide-react-native";
import { LiveMatchClock } from "@/components/live-match-clock";
import { AdminDisputes } from "@/components/admin-disputes";
import { AdminMonitoring } from "@/components/admin-monitoring";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import { TeamAvatar } from "@/components/team-avatar";
import { useApp } from "@/context/app-context";
import { api, ApiHttpError } from "@/lib/api";
import {
  formatEurAsCurrency,
  getCountryConfig,
  getCurrencyConfig,
} from "@/lib/countries";
import {
  eur,
  eurPivot,
  formatKickoff,
  formatOdds,
  formatPlacedAt,
  initials,
} from "@/lib/format";
import { useSmartPolling } from "@/lib/polling";
import { Redirect } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

type TabKey =
  | "dashboard"
  | "forecasts"
  | "matches"
  | "ml"
  | "questions"
  | "users"
  | "bets"
  | "deposits";

const TABS: { key: TabKey; label: string; Icon: typeof Trophy }[] = [
  { key: "dashboard", label: "Synthèse", Icon: BarChart3 },
  { key: "forecasts", label: "Scores prévus", Icon: Eye },
  { key: "matches", label: "Matchs", Icon: Trophy },
  { key: "ml", label: "IA & ML", Icon: Brain },
  { key: "questions", label: "Pronostics", Icon: HelpCircle },
  { key: "users", label: "Joueurs", Icon: Users },
  { key: "bets", label: "Paris", Icon: Ticket },
  { key: "deposits", label: "Finance", Icon: CircleDollarSign },
];

interface AdminMatchForecast {
  matchId: number;
  finalHomeScore: number;
  finalAwayScore: number;
  htHomeScore: number;
  htAwayScore: number;
  isLocked: boolean;
}

interface AdminMatchRow {
  id: number;
  sport: string;
  league: string;
  source?: string | null;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  minute: string | null;
  startsAt: string;
  oddsHome: number;
  oddsDraw: number | null;
  oddsAway: number;
  suspended: boolean;
}

interface AdminQuestionRow {
  id: number;
  question: string;
  category: string;
  oddsYes: number;
  oddsNo: number;
  options?: Array<{ key: string; label: string; odds: number }> | null;
  status: string;
  resolution?: string | null;
  resolvesAt: string;
}

interface AdminUserRow {
  id: number;
  name: string;
  email?: string | null;
  balance: number;
  role: string;
  countryCode?: string;
  currency?: string;
}

interface AdminBetRow {
  id: number;
  kind: "sport" | "prediction";
  league: string;
  homeTeam: string;
  awayTeam: string;
  question?: string | null;
  selectionLabel: string;
  odds: number;
  stake: number;
  potentialWin: number;
  status: string;
  placedAt: string;
}

interface AdminDepositRow {
  id: number;
  userId?: number;
  userName?: string;
  userCountryCode?: string;
  userCurrency?: string;
  currency?: string;
  provider: string;
  providerRef?: string;
  amount: number;
  status: string;
  createdAt: string;
}

interface AdminWithdrawalRow {
  id: number;
  userId?: number;
  userName?: string;
  userCountryCode?: string;
  userCurrency?: string;
  method: string;
  destination: string;
  amount: number;
  status: string;
  createdAt: string;
}

interface AdminMlOverview {
  models: Array<{
    key: string;
    name: string;
    algorithm: string;
    version: number;
    samplesCount: number;
    brierScore: number;
    logLoss: number;
  }>;
  playerProfiles: Array<{
    userId: number;
    name: string;
    betsCount: number;
    pSharpPct: number;
    roiPct: number;
    maxStake: number;
    topReason: string;
  }>;
}

interface AdminPanelData {
  bettingLimits?: { minStakeXof: number; maxStakeXof: number; maxPayoutXof: number; maxComboLegs: number };
  stats: {
    totalUsers: number;
    totalBets: number;
    pendingDeposits?: number;
    pendingWithdrawals?: number;
    stake: number;
    payouts: number;
    balance: number;
    liveMatches: number;
    openQuestions: number;
    netRevenue: number;
  };
  scenarioMode?: "dynamic" | "locked";
  realSettlementMode?: "auto" | "confirm";
  matchForecasts?: Record<string, AdminMatchForecast>;
  matches: AdminMatchRow[];
  questions: AdminQuestionRow[];
  users: AdminUserRow[];
  bets: AdminBetRow[];
  predictionBets: Array<{
    id: number;
    question: string;
    selectionLabel: string;
    odds: number;
    stake: number;
    potentialWin: number;
    status: string;
    placedAt: string;
  }>;
  comboBets?: Array<{
    id: number;
    legs: Array<{ title: string; selectionLabel: string }>;
    totalOdds: number;
    boostPct: number;
    stake: number;
    potentialWin: number;
    status: string;
    placedAt: string;
  }>;
  deposits: AdminDepositRow[];
  withdrawals?: AdminWithdrawalRow[];
  ml?: AdminMlOverview;
}

function MobileBettingLimits({ limits, busy, act }: {
  limits: NonNullable<AdminPanelData["bettingLimits"]>;
  busy: boolean;
  act: (payload: Record<string, unknown>, key: string, message: string) => Promise<void>;
}) {
  const [values, setValues] = useState(() => ({
    minStakeXof: String(limits.minStakeXof), maxStakeXof: String(limits.maxStakeXof),
    maxPayoutXof: String(limits.maxPayoutXof), maxComboLegs: String(limits.maxComboLegs),
  }));
  const fields = [["minStakeXof", "Mise minimale (₣)"], ["maxStakeXof", "Mise maximale (₣)"],
    ["maxPayoutXof", "Gain maximum (₣)"], ["maxComboLegs", "Sélections maximum"]] as const;
  return <View style={styles.card}>
    <Text style={styles.cardTitle}>Limites de paris</Text>
    <Text style={styles.cardSub}>Montants convertis pour les autres devises. Le gain maximum doit être au moins égal à la mise maximale.</Text>
    {fields.map(([key, label]) => <View key={key} style={{ marginTop: 8 }}>
      <Text style={styles.cardSub}>{label}</Text>
      <TextInput keyboardType="number-pad" value={values[key]} onChangeText={(text) => setValues((v) => ({ ...v, [key]: text }))}
        style={{ borderWidth: 1, borderColor: COLORS.edge, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, color: COLORS.ink }} />
    </View>)}
    <Pressable disabled={busy} onPress={() => void act({ action: "setBettingLimits", limits: values }, "bettingLimits", "Limites enregistrées")}
      style={{ marginTop: 10, backgroundColor: COLORS.betclicRed, padding: 10, borderRadius: 8, opacity: busy ? 0.5 : 1 }}>
      <Text style={{ color: "white", textAlign: "center" }}>Enregistrer</Text>
    </Pressable>
  </View>;
}

export default function AdminScreen() {
  const {
    user,
    authReady,
    sessionRestoring,
    dataSaverMode,
    setAdminPendingFinance,
  } = useApp();

  const [panel, setPanel] = useState<AdminPanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: "ok" | "err";
    msg: string;
  } | null>(null);

  const [scoreDrafts, setScoreDrafts] = useState<
    Record<number, { h: string; a: string }>
  >({});
  const [balanceDrafts, setBalanceDrafts] = useState<Record<number, string>>(
    {}
  );

  // Formulaire ajout match réel
  const [mHome, setMHome] = useState("");
  const [mAway, setMAway] = useState("");
  const [mLeague, setMLeague] = useState("Premier League");
  const [mO1, setMO1] = useState("1.90");
  const [mOX, setMOX] = useState("3.30");
  const [mO2, setMO2] = useState("3.10");

  // Formulaire ajout pronostic
  const [qText, setQText] = useState("");
  const [qCat, setQCat] = useState("Sport");
  const [qYes, setQYes] = useState("1.90");
  const [qNo, setQNo] = useState("1.80");

  const mutatingRef = useRef(0);

  const load = useCallback(
    async (isBackground = false) => {
      if (user?.role !== "admin") return;
      if (isBackground && mutatingRef.current > 0) return;
      try {
        const data = (await api.admin.panel()) as unknown as AdminPanelData;
        setPanel(data);
        setAdminPendingFinance(
          (data.stats?.pendingWithdrawals ?? 0) +
            (data.stats?.pendingDeposits ?? 0)
        );
      } catch (e) {
        if (!isBackground) {
          setNotice({
            kind: "err",
            msg:
              e instanceof Error
                ? e.message
                : "Impossible de charger le tableau de bord",
          });
        }
      } finally {
        setLoading(false);
      }
    },
    [setAdminPendingFinance, user?.role]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useSmartPolling(() => load(true), 5_000, {
    enabled: user?.role === "admin",
    dataSaver: dataSaverMode,
    runImmediately: false,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(false);
    setRefreshing(false);
  }, [load]);

  if (authReady && !sessionRestoring && (!user || user.role !== "admin")) {
    return <Redirect href="/matchs" />;
  }

  const act = async (
    payload: Record<string, unknown>,
    key: string,
    okMsg: string
  ) => {
    mutatingRef.current += 1;
    setBusyKey(key);
    setNotice(null);
    try {
      await api.admin.action(payload);
      setNotice({ kind: "ok", msg: okMsg });
      await load(false);
    } catch (e) {
      setNotice({
        kind: "err",
        msg:
          e instanceof ApiHttpError || e instanceof Error
            ? e.message
            : "Erreur lors de l'action",
      });
    } finally {
      mutatingRef.current = Math.max(0, mutatingRef.current - 1);
      setBusyKey(null);
    }
  };

  const pendingFinanceCount =
    (panel?.stats?.pendingWithdrawals ?? 0) +
    (panel?.stats?.pendingDeposits ?? 0);

  const virtualActive = (panel?.matches ?? []).filter(
    (m) => m.source !== "manual" && m.status !== "finished"
  );
  const officialActive = (panel?.matches ?? []).filter(
    (m) => m.source === "manual" && m.status !== "finished"
  );

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      stickyHeaderIndices={[2]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[COLORS.betclicRed]}
          tintColor={COLORS.betclicRed}
        />
      }
    >
      {/* 0 : En-tête identique à src/app/(main)/admin/page.tsx */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.pageTitle}>Administration</Text>
          <Text style={styles.pageSub}>
            Pilotage des matchs, pronostics et joueurs
          </Text>
        </View>

        <Pressable onPress={() => void load(false)} style={styles.refreshPill}>
          <RefreshCw size={14} color={COLORS.ink} strokeWidth={2.3} />
          <Text style={styles.refreshPillText}>Actualiser</Text>
        </Pressable>
      </View>

      {/* 1 : Bannière de notification */}
      <View>
        {notice ? (
          <View
            style={[
              styles.noticeBar,
              notice.kind === "ok" ? styles.noticeOk : styles.noticeErr,
            ]}
          >
            {notice.kind === "ok" ? (
              <CheckCircle2 size={16} color={COLORS.win} strokeWidth={2.3} />
            ) : (
              <X size={16} color={COLORS.betclicRed} strokeWidth={2.3} />
            )}
            <Text
              style={[
                styles.noticeText,
                {
                  color: notice.kind === "ok" ? COLORS.win : COLORS.betclicRed,
                },
              ]}
            >
              {notice.msg}
            </Text>
            <Pressable hitSlop={8} onPress={() => setNotice(null)}>
              <X
                size={14}
                color={notice.kind === "ok" ? COLORS.win : COLORS.betclicRed}
                strokeWidth={2.2}
              />
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* 2 : Onglets collants mobiles (8 pastilles identiques à TABS de src/app/(main)/admin/page.tsx) */}
      <View style={styles.stickyTabsWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsRow}
        >
          {TABS.map(({ key, label, Icon }) => {
            const active = tab === key;
            const badge = key === "deposits" ? pendingFinanceCount : 0;
            return (
              <Pressable
                key={key}
                onPress={() => setTab(key)}
                style={[styles.tabPill, active && styles.tabPillActive]}
              >
                <Icon
                  size={14}
                  color={active ? "#ffffff" : COLORS.mist}
                  strokeWidth={2.2}
                />
                <Text
                  style={[
                    styles.tabPillLabel,
                    active && styles.tabPillLabelActive,
                  ]}
                >
                  {label}
                </Text>
                {badge > 0 ? (
                  <View style={styles.redCountBadge}>
                    <Text style={styles.redCountBadgeText}>{badge}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* 3 : Contenu de l'onglet actif */}
      {loading || !authReady || sessionRestoring ? (
        <PulseFlashLoader compact />
      ) : !panel ? (
        <View
          style={{
            marginTop: 16,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: COLORS.edge,
            backgroundColor: "#ffffff",
            padding: 16,
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 11.5, fontWeight: "500", color: COLORS.ink }}>
            Tableau de bord indisponible
          </Text>
          <Text
            style={{
              marginTop: 4,
              fontSize: 10.5,
              fontWeight: "400",
              color: COLORS.mist,
              textAlign: "center",
            }}
          >
            {notice?.msg ?? "Impossible de charger les données d'administration."}
          </Text>
          <Pressable
            onPress={() => {
              setLoading(true);
              void load(false);
            }}
            style={({ pressed }) => [
              {
                marginTop: 12,
                height: 34,
                paddingHorizontal: 14,
                borderRadius: 10,
                backgroundColor: COLORS.betclicRed,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
              },
              pressed && { opacity: 0.9 },
            ]}
          >
            <RefreshCw size={13} color="#ffffff" strokeWidth={2.2} />
            <Text style={{ fontSize: 10.5, fontWeight: "500", color: "#ffffff" }}>
              Réessayer
            </Text>
          </Pressable>
        </View>
      ) : tab === "dashboard" ? (
        <View style={styles.stack}>
          <View style={styles.statsGrid}>
            {[
              { label: "Joueurs", value: String(panel.stats.totalUsers) },
              {
                label: "Matchs live",
                value: String(panel.stats.liveMatches),
                accent: panel.stats.liveMatches > 0,
              },
              {
                label: "Pronostics ouverts",
                value: String(panel.stats.openQuestions),
              },
              { label: "Coupons totaux", value: String(panel.stats.totalBets) },
              { label: "Volume misé", value: eur(panel.stats.stake ?? 0) },
              {
                label: "Gains payés",
                value: eur(panel.stats.payouts ?? 0),
              },
              {
                label: "Produit net (GGR)",
                value: eur(
                  panel.stats.netRevenue ??
                    (panel.stats.stake ?? 0) - (panel.stats.payouts ?? 0)
                ),
                win: true,
              },
              {
                label: "Solde cumulé joueurs",
                value: eur(panel.stats.balance ?? 0),
              },
            ].map((c) => (
              <View key={c.label} style={styles.statCard}>
                <Text style={styles.statLabel}>{c.label}</Text>
                <Text
                  style={[
                    styles.statValue,
                    c.accent && { color: COLORS.betclicRed },
                    c.win && { color: COLORS.win },
                  ]}
                >
                  {c.value}
                </Text>
              </View>
            ))}
          </View>
          <AdminMonitoring />
            <AdminDisputes />
          {panel.bettingLimits && <MobileBettingLimits key={JSON.stringify(panel.bettingLimits)} limits={panel.bettingLimits} busy={busyKey === "bettingLimits"} act={act} />}
        </View>
      ) : tab === "forecasts" ? (
        <View style={styles.stack}>
          {/* Sélecteur Mode 1 (Dynamique) vs Mode 2 (100% Verrouillé) */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Mode de pilotage des scénarios virtuels
            </Text>
            <Text style={styles.cardSub}>
              Mode 1 : aperçu dynamique avec verrouillage manuel. Mode 2 : 100 %
              des scores pré-verrouillés d&apos;avance.
            </Text>
            <View style={styles.modeGrid}>
              {(
                [
                  { id: "dynamic", label: "Mode 1 · Dynamique" },
                  { id: "locked", label: "Mode 2 · 100 % Verrouillé" },
                ] as const
              ).map((m) => {
                const active = (panel.scenarioMode ?? "dynamic") === m.id;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() =>
                      void act(
                        { action: "setScenarioMode", mode: m.id },
                        `mode-${m.id}`,
                        `Mode ${m.label} activé`
                      )
                    }
                    style={[
                      styles.modeBtn,
                      active && styles.modeBtnActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.modeBtnText,
                        active && { color: "#ffffff" },
                      ]}
                    >
                      {m.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {virtualActive.map((m) => {
            const fc = panel.matchForecasts?.[String(m.id)];
            const draft = scoreDrafts[m.id] ?? {
              h: String(fc?.finalHomeScore ?? 1),
              a: String(fc?.finalAwayScore ?? 0),
            };
            const isLocked = Boolean(fc?.isLocked);

            return (
              <View key={m.id} style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text numberOfLines={1} style={styles.leagueMeta}>
                    {m.league} ·{" "}
                    {m.status === "live" ? (
                      <LiveMatchClock
                        match={m}
                        fallback={m.minute ?? "LIVE"}
                        prefix="Direct "
                        style={styles.leagueMeta}
                      />
                    ) : (
                      formatKickoff(m.startsAt)
                    )}
                  </Text>
                  <View
                    style={[
                      styles.lockBadge,
                      isLocked ? styles.lockBadgeOn : styles.lockBadgeOff,
                    ]}
                  >
                    {isLocked ? (
                      <Lock size={11} color="#ffffff" strokeWidth={2.4} />
                    ) : (
                      <Unlock size={11} color={COLORS.mist} strokeWidth={2.4} />
                    )}
                    <Text
                      style={[
                        styles.lockBadgeText,
                        isLocked && { color: "#ffffff" },
                      ]}
                    >
                      {isLocked ? "Verrouillé" : "Dynamique"}
                    </Text>
                  </View>
                </View>

                <Text style={styles.matchTeamsTitle}>
                  {m.homeTeam} vs {m.awayTeam}
                </Text>

                <View style={styles.forecastSummaryRow}>
                  <Text style={styles.forecastSummaryLabel}>
                    Score final prévu :{" "}
                    <Text style={styles.forecastSummaryStrong}>
                      {fc ? `${fc.finalHomeScore} - ${fc.finalAwayScore}` : "—"}
                    </Text>
                    {fc ? ` (MT ${fc.htHomeScore}-${fc.htAwayScore})` : ""}
                  </Text>
                </View>

                <View style={styles.forecastControlsRow}>
                  <TextInput
                    value={draft.h}
                    onChangeText={(v) =>
                      setScoreDrafts((s) => ({
                        ...s,
                        [m.id]: { ...draft, h: v.replace(/[^0-9]/g, "") },
                      }))
                    }
                    keyboardType="number-pad"
                    style={styles.scoreInput}
                  />
                  <Text style={{ fontWeight: "500", color: COLORS.dim }}>-</Text>
                  <TextInput
                    value={draft.a}
                    onChangeText={(v) =>
                      setScoreDrafts((s) => ({
                        ...s,
                        [m.id]: { ...draft, a: v.replace(/[^0-9]/g, "") },
                      }))
                    }
                    keyboardType="number-pad"
                    style={styles.scoreInput}
                  />

                  <Pressable
                    disabled={busyKey === `force-${m.id}`}
                    onPress={() =>
                      void act(
                        {
                          action: "forceMatchFinalScore",
                          matchId: m.id,
                          homeScore: Number(draft.h || 0),
                          awayScore: Number(draft.a || 0),
                        },
                        `force-${m.id}`,
                        "Score final personnalisé verrouillé"
                      )
                    }
                    style={styles.smallRedBtn}
                  >
                    <Text style={styles.smallRedBtnText}>Imposer</Text>
                  </Pressable>

                  <Pressable
                    onPress={() =>
                      void act(
                        {
                          action: isLocked
                            ? "unlockMatchScenario"
                            : "lockMatchScenario",
                          matchId: m.id,
                        },
                        `lock-${m.id}`,
                        isLocked ? "Scénario déverrouillé" : "Scénario verrouillé"
                      )
                    }
                    style={styles.iconBtn}
                  >
                    {isLocked ? (
                      <Unlock size={14} color={COLORS.ink} strokeWidth={2.2} />
                    ) : (
                      <Lock size={14} color={COLORS.ink} strokeWidth={2.2} />
                    )}
                  </Pressable>

                  <Pressable
                    onPress={() =>
                      void act(
                        { action: "rerollMatchScenario", matchId: m.id },
                        `reroll-${m.id}`,
                        "Nouveau scénario tiré"
                      )
                    }
                    style={styles.iconBtn}
                  >
                    <Dices size={14} color={COLORS.ink} strokeWidth={2.2} />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      ) : tab === "matches" ? (
        <View style={styles.stack}>
          {/* Synchronisation ESPN + ajout match réel */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>Rencontres officielles</Text>
              <Pressable
                disabled={busyKey === "sync-real"}
                onPress={() =>
                  void act(
                    { action: "syncRealMatches" },
                    "sync-real",
                    "Flux officiel synchronisé"
                  )
                }
                style={styles.smallDarkBtn}
              >
                <RefreshCw size={12} color="#ffffff" strokeWidth={2.3} />
                <Text style={styles.smallDarkBtnText}>Sync ESPN</Text>
              </Pressable>
            </View>

            <View style={{ marginTop: 10, gap: 8 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput
                  value={mHome}
                  onChangeText={setMHome}
                  placeholder="Équipe domicile"
                  placeholderTextColor={COLORS.dim}
                  style={[styles.textField, { flex: 1 }]}
                />
                <TextInput
                  value={mAway}
                  onChangeText={setMAway}
                  placeholder="Équipe extérieur"
                  placeholderTextColor={COLORS.dim}
                  style={[styles.textField, { flex: 1 }]}
                />
              </View>
              <TextInput
                value={mLeague}
                onChangeText={setMLeague}
                placeholder="Compétition (ex. Ligue 1)"
                placeholderTextColor={COLORS.dim}
                style={styles.textField}
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput
                  value={mO1}
                  onChangeText={setMO1}
                  keyboardType="decimal-pad"
                  placeholder="Cote 1"
                  placeholderTextColor={COLORS.dim}
                  style={[styles.textField, { flex: 1 }]}
                />
                <TextInput
                  value={mOX}
                  onChangeText={setMOX}
                  keyboardType="decimal-pad"
                  placeholder="Cote N"
                  placeholderTextColor={COLORS.dim}
                  style={[styles.textField, { flex: 1 }]}
                />
                <TextInput
                  value={mO2}
                  onChangeText={setMO2}
                  keyboardType="decimal-pad"
                  placeholder="Cote 2"
                  placeholderTextColor={COLORS.dim}
                  style={[styles.textField, { flex: 1 }]}
                />
              </View>
              <Pressable
                disabled={!mHome.trim() || !mAway.trim()}
                onPress={async () => {
                  await act(
                    {
                      action: "addMatch",
                      home: mHome.trim(),
                      away: mAway.trim(),
                      league: mLeague.trim() || "Premier League",
                      oddsHome: Number(mO1.replace(",", ".")),
                      oddsDraw: Number(mOX.replace(",", ".")),
                      oddsAway: Number(mO2.replace(",", ".")),
                      status: "upcoming",
                    },
                    "add-match",
                    "Match réel publié"
                  );
                  setMHome("");
                  setMAway("");
                }}
                style={[
                  styles.fullRedBtn,
                  (!mHome.trim() || !mAway.trim()) && { opacity: 0.45 },
                ]}
              >
                <Plus size={15} color="#ffffff" strokeWidth={2.5} />
                <Text style={styles.fullRedBtnText}>Publier le match</Text>
              </Pressable>
            </View>
          </View>

          {officialActive.map((m) => (
            <View key={m.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text numberOfLines={1} style={styles.leagueMeta}>
                  {m.league} · {m.status.toUpperCase()}
                </Text>
                <Pressable
                  onPress={() =>
                    void act(
                      { action: "deleteMatch", matchId: m.id },
                      `del-${m.id}`,
                      "Match supprimé"
                    )
                  }
                >
                  <Trash2 size={14} color={COLORS.betclicRed} strokeWidth={2.2} />
                </Pressable>
              </View>

              <View style={styles.adminTeamsRow}>
                <View style={styles.adminTeamItem}>
                  <TeamAvatar name={m.homeTeam} logo={m.homeLogo} size="xs" />
                  <Text numberOfLines={1} style={styles.adminTeamText}>
                    {m.homeTeam}
                  </Text>
                </View>
                <Text style={styles.adminScoreBadge}>
                  {m.homeScore ?? 0} - {m.awayScore ?? 0}
                </Text>
                <View style={[styles.adminTeamItem, { justifyContent: "flex-end" }]}>
                  <Text numberOfLines={1} style={styles.adminTeamText}>
                    {m.awayTeam}
                  </Text>
                  <TeamAvatar name={m.awayTeam} logo={m.awayLogo} size="xs" />
                </View>
              </View>

              <View style={styles.matchActionsRow}>
                {m.status === "upcoming" ? (
                  <Pressable
                    onPress={() =>
                      void act(
                        { action: "startMatch", matchId: m.id },
                        `start-${m.id}`,
                        "Match passé en direct"
                      )
                    }
                    style={styles.smallDarkBtn}
                  >
                    <Text style={styles.smallDarkBtnText}>Lancer LIVE</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() =>
                    void act(
                      {
                        action: "goal",
                        matchId: m.id,
                        team: "home",
                      },
                      `gh-${m.id}`,
                      `But ${m.homeTeam}`
                    )
                  }
                  style={styles.grayActionChip}
                >
                  <Text style={styles.grayActionText}>+1 Dom.</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    void act(
                      {
                        action: "goal",
                        matchId: m.id,
                        team: "away",
                      },
                      `ga-${m.id}`,
                      `But ${m.awayTeam}`
                    )
                  }
                  style={styles.grayActionChip}
                >
                  <Text style={styles.grayActionText}>+1 Ext.</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    void act(
                      { action: "finishMatch", matchId: m.id },
                      `fin-${m.id}`,
                      "Match terminé et paris réglés"
                    )
                  }
                  style={styles.smallRedBtn}
                >
                  <Text style={styles.smallRedBtnText}>Terminer</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : tab === "ml" ? (
        <View style={styles.stack}>
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Moteur IA & Calibration</Text>
                <Text style={styles.cardSub}>
                  Modèles bayésiens, détection sharp et calibration des marges
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  void act(
                    { action: "retrainMl" },
                    "retrain-ml",
                    "Modèles IA recalibrés"
                  )
                }
                style={styles.smallRedBtn}
              >
                <Text style={styles.smallRedBtnText}>Recalibrer</Text>
              </Pressable>
            </View>
          </View>

          {(panel.ml?.models ?? []).map((m) => (
            <View key={m.key} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>{m.name}</Text>
                <Text style={styles.leagueMeta}>v{m.version}</Text>
              </View>
              <Text style={styles.cardSub}>
                {m.algorithm} · {m.samplesCount} éch. · Brier{" "}
                {m.brierScore.toFixed(3)} · LogLoss {m.logLoss.toFixed(3)}
              </Text>
            </View>
          ))}

          {(panel.ml?.playerProfiles ?? []).slice(0, 10).map((p) => (
            <View key={p.userId} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>{p.name}</Text>
                <Text
                  style={[
                    styles.leagueMeta,
                    {
                      color:
                        p.pSharpPct >= 65 ? COLORS.betclicRed : COLORS.win,
                    },
                  ]}
                >
                  Sharp {p.pSharpPct}%
                </Text>
              </View>
              <Text style={styles.cardSub}>
                {p.betsCount} paris · ROI {p.roiPct}% · Plafond {eur(p.maxStake)}
              </Text>
            </View>
          ))}
        </View>
      ) : tab === "questions" ? (
        <View style={styles.stack}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Nouveau pronostic Oui / Non</Text>
            <View style={{ marginTop: 8, gap: 8 }}>
              <TextInput
                value={qText}
                onChangeText={setQText}
                placeholder="Intitulé de la question…"
                placeholderTextColor={COLORS.dim}
                style={styles.textField}
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput
                  value={qCat}
                  onChangeText={setQCat}
                  placeholder="Sport / Actus / Crypto / Culture"
                  placeholderTextColor={COLORS.dim}
                  style={[styles.textField, { flex: 1.4 }]}
                />
                <TextInput
                  value={qYes}
                  onChangeText={setQYes}
                  keyboardType="decimal-pad"
                  placeholder="Oui"
                  placeholderTextColor={COLORS.dim}
                  style={[styles.textField, { flex: 1 }]}
                />
                <TextInput
                  value={qNo}
                  onChangeText={setQNo}
                  keyboardType="decimal-pad"
                  placeholder="Non"
                  placeholderTextColor={COLORS.dim}
                  style={[styles.textField, { flex: 1 }]}
                />
              </View>
              <Pressable
                disabled={!qText.trim()}
                onPress={async () => {
                  await act(
                    {
                      action: "addQuestion",
                      mode: "binary",
                      question: qText.trim(),
                      category: qCat.trim() || "Sport",
                      oddsYes: Number(qYes.replace(",", ".")),
                      oddsNo: Number(qNo.replace(",", ".")),
                      resolvesAt: 72,
                    },
                    "add-q",
                    "Pronostic publié"
                  );
                  setQText("");
                }}
                style={[styles.fullRedBtn, !qText.trim() && { opacity: 0.45 }]}
              >
                <Plus size={15} color="#ffffff" strokeWidth={2.5} />
                <Text style={styles.fullRedBtnText}>Publier le pronostic</Text>
              </Pressable>
            </View>
          </View>

          {panel.questions
            .filter((q) => q.status === "open")
            .map((q) => (
              <View key={q.id} style={styles.card}>
                <Text style={styles.leagueMeta}>{q.category}</Text>
                <Text style={[styles.cardTitle, { marginTop: 4 }]}>
                  {q.question}
                </Text>

                {Array.isArray(q.options) && q.options.length >= 2 ? (
                  <View style={styles.resolveWrap}>
                    {q.options.map((opt) => (
                      <Pressable
                        key={opt.key}
                        onPress={() =>
                          void act(
                            {
                              action: "resolveQuestion",
                              questionId: q.id,
                              outcome: opt.key,
                            },
                            `rq-${q.id}-${opt.key}`,
                            `Résolu : ${opt.label}`
                          )
                        }
                        style={styles.grayActionChip}
                      >
                        <Text style={styles.grayActionText}>
                          ✓ {opt.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <View style={styles.resolveWrap}>
                    <Pressable
                      onPress={() =>
                        void act(
                          {
                            action: "resolveQuestion",
                            questionId: q.id,
                            outcome: "yes",
                          },
                          `rq-${q.id}-yes`,
                          "Résolu : OUI"
                        )
                      }
                      style={styles.winActionChip}
                    >
                      <Text style={styles.winActionText}>
                        Résoudre OUI ({formatOdds(q.oddsYes, "decimal")})
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        void act(
                          {
                            action: "resolveQuestion",
                            questionId: q.id,
                            outcome: "no",
                          },
                          `rq-${q.id}-no`,
                          "Résolu : NON"
                        )
                      }
                      style={styles.smallRedBtn}
                    >
                      <Text style={styles.smallRedBtnText}>
                        Résoudre NON ({formatOdds(q.oddsNo, "decimal")})
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
        </View>
      ) : tab === "users" ? (
        <View style={styles.stack}>
          {panel.users.map((u) => {
            const draft = balanceDrafts[u.id] ?? String(u.balance);
            const uCountry = getCountryConfig(u.countryCode);
            const uCur = getCurrencyConfig(u.currency ?? uCountry.currency).code;
            return (
              <View key={u.id} style={styles.card}>
                <View style={styles.rowBetween}>
                  <View style={styles.userLeft}>
                    <View style={styles.userInitialCircle}>
                      <Text style={styles.userInitialText}>
                        {initials(u.name)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={styles.cardTitle}>
                        {u.name}
                      </Text>
                      <Text numberOfLines={1} style={styles.cardSub}>
                        {uCountry.flag} {uCountry.code} · {uCur} · {u.email ?? "—"} · {u.role}
                      </Text>
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.userBalText}>{eurPivot(u.balance)}</Text>
                    {uCur !== "EUR" ? (
                      <Text style={styles.cardSub}>
                        ≈ {formatEurAsCurrency(u.balance, uCur)}
                      </Text>
                    ) : null}
                  </View>
                </View>

                <View style={[styles.forecastControlsRow, { marginTop: 10 }]}>
                  <TextInput
                    value={draft}
                    onChangeText={(v) =>
                      setBalanceDrafts((s) => ({ ...s, [u.id]: v }))
                    }
                    keyboardType="decimal-pad"
                    style={[styles.textField, { flex: 1, height: 36 }]}
                  />
                  <Pressable
                    onPress={() => {
                      const nextAmt = Number(draft.replace(",", "."));
                      void act(
                        {
                          action: "setBalance",
                          userId: u.id,
                          amount: nextAmt,
                          balance: nextAmt,
                        },
                        `bal-${u.id}`,
                        `Solde de ${u.name} mis à jour`
                      );
                    }}
                    style={styles.smallDarkBtn}
                  >
                    <Text style={styles.smallDarkBtnText}>Définir</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      ) : tab === "bets" ? (
        <View style={styles.stack}>
          {(panel.comboBets ?? []).slice(0, 15).map((cb) => (
            <View key={`c-${cb.id}`} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.leagueMeta}>
                  COMBINÉ #{cb.id} · {cb.legs.length} sél.
                </Text>
                <Text style={styles.leagueMeta}>{cb.status.toUpperCase()}</Text>
              </View>
              <Text style={[styles.cardTitle, { marginTop: 4 }]}>
                Mise {eur(cb.stake)} · Cote {cb.totalOdds.toFixed(2)} →{" "}
                {eur(cb.potentialWin)}
              </Text>
              <Text style={styles.cardSub}>{formatPlacedAt(cb.placedAt)}</Text>
            </View>
          ))}

          {panel.bets.slice(0, 25).map((b) => (
            <View key={`b-${b.id}`} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text numberOfLines={1} style={styles.leagueMeta}>
                  {b.league}
                </Text>
                <Text style={styles.leagueMeta}>{b.status.toUpperCase()}</Text>
              </View>
              <Text style={[styles.cardTitle, { marginTop: 4 }]}>
                {b.homeTeam} – {b.awayTeam}
              </Text>
              <Text style={styles.cardSub}>
                {b.selectionLabel} @ {b.odds.toFixed(2)} · Mise {eur(b.stake)} →{" "}
                {eur(b.potentialWin)}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.stack}>
          {/* Retraits */}
          <Text style={styles.sectionCaps}>DEMANDES DE RETRAIT</Text>
          {(panel.withdrawals ?? []).length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardSub}>Aucun retrait enregistré.</Text>
            </View>
          ) : (
            (panel.withdrawals ?? []).map((w) => {
              const wCountry = getCountryConfig(w.userCountryCode);
              const wCur = getCurrencyConfig(w.userCurrency ?? wCountry.currency).code;
              const localLabel =
                wCur !== "EUR"
                  ? `${formatEurAsCurrency(w.amount, wCur)} (${eurPivot(w.amount)})`
                  : eurPivot(w.amount);
              return (
              <View key={`w-${w.id}`} style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>
                    {wCountry.flag} {w.userName ?? `Joueur #${w.userId}`} · {localLabel}
                  </Text>
                  <Text style={styles.leagueMeta}>
                    {w.status.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.cardSub}>
                  {w.method} · {w.destination} · {formatPlacedAt(w.createdAt)}
                </Text>
                {w.status === "pending" ? (
                  <View style={[styles.resolveWrap, { marginTop: 8 }]}>
                    <Pressable
                      onPress={() =>
                        void act(
                          {
                            action: "approveWithdrawal",
                            withdrawalId: w.id,
                          },
                          `aw-${w.id}`,
                          "Retrait validé"
                        )
                      }
                      style={styles.winActionChip}
                    >
                      <Check size={13} color="#ffffff" strokeWidth={2.6} />
                      <Text style={styles.winActionText}>Approuver</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        void act(
                          {
                            action: "rejectWithdrawal",
                            withdrawalId: w.id,
                          },
                          `rw-${w.id}`,
                          "Retrait refusé et recrédité"
                        )
                      }
                      style={styles.smallRedBtn}
                    >
                      <X size={13} color="#ffffff" strokeWidth={2.6} />
                      <Text style={styles.smallRedBtnText}>Refuser</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
              );
            })
          )}

          {/* Dépôts */}
          <Text style={[styles.sectionCaps, { marginTop: 8 }]}>DÉPÔTS</Text>
          {panel.deposits.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardSub}>Aucun dépôt enregistré.</Text>
            </View>
          ) : (
            panel.deposits.map((d) => {
              const dCountry = getCountryConfig(d.userCountryCode);
              const dCur = getCurrencyConfig(
                d.userCurrency ?? d.currency ?? dCountry.currency
              ).code;
              const localLabel =
                dCur !== "EUR"
                  ? `${formatEurAsCurrency(d.amount, dCur)} (${eurPivot(d.amount)})`
                  : eurPivot(d.amount);
              return (
              <View key={`d-${d.id}`} style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>
                    {dCountry.flag} {d.userName ?? `Joueur #${d.userId}`} · {localLabel}
                  </Text>
                  <Text style={styles.leagueMeta}>
                    {d.status.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.cardSub}>
                  {d.provider} · {d.providerRef ?? "—"} ·{" "}
                  {formatPlacedAt(d.createdAt)}
                </Text>
                {d.status === "pending" || d.status === "pending_review" ? (
                  <View style={[styles.resolveWrap, { marginTop: 8 }]}>
                    <Pressable
                      onPress={() =>
                        void act(
                          { action: "approveDeposit", depositId: d.id },
                          `ad-${d.id}`,
                          "Dépôt crédité"
                        )
                      }
                      style={styles.winActionChip}
                    >
                      <Check size={13} color="#ffffff" strokeWidth={2.6} />
                      <Text style={styles.winActionText}>Créditer</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        void act(
                          { action: "rejectDeposit", depositId: d.id },
                          `rd-${d.id}`,
                          "Dépôt refusé"
                        )
                      }
                      style={styles.smallRedBtn}
                    >
                      <X size={13} color="#ffffff" strokeWidth={2.6} />
                      <Text style={styles.smallRedBtnText}>Rejeter</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
              );
            })
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: COLORS.deep,
  },
  content: {
    paddingHorizontal: 8,
    paddingTop: 16,
    paddingBottom: 36,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  pageTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: COLORS.ink,
  },
  pageSub: {
    fontSize: 10.5,
    color: COLORS.mist,
  },
  refreshPill: {
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  refreshPillText: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.ink,
  },
  noticeBar: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  noticeOk: {
    borderColor: "rgba(21,128,61,0.30)",
    backgroundColor: "rgba(21,128,61,0.10)",
  },
  noticeErr: {
    borderColor: "rgba(225,0,20,0.30)",
    backgroundColor: "rgba(225,0,20,0.08)",
  },
  noticeText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "500",
  },
  stickyTabsWrap: {
    marginHorizontal: -8,
    marginTop: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(229,231,235,0.75)",
    backgroundColor: "rgba(244,245,247,0.96)",
    paddingVertical: 8,
  },
  tabsRow: {
    paddingHorizontal: 8,
    flexDirection: "row",
    gap: 6,
  },
  tabPill: {
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tabPillActive: {
    borderColor: COLORS.ink,
    backgroundColor: COLORS.ink,
  },
  tabPillLabel: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.mist,
  },
  tabPillLabelActive: {
    fontWeight: "500",
    color: "#ffffff",
  },
  redCountBadge: {
    borderRadius: 999,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  redCountBadgeText: {
    fontSize: 9.5,
    fontWeight: "500",
    color: "#ffffff",
  },
  loaderBox: {
    paddingVertical: 48,
    alignItems: "center",
  },
  stack: {
    marginTop: 12,
    gap: 10,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statCard: {
    width: "48.6%",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 12,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.mist,
  },
  statValue: {
    marginTop: 4,
    fontSize: 13.5,
    fontWeight: "500",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 12,
  },
  cardTitle: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  cardSub: {
    marginTop: 2,
    fontSize: 10.5,
    color: COLORS.mist,
    lineHeight: 16,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  leagueMeta: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.dim,
  },
  modeGrid: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  modeBtn: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  modeBtnActive: {
    borderColor: COLORS.ink,
    backgroundColor: COLORS.ink,
  },
  modeBtnText: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.ink,
  },
  lockBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  lockBadgeOn: {
    backgroundColor: COLORS.ink,
  },
  lockBadgeOff: {
    backgroundColor: COLORS.elev,
  },
  lockBadgeText: {
    fontSize: 9.5,
    fontWeight: "500",
    color: COLORS.mist,
  },
  matchTeamsTitle: {
    marginTop: 6,
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  forecastSummaryRow: {
    marginTop: 6,
  },
  forecastSummaryLabel: {
    fontSize: 10.5,
    color: COLORS.mist,
  },
  forecastSummaryStrong: {
    fontWeight: "500",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  forecastControlsRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  scoreInput: {
    width: 42,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: COLORS.elev,
    textAlign: "center",
    fontSize: 11.5,
    fontWeight: "500",
    color: COLORS.ink,
    paddingVertical: 0,
  },
  smallRedBtn: {
    height: 34,
    borderRadius: 8,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  smallRedBtnText: {
    fontSize: 10.5,
    fontWeight: "500",
    color: "#ffffff",
  },
  smallDarkBtn: {
    height: 34,
    borderRadius: 8,
    backgroundColor: COLORS.ink,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  smallDarkBtnText: {
    fontSize: 10.5,
    fontWeight: "500",
    color: "#ffffff",
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  textField: {
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 10,
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.ink,
    paddingVertical: 0,
  },
  fullRedBtn: {
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.betclicRed,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  fullRedBtnText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#ffffff",
  },
  adminTeamsRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  adminTeamItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  adminTeamText: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.ink,
  },
  adminScoreBadge: {
    borderRadius: 6,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  matchActionsRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  grayActionChip: {
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  grayActionText: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.ink,
  },
  winActionChip: {
    height: 34,
    borderRadius: 8,
    backgroundColor: COLORS.win,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  winActionText: {
    fontSize: 10.5,
    fontWeight: "500",
    color: "#ffffff",
  },
  resolveWrap: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  userLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  userInitialCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  userInitialText: {
    fontSize: 10.5,
    fontWeight: "500",
    color: "#ffffff",
  },
  userBalText: {
    fontSize: 11.5,
    fontWeight: "500",
    color: COLORS.win,
    fontVariant: ["tabular-nums"],
  },
  sectionCaps: {
    fontSize: 10,
    fontWeight: "500",
    letterSpacing: 0.6,
    color: COLORS.mist,
    paddingHorizontal: 2,
  },
});
