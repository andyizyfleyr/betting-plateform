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
import { ArrowLeft, XCircle } from "lucide-react-native";
import { useApp } from "@/context/app-context";
import {
  api,
  ApiHttpError,
  generateIdempotencyKey,
  type ClientWalletData,
} from "@/lib/api";
import { getCachedWalletSnapshot } from "@/lib/entity-cache";
import { eur, formatPlacedAt } from "@/lib/format";
import { Redirect, useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

export default function RetraitScreen() {
  const router = useRouter();
  const { user, authReady, balance, setBalance, toast } = useApp();

  const [wallet, setWallet] = useState<ClientWalletData | null>(() =>
    getCachedWalletSnapshot()
  );
  const [refreshing, setRefreshing] = useState(false);
  const [method, setMethod] = useState<"mobile_money" | "sepa" | "paypal">(
    "mobile_money"
  );
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("20");
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.wallet();
      setWallet(data);
      setBalance(data.balance);
    } catch {
      /* ignore */
    }
  }, [setBalance, user]);

  useEffect(() => {
    void load();
  }, [load]);

  if (authReady && !user) {
    return <Redirect href="/auth" />;
  }

  const withdrawable = wallet?.summary.withdrawable ?? balance;
  const bonusLocked = wallet?.summary.bonusLocked ?? 0;
  const numAmount = Math.max(
    0,
    Math.round((parseFloat(amount.replace(",", ".")) || 0) * 100) / 100
  );

  const handleRequest = async () => {
    if (numAmount < 10) {
      toast({ kind: "error", title: "Retrait minimum : 10,00 €" });
      return;
    }
    if (numAmount > withdrawable + 0.001) {
      toast({ kind: "error", title: "Montant supérieur au solde retirable" });
      return;
    }
    if (destination.trim().length < 5) {
      toast({
        kind: "error",
        title: "Coordonnées incomplètes",
        description: "Saisissez votre numéro Mobile Money, IBAN ou PayPal.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.requestWithdrawal({
        method,
        destination: destination.trim(),
        amount: numAmount,
        idempotencyKey: generateIdempotencyKey("wd"),
      });
      setBalance(res.balance);
      setDestination("");
      await load();
      toast({
        kind: "success",
        title: "Demande de retrait enregistrée",
        description: `${eur(numAmount)} en cours de traitement.`,
      });
    } catch (err) {
      toast({
        kind: "error",
        title: "Retrait refusé",
        description:
          err instanceof ApiHttpError ? err.message : "Veuillez réessayer.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id: number) => {
    setCancellingId(id);
    try {
      const res = await api.cancelWithdrawal(id, generateIdempotencyKey("wdc"));
      setBalance(res.balance);
      await load();
      toast({
        kind: "info",
        title: "Retrait annulé",
        description: "Le montant a été recrédité sur votre solde.",
      });
    } catch (err) {
      toast({
        kind: "error",
        title: "Annulation impossible",
        description:
          err instanceof ApiHttpError ? err.message : "Veuillez réessayer.",
      });
    } finally {
      setCancellingId(null);
    }
  };

  const pendingWithdrawals = (wallet?.withdrawals ?? []).filter(
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
      <View style={styles.navBar}>
        <Pressable
          onPress={() => router.back("/parametres")}
          style={styles.backBtn}
        >
          <ArrowLeft size={17} color={COLORS.ink} strokeWidth={2.3} />
        </Pressable>
        <Text style={styles.navTitle}>Retrait</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.balanceCard}>
        <View>
          <Text style={styles.bLabel}>Solde retirable</Text>
          <Text style={styles.bVal}>{eur(withdrawable)}</Text>
        </View>
        {bonusLocked > 0 ? (
          <View style={styles.bonusBadge}>
            <Text style={styles.bonusText}>
              Bonus sous condition : {eur(bonusLocked)}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Canal de réception</Text>
        <View style={styles.methodsRow}>
          {[
            { key: "mobile_money", label: "Mobile Money" },
            { key: "sepa", label: "IBAN SEPA" },
            { key: "paypal", label: "PayPal" },
          ].map((m) => {
            const active = method === m.key;
            return (
              <Pressable
                key={m.key}
                onPress={() =>
                  setMethod(m.key as "mobile_money" | "sepa" | "paypal")
                }
                style={[styles.mPill, active && styles.mPillActive]}
              >
                <Text style={[styles.mText, active && styles.mTextActive]}>
                  {m.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Bénéficiaire</Text>
        <TextInput
          value={destination}
          onChangeText={setDestination}
          placeholder={
            method === "mobile_money"
              ? "Numéro Mobile Money (+229...)"
              : method === "sepa"
                ? "IBAN complet (FR76...)"
                : "Adresse e-mail PayPal"
          }
          placeholderTextColor={COLORS.dim}
          style={styles.input}
        />

        <Text style={styles.sectionTitle}>Montant à retirer (€)</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="Min. 10,00 €"
          placeholderTextColor={COLORS.dim}
          style={styles.input}
        />

        <Pressable
          disabled={submitting}
          onPress={handleRequest}
          style={[styles.submitBtn, submitting && { opacity: 0.65 }]}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.submitText}>
              Demander le retrait · {eur(numAmount)}
            </Text>
          )}
        </Pressable>
      </View>

      {pendingWithdrawals.length > 0 ? (
        <View style={styles.pendingSection}>
          <Text style={styles.sectionTitle}>Retraits en attente</Text>
          {pendingWithdrawals.map((w) => (
            <View key={w.id} style={styles.pendingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pendingAmt}>{eur(w.amount)}</Text>
                <Text numberOfLines={1} style={styles.pendingSub}>
                  {w.method} · {w.destination} · {formatPlacedAt(w.createdAt)}
                </Text>
              </View>
              <Pressable
                disabled={cancellingId === w.id}
                onPress={() => handleCancel(w.id)}
                style={styles.cancelBtn}
              >
                <XCircle size={14} color={COLORS.betclicRed} strokeWidth={2.2} />
                <Text style={styles.cancelText}>Annuler</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: COLORS.deep },
  content: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 28, gap: 12 },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  navTitle: { fontSize: 17, fontWeight: "800", color: COLORS.ink },
  balanceCard: {
    borderRadius: 16,
    backgroundColor: COLORS.ink,
    padding: 16,
    gap: 8,
  },
  bLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255,255,255,0.72)",
  },
  bVal: {
    fontSize: 22,
    fontWeight: "900",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
  bonusBadge: {
    borderRadius: 8,
    backgroundColor: "rgba(245, 158, 11, 0.18)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: "flex-start",
  },
  bonusText: { fontSize: 11.5, fontWeight: "700", color: "#fbbf24" },
  formCard: {
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 15,
    gap: 11,
  },
  sectionTitle: { fontSize: 13.5, fontWeight: "800", color: COLORS.ink },
  methodsRow: { flexDirection: "row", gap: 7 },
  mPill: {
    flex: 1,
    height: 38,
    borderRadius: 11,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  mPillActive: { backgroundColor: COLORS.betclicRed },
  mText: { fontSize: 12.5, fontWeight: "700", color: COLORS.ink },
  mTextActive: { color: "#ffffff" },
  input: {
    height: 46,
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    borderWidth: 1,
    borderColor: COLORS.edge,
    paddingHorizontal: 13,
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.ink,
  },
  submitBtn: {
    height: 48,
    borderRadius: 13,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitText: { fontSize: 14.5, fontWeight: "800", color: "#ffffff" },
  pendingSection: { gap: 8 },
  pendingRow: {
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pendingAmt: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  pendingSub: { fontSize: 11.5, color: COLORS.dim, marginTop: 1 },
  cancelBtn: {
    height: 34,
    borderRadius: 9,
    backgroundColor: "rgba(225, 0, 20, 0.08)",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  cancelText: { fontSize: 12, fontWeight: "700", color: COLORS.betclicRed },
});
