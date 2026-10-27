import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { ArrowLeft, Landmark, Smartphone, Wallet } from "lucide-react-native";
import { api, type ClientWalletResponse } from "@/lib/api";
import { getCachedWalletSnapshot } from "@/lib/entity-cache";
import { eur } from "@/lib/format";
import { cardSurface, colors } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

/**
 * Page dédiée `/parametres/retrait` fidèle à `src/app/(main)/parametres/retrait/page.tsx`.
 */
export default function RetraitScreen() {
  const router = useRouter();
  const { balance, setBalance, toast } = useApp();

  const [wallet, setWallet] = useState<ClientWalletResponse | null>(() =>
    getCachedWalletSnapshot()
  );
  const [amount, setAmount] = useState("25");
  const [method, setMethod] = useState<"sepa" | "paypal" | "mobile_money">("sepa");
  const [destination, setDestination] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void api
      .wallet()
      .then(setWallet)
      .catch(() => {});
  }, []);

  const withdrawable = wallet?.summary.withdrawable ?? balance;
  const parsedAmount = parseFloat(amount.replace(",", ".")) || 0;

  const submit = async () => {
    if (parsedAmount < 10 || !destination.trim() || loading) return;
    setLoading(true);
    try {
      const res = await api.withdrawals.request({
        amount: parsedAmount,
        method,
        destination: destination.trim(),
        accountHolder: accountHolder.trim() || undefined,
      });
      setBalance(res.balance);
      toast({
        kind: "success",
        title: "Demande de retrait enregistrée",
        subtitle: `${eur(parsedAmount)} en cours de traitement`,
      });
      router.back();
    } catch (err) {
      toast({
        kind: "error",
        title: "Retrait refusé",
        subtitle: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.topRow}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={18} color={colors.ink} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.pageTitle}>Retirer mes gains</Text>
      </View>

      <View style={[cardSurface.glassCard, styles.card]}>
        <View style={styles.availRow}>
          <Text style={styles.availLabel}>Montant retirable</Text>
          <Text style={styles.availVal}>{eur(withdrawable)}</Text>
        </View>

        <Text style={styles.label}>Mode de réception</Text>
        <View style={styles.methodsRow}>
          {(
            [
              { id: "sepa", label: "SEPA", Icon: Landmark },
              { id: "paypal", label: "PayPal", Icon: Wallet },
              { id: "mobile_money", label: "Mobile Money", Icon: Smartphone },
            ] as const
          ).map((m) => {
            const active = method === m.id;
            return (
              <Pressable
                key={m.id}
                onPress={() => setMethod(m.id)}
                style={[styles.methodBtn, active && styles.methodBtnActive]}
              >
                <m.Icon
                  size={15}
                  color={active ? colors.betclicRed : colors.mist}
                />
                <Text
                  style={[
                    styles.methodText,
                    active && { color: colors.betclicRed, fontWeight: "800" },
                  ]}
                >
                  {m.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Montant (min. 10 €)</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          style={styles.input}
        />

        <Text style={styles.label}>
          {method === "sepa"
            ? "IBAN bénéficiaire"
            : method === "paypal"
              ? "E-mail PayPal"
              : "Numéro Mobile Money"}
        </Text>
        <TextInput
          value={destination}
          onChangeText={setDestination}
          placeholder={
            method === "sepa"
              ? "FR76 …"
              : method === "paypal"
                ? "vous@exemple.com"
                : "+229 …"
          }
          placeholderTextColor={colors.dim}
          autoCapitalize="none"
          style={styles.input}
        />

        <TextInput
          value={accountHolder}
          onChangeText={setAccountHolder}
          placeholder="Nom complet du titulaire (optionnel)"
          placeholderTextColor={colors.dim}
          style={styles.input}
        />

        <Pressable
          disabled={
            loading ||
            parsedAmount < 10 ||
            parsedAmount > withdrawable ||
            !destination.trim()
          }
          onPress={() => void submit()}
          style={[
            styles.submitBtn,
            (loading ||
              parsedAmount < 10 ||
              parsedAmount > withdrawable ||
              !destination.trim()) && { opacity: 0.5 },
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.submitText}>
              Demander le retrait de {eur(parsedAmount)}
            </Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.deep },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28, gap: 12 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  pageTitle: { fontSize: 17, fontWeight: "900", color: colors.ink },
  card: { padding: 15, gap: 10 },
  availRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 11,
    borderRadius: 11,
    backgroundColor: colors.elev,
  },
  availLabel: { fontSize: 12, fontWeight: "700", color: colors.mist },
  availVal: { fontSize: 15, fontWeight: "900", color: colors.win },
  label: { fontSize: 12, fontWeight: "800", color: colors.mist },
  methodsRow: { flexDirection: "row", gap: 6 },
  methodBtn: {
    flex: 1,
    height: 42,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.edge,
    backgroundColor: colors.elev,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  methodBtnActive: {
    borderColor: colors.betclicRed,
    backgroundColor: "rgba(225,0,20,0.08)",
  },
  methodText: { fontSize: 12, fontWeight: "700", color: colors.ink },
  input: {
    height: 42,
    borderRadius: 11,
    backgroundColor: colors.elev,
    borderWidth: 1,
    borderColor: colors.edgeSoft,
    paddingHorizontal: 12,
    fontSize: 13.5,
    color: colors.ink,
  },
  submitBtn: {
    height: 46,
    borderRadius: 13,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitText: { fontSize: 14, fontWeight: "900", color: colors.white },
});
