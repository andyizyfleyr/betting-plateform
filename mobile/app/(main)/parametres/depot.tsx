import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ArrowLeft,
  CreditCard,
  Smartphone,
  Wallet,
} from "lucide-react-native";
import { useApp } from "@/context/app-context";
import {
  api,
  ApiHttpError,
  generateIdempotencyKey,
  type PaymentProvider,
} from "@/lib/api";
import { eur } from "@/lib/format";
import { Redirect, useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

const AMOUNTS = [10, 25, 50, 100, 250, 500] as const;

export default function DepotScreen() {
  const router = useRouter();
  const { user, authReady, balance, paymentProviders, toast } = useApp();

  const [providers, setProviders] =
    useState<PaymentProvider[]>(paymentProviders);
  const [amount, setAmount] = useState("25");
  const [method, setMethod] = useState<
    "mobile_money" | "sepa" | "stripe" | "paypal"
  >("mobile_money");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.payments
      .providers()
      .then((r) => setProviders(r.providers))
      .catch(() => {});
  }, []);

  if (authReady && !user) {
    return <Redirect href="/auth" />;
  }

  const numAmount = Math.max(
    0,
    Math.round((parseFloat(amount.replace(",", ".")) || 0) * 100) / 100
  );

  const stripeOn = providers.some((p) => p.id === "stripe" && p.enabled);
  const paypalOn = providers.some((p) => p.id === "paypal" && p.enabled);

  const handleSubmit = async () => {
    if (numAmount < 5) {
      toast({ kind: "error", title: "Montant minimum : 5,00 €" });
      return;
    }
    setSubmitting(true);
    try {
      const idem = generateIdempotencyKey("dep");
      if (method === "stripe" || method === "paypal") {
        const res = await api.payments.create(method, numAmount, idem);
        if (res.url) await Linking.openURL(res.url);
      } else {
        if (reference.trim().length < 4) {
          toast({
            kind: "error",
            title: "Référence requise",
            description: "Indiquez la référence du transfert (4 caractères min.).",
          });
          setSubmitting(false);
          return;
        }
        await api.payments.manual({
          method,
          reference: reference.trim(),
          amount: numAmount,
          idempotencyKey: idem,
        });
        setReference("");
        toast({
          kind: "success",
          title: "Dépôt enregistré",
          description: `Demande de ${eur(numAmount)} transmise pour validation.`,
        });
        router.push("/parametres/transactions");
      }
    } catch (err) {
      toast({
        kind: "error",
        title: "Dépôt impossible",
        description:
          err instanceof ApiHttpError ? err.message : "Veuillez réessayer.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.navBar}>
        <Pressable
          onPress={() => router.back("/parametres")}
          style={styles.backBtn}
        >
          <ArrowLeft size={17} color={COLORS.ink} strokeWidth={2.3} />
        </Pressable>
        <Text style={styles.navTitle}>Dépôt</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.balanceBanner}>
        <Text style={styles.balanceLabel}>Solde actuel</Text>
        <Text style={styles.balanceVal}>{eur(balance)}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>1. Choisir un montant (€)</Text>
        <View style={styles.chipsWrap}>
          {AMOUNTS.map((a) => {
            const active = Math.abs(numAmount - a) < 0.01;
            return (
              <Pressable
                key={a}
                onPress={() => setAmount(String(a))}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text
                  style={[styles.chipText, active && styles.chipTextActive]}
                >
                  {a} €
                </Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="Autre montant (min. 5 €)"
          placeholderTextColor={COLORS.dim}
          style={styles.input}
        />

        <Text style={styles.sectionTitle}>2. Moyen de paiement</Text>
        <View style={styles.methodsList}>
          <Pressable
            onPress={() => setMethod("mobile_money")}
            style={[
              styles.methodRow,
              method === "mobile_money" && styles.methodRowActive,
            ]}
          >
            <Smartphone
              size={18}
              color={
                method === "mobile_money" ? COLORS.betclicRed : COLORS.mist
              }
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.mTitle}>Mobile Money (MTN / Moov / Wave)</Text>
              <Text style={styles.mSub}>Validation rapide par référence</Text>
            </View>
          </Pressable>

          <Pressable
            onPress={() => setMethod("sepa")}
            style={[
              styles.methodRow,
              method === "sepa" && styles.methodRowActive,
            ]}
          >
            <Wallet
              size={18}
              color={method === "sepa" ? COLORS.betclicRed : COLORS.mist}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.mTitle}>Virement bancaire SEPA</Text>
              <Text style={styles.mSub}>Sans frais — référence requise</Text>
            </View>
          </Pressable>

          {stripeOn ? (
            <Pressable
              onPress={() => setMethod("stripe")}
              style={[
                styles.methodRow,
                method === "stripe" && styles.methodRowActive,
              ]}
            >
              <CreditCard
                size={18}
                color={method === "stripe" ? COLORS.betclicRed : COLORS.mist}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.mTitle}>Carte Bancaire (Stripe)</Text>
                <Text style={styles.mSub}>Crédit instantané 24h/24</Text>
              </View>
            </Pressable>
          ) : null}

          {paypalOn ? (
            <Pressable
              onPress={() => setMethod("paypal")}
              style={[
                styles.methodRow,
                method === "paypal" && styles.methodRowActive,
              ]}
            >
              <CreditCard
                size={18}
                color={method === "paypal" ? COLORS.betclicRed : COLORS.mist}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.mTitle}>PayPal</Text>
                <Text style={styles.mSub}>Paiement sécurisé instantané</Text>
              </View>
            </Pressable>
          ) : null}
        </View>

        {method === "mobile_money" || method === "sepa" ? (
          <View style={{ gap: 6 }}>
            <Text style={styles.sectionTitle}>3. Référence du transfert</Text>
            <TextInput
              value={reference}
              onChangeText={setReference}
              placeholder="Ex. MOMO-8472910 ou SEPA-PULSE"
              placeholderTextColor={COLORS.dim}
              style={styles.input}
            />
          </View>
        ) : null}

        <Pressable
          disabled={submitting}
          onPress={handleSubmit}
          style={[styles.submitBtn, submitting && { opacity: 0.65 }]}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.submitText}>
              Confirmer le dépôt · {eur(numAmount)}
            </Text>
          )}
        </Pressable>
      </View>
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
  balanceBanner: {
    borderRadius: 16,
    backgroundColor: COLORS.ink,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  balanceLabel: {
    fontSize: 12.5,
    fontWeight: "600",
    color: "rgba(255,255,255,0.75)",
  },
  balanceVal: {
    fontSize: 20,
    fontWeight: "900",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
  card: {
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 15,
    gap: 12,
  },
  sectionTitle: { fontSize: 13.5, fontWeight: "800", color: COLORS.ink },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 8,
  },
  chip: {
    width: "31.5%",
    height: 40,
    borderRadius: 11,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: COLORS.betclicRed },
  chipText: { fontSize: 13.5, fontWeight: "800", color: COLORS.ink },
  chipTextActive: { color: "#ffffff" },
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
  methodsList: { gap: 8 },
  methodRow: {
    borderRadius: 13,
    backgroundColor: COLORS.elev,
    borderWidth: 1.5,
    borderColor: "transparent",
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  methodRowActive: {
    borderColor: COLORS.betclicRed,
    backgroundColor: "rgba(225, 0, 20, 0.06)",
  },
  mTitle: { fontSize: 13.5, fontWeight: "800", color: COLORS.ink },
  mSub: { fontSize: 11.5, color: COLORS.dim, marginTop: 1 },
  submitBtn: {
    height: 48,
    borderRadius: 13,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitText: { fontSize: 14.5, fontWeight: "800", color: "#ffffff" },
});
