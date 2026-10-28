import React, { useEffect, useRef, useState } from "react";
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
  Building2,
  Check,
  CreditCard,
  History,
  Lock,
  Smartphone,
  Wallet,
} from "lucide-react-native";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import { useApp } from "@/context/app-context";
import { api, ApiHttpError, type PaymentProvider } from "@/lib/api";
import { eur } from "@/lib/format";
import { createIdempotencyKey } from "@/lib/http";
import { useRouter } from "@/lib/router";
import { COLORS, triggerHaptic } from "@/theme/tokens";

const QUICK = [10, 25, 50, 100, 250];
type DepositMethod = "mobile_money" | "sepa" | "stripe" | "paypal";

export default function DepositScreen() {
  const router = useRouter();
  const { authReady, sessionRestoring, toast, user, bumpBets, hapticsEnabled } =
    useApp();

  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  const [amountText, setAmountText] = useState("25");
  const [method, setMethod] = useState<DepositMethod>("mobile_money");
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [doneManual, setDoneManual] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const idempotencySlotRef = useRef<{ key: string; sig: string } | null>(null);

  useEffect(() => {
    let active = true;
    api.payments
      .providers()
      .then((r) => {
        if (!active) return;
        setProviders(r.providers);
        const autoOnline = r.providers.find((p) => p.enabled);
        if (autoOnline) setMethod(autoOnline.id);
      })
      .catch(() => {
        if (active) setProviders([]);
      });
    return () => {
      active = false;
    };
  }, []);

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
        <View style={styles.card}>
          <Text style={styles.guestTitle}>
            Connectez-vous pour effectuer un dépôt
          </Text>
          <Pressable
            onPress={() => router.push("/auth?mode=login")}
            style={styles.redBtn}
          >
            <Text style={styles.redBtnText}>Connexion</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const parsed = Number(amountText.replace(",", "."));
  const amount = Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
  const validAmount = amount >= 5 && amount <= 2000;

  const isManual = method === "mobile_money" || method === "sepa";
  const onlineProvider =
    method === "stripe" || method === "paypal"
      ? providers.find((p) => p.id === method)
      : undefined;

  const canSubmit =
    !loading &&
    validAmount &&
    (isManual
      ? reference.trim().length >= 4
      : Boolean(onlineProvider?.enabled));

  const submit = async () => {
    if (!canSubmit || inFlightRef.current) return;
    inFlightRef.current = true;
    const cleanRef = reference.trim();
    const sig = `${method}:${isManual ? cleanRef : "online"}:${amount}`;
    if (!idempotencySlotRef.current || idempotencySlotRef.current.sig !== sig) {
      idempotencySlotRef.current = {
        key: createIdempotencyKey("dep"),
        sig,
      };
    }
    const idempotencyKey = idempotencySlotRef.current.key;

    setLoading(true);
    setError(null);
    try {
      if (method === "mobile_money" || method === "sepa") {
        await api.payments.manual({
          method,
          reference: cleanRef,
          amount,
          idempotencyKey,
        });
        idempotencySlotRef.current = null;
        triggerHaptic("success", hapticsEnabled);
        bumpBets();
        setDoneManual(true);
        inFlightRef.current = false;
        setLoading(false);
        return;
      }
      const r = await api.payments.create(method, amount, idempotencyKey);
      idempotencySlotRef.current = null;
      await Linking.openURL(r.url);
      inFlightRef.current = false;
      setLoading(false);
    } catch (e) {
      if (e instanceof ApiHttpError && e.status >= 400 && e.status < 500) {
        idempotencySlotRef.current = null;
      }
      setError(e instanceof Error ? e.message : "Dépôt indisponible");
      inFlightRef.current = false;
      setLoading(false);
      toast({
        kind: "error",
        title: "Dépôt impossible",
        description: "Vérifiez les informations saisies",
      });
    }
  };

  const stripeInfo = providers.find((p) => p.id === "stripe");
  const paypalInfo = providers.find((p) => p.id === "paypal");

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* En-tête compact en ligne identique à src/app/(main)/parametres/depot/page.tsx */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Pressable
            onPress={() => router.back("/parametres")}
            style={({ pressed }) => [
              styles.roundBackBtn,
              pressed && { transform: [{ scale: 0.95 }] },
            ]}
          >
            <ArrowLeft size={14} color={COLORS.ink} strokeWidth={2.3} />
          </Pressable>
          <Text numberOfLines={1} style={styles.headerTitle}>
            Déposer des fonds
          </Text>
        </View>

        <Pressable
          onPress={() => router.push("/parametres/transactions")}
          style={styles.historyPill}
        >
          <History size={12} color={COLORS.ink} strokeWidth={2.2} />
          <Text style={styles.historyPillText}>Historique</Text>
        </Pressable>
      </View>

      <View style={{ marginTop: 10 }}>
        {doneManual ? (
          <View style={[styles.card, { alignItems: "center" }]}>
            <View style={styles.doneCircle}>
              <Check size={20} color={COLORS.win} strokeWidth={2.6} />
            </View>
            <Text style={styles.doneTitle}>Demande enregistrée</Text>
            <Text style={styles.doneSub}>
              Votre dépôt de{" "}
              <Text style={{ fontWeight: "700", color: COLORS.ink }}>
                {eur(amount)}
              </Text>{" "}
              ({method === "mobile_money" ? "Mobile Money" : "Virement SEPA"})
              sera crédité dès validation.
            </Text>
            <View style={styles.doneBtns}>
              <Pressable
                onPress={() => router.push("/parametres/transactions")}
                style={styles.grayBtn}
              >
                <Text style={styles.grayBtnText}>Transactions</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push("/matchs")}
                style={styles.redBtn}
              >
                <Text style={styles.redBtnText}>Matchs</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {/* Montant compact */}
            <View style={styles.card}>
              <Text style={styles.fieldCaps}>
                MONTANT À CRÉDITER (5 € – 2 000 €)
              </Text>
              <View style={styles.amountInputWrap}>
                <TextInput
                  value={amountText}
                  onChangeText={setAmountText}
                  keyboardType="decimal-pad"
                  placeholder="25"
                  placeholderTextColor={COLORS.dim}
                  style={styles.amountInput}
                />
                <Text style={styles.euroSymbol}>€</Text>
              </View>

              <View style={styles.quickGrid}>
                {QUICK.map((q) => {
                  const active = amount === q;
                  return (
                    <Pressable
                      key={q}
                      onPress={() => setAmountText(String(q))}
                      style={[
                        styles.quickChip,
                        active && styles.quickChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.quickChipText,
                          active && { color: "#ffffff" },
                        ]}
                      >
                        {q} €
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Moyens de paiement compacts */}
            <View style={styles.card}>
              <Text style={styles.fieldCaps}>MOYEN DE PAIEMENT</Text>

              <View style={styles.methodsGrid}>
                {[
                  {
                    id: "mobile_money" as const,
                    label: "Mobile Money",
                    sub: "MTN · Moov · Orange",
                    Icon: Smartphone,
                    available: true,
                  },
                  {
                    id: "sepa" as const,
                    label: "Virement SEPA",
                    sub: "IBAN instantané",
                    Icon: Building2,
                    available: true,
                  },
                  {
                    id: "stripe" as const,
                    label: "Carte bancaire",
                    sub: stripeInfo?.enabled ? "Visa · MC" : "Bientôt actif",
                    Icon: CreditCard,
                    available: Boolean(stripeInfo?.enabled),
                  },
                  {
                    id: "paypal" as const,
                    label: "PayPal",
                    sub: paypalInfo?.enabled ? "Express" : "Bientôt actif",
                    Icon: Wallet,
                    available: Boolean(paypalInfo?.enabled),
                  },
                ].map((m) => {
                  const selected = method === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      disabled={!m.available}
                      onPress={() => setMethod(m.id)}
                      style={[
                        styles.methodCell,
                        selected && styles.methodCellSelected,
                        !m.available && { opacity: 0.5 },
                      ]}
                    >
                      <m.Icon
                        size={16}
                        color={selected ? COLORS.betclicRed : COLORS.mist}
                        strokeWidth={2.2}
                      />
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={styles.methodLabel}>
                          {m.label}
                        </Text>
                        <Text numberOfLines={1} style={styles.methodSub}>
                          {m.sub}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {isManual ? (
                <View style={{ marginTop: 10 }}>
                  <Text style={styles.fieldCaps}>
                    {method === "mobile_money"
                      ? "NUMÉRO OU RÉF. MOBILE MONEY"
                      : "RÉFÉRENCE VIREMENT SEPA"}
                  </Text>
                  <TextInput
                    value={reference}
                    onChangeText={setReference}
                    placeholder={
                      method === "mobile_money"
                        ? "Ex. MTN +229 01 … / ID TXN"
                        : "Ex. Réf. virement SEPA"
                    }
                    placeholderTextColor={COLORS.dim}
                    style={styles.refInput}
                  />
                </View>
              ) : null}

              {error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <Pressable
                disabled={!canSubmit}
                onPress={() => void submit()}
                style={[
                  styles.submitBtn,
                  canSubmit ? styles.submitBtnReady : styles.submitBtnDisabled,
                ]}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <Lock
                      size={14}
                      color={canSubmit ? "#ffffff" : COLORS.dim}
                      strokeWidth={2.3}
                    />
                    <Text
                      style={[
                        styles.submitBtnText,
                        !canSubmit && { color: COLORS.dim },
                      ]}
                    >
                      Créditer {validAmount ? eur(amount) : ""}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        )}
      </View>
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
    paddingTop: 10,
    paddingBottom: 28,
  },
  guestWrap: {
    paddingHorizontal: 12,
    paddingTop: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  roundBackBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.ink,
  },
  historyPill: {
    height: 30,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  historyPillText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 12,
  },
  fieldCaps: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: COLORS.mist,
  },
  amountInputWrap: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "rgba(241,243,245,0.65)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  amountInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: "900",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
    paddingVertical: 0,
  },
  euroSymbol: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.dim,
  },
  quickGrid: {
    marginTop: 8,
    flexDirection: "row",
    gap: 6,
  },
  quickChip: {
    flex: 1,
    height: 32,
    borderRadius: 8,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  quickChipActive: {
    backgroundColor: COLORS.betclicRed,
  },
  quickChipText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  methodsGrid: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  methodCell: {
    width: "48.8%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "rgba(241,243,245,0.45)",
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  methodCellSelected: {
    borderColor: COLORS.betclicRed,
    backgroundColor: "rgba(225,0,20,0.08)",
  },
  methodLabel: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  methodSub: {
    fontSize: 9.5,
    color: COLORS.dim,
  },
  refInput: {
    marginTop: 4,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "rgba(241,243,245,0.65)",
    paddingHorizontal: 12,
    fontSize: 12,
    fontWeight: "500",
    color: COLORS.ink,
  },
  errorBox: {
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: "rgba(225,0,20,0.10)",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  errorText: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.betclicRed,
  },
  submitBtn: {
    marginTop: 12,
    height: 40,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  submitBtnReady: {
    backgroundColor: COLORS.win,
  },
  submitBtnDisabled: {
    backgroundColor: COLORS.elev,
  },
  submitBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#ffffff",
  },
  doneCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(21,128,61,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  doneTitle: {
    marginTop: 10,
    fontSize: 15.5,
    fontWeight: "800",
    color: COLORS.ink,
  },
  doneSub: {
    marginTop: 4,
    fontSize: 11.5,
    lineHeight: 17,
    color: COLORS.mist,
    textAlign: "center",
  },
  doneBtns: {
    marginTop: 14,
    flexDirection: "row",
    gap: 8,
  },
  grayBtn: {
    borderRadius: 8,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  grayBtnText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  redBtn: {
    borderRadius: 8,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  redBtnText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#ffffff",
  },
  guestTitle: {
    fontSize: 14.5,
    fontWeight: "700",
    color: COLORS.ink,
    textAlign: "center",
    marginBottom: 12,
  },
});
