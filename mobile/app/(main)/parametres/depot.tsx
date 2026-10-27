import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  CreditCard,
  Landmark,
  Smartphone,
  Wallet,
} from "lucide-react-native";
import { api } from "@/lib/api";
import { eur } from "@/lib/format";
import { cardSurface, colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

const PRESETS = [10, 25, 50, 100, 250];

/**
 * Page dédiée `/parametres/depot` fidèle à `src/app/(main)/parametres/depot/page.tsx`.
 */
export default function DepotScreen() {
  const router = useRouter();
  const { setBalance, paymentProviders, hapticsEnabled, toast } = useApp();

  const [amount, setAmount] = useState<number>(25);
  const [provider, setProvider] = useState<
    "stripe" | "paypal" | "mobile_money" | "sepa"
  >("stripe");
  const [senderRef, setSenderRef] = useState("");
  const [phoneOrIban, setPhoneOrIban] = useState("");
  const [loading, setLoading] = useState(false);

  const info = paymentProviders.find((p) => p.id === provider);

  const submit = async () => {
    if (amount < 5 || loading) return;
    setLoading(true);
    try {
      if (provider === "stripe") {
        const res = await api.payments.stripeCheckout(amount);
        if (res.mode === "live_redirect" && res.url) {
          await WebBrowser.openBrowserAsync(res.url);
        } else if (typeof res.balance === "number") {
          setBalance(res.balance);
          toast({ kind: "win", title: `+${eur(amount)} crédités` });
          router.back();
        }
      } else if (provider === "paypal") {
        const res = await api.payments.paypalOrder(amount);
        if (res.mode === "live_redirect" && res.url) {
          await WebBrowser.openBrowserAsync(res.url);
        } else if (typeof res.balance === "number") {
          setBalance(res.balance);
          toast({ kind: "win", title: `+${eur(amount)} crédités via PayPal` });
          router.back();
        }
      } else {
        if (!senderRef.trim()) {
          toast({ kind: "error", title: "Indiquez la référence du transfert" });
          setLoading(false);
          return;
        }
        const res = await api.payments.manualRequest({
          provider,
          amount,
          senderRef: senderRef.trim(),
          phoneOrIban: phoneOrIban.trim() || undefined,
        });
        toast({
          kind: "success",
          title: "Dépôt enregistré",
          subtitle: res.message,
        });
        router.back();
      }
    } catch (err) {
      toast({
        kind: "error",
        title: "Échec du dépôt",
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
        <Text style={styles.pageTitle}>Déposer des fonds</Text>
      </View>

      <View style={[cardSurface.glassCard, styles.card]}>
        <Text style={styles.label}>Montant à déposer</Text>
        <View style={styles.presetsRow}>
          {PRESETS.map((p) => {
            const active = amount === p;
            return (
              <Pressable
                key={p}
                onPress={() => {
                  triggerHaptic("light", hapticsEnabled);
                  setAmount(p);
                }}
                style={[styles.presetBtn, active && styles.presetBtnActive]}
              >
                <Text
                  style={[styles.presetText, active && { color: colors.white }]}
                >
                  {p} €
                </Text>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          value={String(amount)}
          onChangeText={(t) => {
            const n = parseFloat(t.replace(",", "."));
            setAmount(Number.isFinite(n) ? n : 0);
          }}
          keyboardType="decimal-pad"
          style={styles.input}
        />

        <Text style={styles.label}>Méthode de paiement</Text>
        <View style={styles.methodsGrid}>
          {(
            [
              { id: "stripe", label: "Carte Stripe", Icon: CreditCard },
              { id: "paypal", label: "PayPal", Icon: Wallet },
              { id: "mobile_money", label: "Mobile Money", Icon: Smartphone },
              { id: "sepa", label: "Virement SEPA", Icon: Landmark },
            ] as const
          ).map((m) => {
            const active = provider === m.id;
            return (
              <Pressable
                key={m.id}
                onPress={() => setProvider(m.id)}
                style={[styles.methodBtn, active && styles.methodBtnActive]}
              >
                <m.Icon
                  size={16}
                  color={active ? colors.betclicRed : colors.mist}
                  strokeWidth={2.3}
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

        {(provider === "mobile_money" || provider === "sepa") && (
          <View style={{ gap: 8 }}>
            {info?.manualInstructions && (
              <Text style={styles.manualNote}>
                {info.manualInstructions.beneficiary} ·{" "}
                {info.manualInstructions.account}
              </Text>
            )}
            <TextInput
              value={phoneOrIban}
              onChangeText={setPhoneOrIban}
              placeholder={
                provider === "mobile_money"
                  ? "Numéro émetteur (optionnel)"
                  : "IBAN émetteur (optionnel)"
              }
              placeholderTextColor={colors.dim}
              style={styles.input}
            />
            <TextInput
              value={senderRef}
              onChangeText={setSenderRef}
              placeholder="Référence du transfert *"
              placeholderTextColor={colors.dim}
              style={styles.input}
            />
          </View>
        )}

        <Pressable
          disabled={loading || amount < 5}
          onPress={() => void submit()}
          style={[
            styles.submitBtn,
            (loading || amount < 5) && { opacity: 0.55 },
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.submitText}>Créditer {eur(amount)}</Text>
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
  card: { padding: 15, gap: 11 },
  label: { fontSize: 12, fontWeight: "800", color: colors.mist },
  presetsRow: { flexDirection: "row", gap: 6 },
  presetBtn: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  presetBtnActive: { backgroundColor: colors.ink },
  presetText: { fontSize: 12.5, fontWeight: "800", color: colors.ink },
  input: {
    height: 42,
    borderRadius: 11,
    backgroundColor: colors.elev,
    borderWidth: 1,
    borderColor: colors.edgeSoft,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: "700",
    color: colors.ink,
  },
  methodsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 8,
  },
  methodBtn: {
    width: "48.6%",
    height: 46,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.edge,
    backgroundColor: colors.elev,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  methodBtnActive: {
    borderColor: colors.betclicRed,
    backgroundColor: "rgba(225,0,20,0.08)",
  },
  methodText: { fontSize: 12.5, fontWeight: "700", color: colors.ink },
  manualNote: { fontSize: 11.5, fontWeight: "600", color: colors.mist },
  submitBtn: {
    height: 46,
    borderRadius: 13,
    backgroundColor: colors.betclicRed,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitText: { fontSize: 14.5, fontWeight: "900", color: colors.white },
});
