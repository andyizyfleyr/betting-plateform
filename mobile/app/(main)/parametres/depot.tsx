import { PaymentMethodMark } from "@/components/payment-method-mark";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
  X,
} from "lucide-react-native";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import { useApp } from "@/context/app-context";
import { api, ApiHttpError, type PaymentProvider } from "@/lib/api";
import {
  formatLocalAmount,
  formatPresetChip,
  localToEur,
} from "@/lib/countries";
import { openInAppUrl } from "@/lib/external-url";
import { createIdempotencyKey } from "@/lib/http";
import { useRouter } from "@/lib/router";
import { COLORS, triggerHaptic } from "@/theme/tokens";

type DepositMethod = "mobile_money" | "sepa" | "stripe" | "paypal";

export default function DepositScreen() {
  const router = useRouter();
  const {
    authReady,
    sessionRestoring,
    toast,
    user,
    bumpBets,
    hapticsEnabled,
    countryConfig,
    currency,
    currencyConfig,
  } = useApp();

  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  const [prevCur, setPrevCur] = useState(currency);
  const [amountText, setAmountText] = useState(() =>
    String(currencyConfig.defaultDepositLocal)
  );
  if (prevCur !== currency) {
    setPrevCur(currency);
    setAmountText(String(currencyConfig.defaultDepositLocal));
  }
  const [method, setMethod] = useState<DepositMethod>("mobile_money");
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [manualSheetOpen, setManualSheetOpen] = useState(false);
  const [manualSheetDone, setManualSheetDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);

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
  const localAmount =
    Number.isFinite(parsed) && parsed > 0
      ? currencyConfig.decimals === 0
        ? Math.round(parsed)
        : Math.round(parsed * 100) / 100
      : 0;
  const amount = localToEur(localAmount, currency);
  const localFormatted = validLocalLabel(localAmount, currency);
  const isManual = method === "mobile_money" || method === "sepa";
  const effectiveMinLocal = isManual
    ? currencyConfig.minDepositLocal
    : Math.max(
        currencyConfig.minDepositLocal,
        currencyConfig.decimals === 0
          ? Math.ceil(0.5 * currencyConfig.rateFromEur)
          : Math.ceil(0.5 * currencyConfig.rateFromEur * 100) / 100
      );
  const validAmount =
    localAmount >= effectiveMinLocal &&
    localAmount <= currencyConfig.maxDepositLocal;

  const onlineProvider =
    method === "stripe" || method === "paypal"
      ? providers.find((p) => p.id === method)
      : undefined;

  const canOpenCheckout =
    !loading && validAmount && (isManual || Boolean(onlineProvider?.enabled));

  const openCheckoutSheet = async () => {
    if (!canOpenCheckout || inFlightRef.current) return;
    setError(null);

    if (isManual) {
      setSheetError(null);
      setManualSheetDone(false);
      setManualSheetOpen(true);
      return;
    }

    inFlightRef.current = true;
    const sig = `${method}:online:${amount}`;
    if (!idempotencySlotRef.current || idempotencySlotRef.current.sig !== sig) {
      idempotencySlotRef.current = {
        key: createIdempotencyKey("dep"),
        sig,
      };
    }
    const idempotencyKey = idempotencySlotRef.current.key;

    setLoading(true);
    try {
      const r = await api.payments.create(method, amount, idempotencyKey, {
        returnPath: "/parametres/depot",
      });
      idempotencySlotRef.current = null;
      openInAppUrl(r.url, {
        title: method === "paypal" ? "Paiement PayPal" : "Paiement par carte",
        provider: method,
        providerRef: r.providerRef,
        amountLabel: localFormatted,
      });
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

  const submitManualInSheet = async () => {
    if (loading || inFlightRef.current || !validAmount) return;
    const cleanRef = reference.trim();
    if (cleanRef.length < 4) {
      setSheetError("Saisissez la référence ou le numéro (4 caractères min.).");
      return;
    }

    inFlightRef.current = true;
    const manualMethod = method === "sepa" ? "sepa" : "mobile_money";
    const sig = `${manualMethod}:${cleanRef}:${amount}`;
    if (!idempotencySlotRef.current || idempotencySlotRef.current.sig !== sig) {
      idempotencySlotRef.current = {
        key: createIdempotencyKey("dep"),
        sig,
      };
    }
    const idempotencyKey = idempotencySlotRef.current.key;

    setLoading(true);
    setSheetError(null);
    try {
      await api.payments.manual({
        method: manualMethod,
        reference: cleanRef,
        amount,
        idempotencyKey,
      });
      idempotencySlotRef.current = null;
      triggerHaptic("success", hapticsEnabled);
      bumpBets();
      setManualSheetDone(true);
      setReference("");
    } catch (e) {
      if (e instanceof ApiHttpError && e.status >= 400 && e.status < 500) {
        idempotencySlotRef.current = null;
      }
      setSheetError(e instanceof Error ? e.message : "Dépôt indisponible");
      toast({
        kind: "error",
        title: "Dépôt impossible",
        description: "Vérifiez les informations saisies",
      });
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  const closeManualSheet = () => {
    if (loading) return;
    setManualSheetOpen(false);
    setManualSheetDone(false);
    setSheetError(null);
  };

  const stripeInfo = providers.find((p) => p.id === "stripe");
  const paypalInfo = providers.find((p) => p.id === "paypal");

  return (
    <>
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

        <View style={{ marginTop: 10, gap: 10 }}>
          {/* Montant compact */}
          <View style={styles.card}>
            <Text style={styles.fieldCaps}>
              MONTANT À CRÉDITER
            </Text>
            <View style={styles.amountInputWrap}>
              <TextInput
                value={amountText}
                onChangeText={setAmountText}
                keyboardType={
                  currencyConfig.decimals === 0 ? "number-pad" : "decimal-pad"
                }
                placeholder={String(currencyConfig.defaultDepositLocal)}
                placeholderTextColor={COLORS.dim}
                style={styles.amountInput}
              />
              <Text style={styles.euroSymbol}>{currencyConfig.symbol}</Text>
            </View>

            <Text style={styles.amountHint}>Entre {formatLocalAmount(effectiveMinLocal, currency)} et {formatLocalAmount(currencyConfig.maxDepositLocal, currency)}</Text>
            <View style={styles.quickGrid}>
              {currencyConfig.depositPresetsLocal.map((q) => {
                const active = localAmount === q;
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
                      numberOfLines={1}
                      style={[
                        styles.quickChipText,
                        active && { color: "#ffffff" },
                      ]}
                    >
                      {formatPresetChip(q, currency)}
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
                  sub: countryConfig.mobileMoneyHint || "Transfert mobile",
                  Icon: Smartphone,
                  available: true,
                },
                {
                  id: "sepa" as const,
                  label: "Virement bancaire",
                  sub: "IBAN / Réf. bancaire",
                  Icon: Building2,
                  available: true,
                },
                {
                  id: "stripe" as const,
                  label: "Carte bancaire ou prépayée",
                  sub: stripeInfo?.enabled ? "Selon l’émetteur et le prestataire" : "Bientôt actif",
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
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: !m.available }}
                    disabled={!m.available}
                    onPress={() => {
                      setMethod(m.id);
                      setError(null);
                    }}
                    style={[
                      styles.methodCell,
                      selected && styles.methodCellSelected,
                      !m.available && { opacity: 0.5 },
                    ]}
                  >
                    <PaymentMethodMark method={m.id} fallback={
                    <m.Icon
                      size={16}
                      color={selected ? COLORS.betclicRed : COLORS.mist}
                      strokeWidth={2.2}
                    />
                    } />
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={styles.methodLabel}>
                        {m.label}
                      </Text>
                      <Text numberOfLines={1} style={styles.methodSub}>
                        {m.sub}
                      </Text>
                    </View>
                    <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioDot} /> : null}</View>
                  </Pressable>
                );
              })}
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.summary}><View style={styles.summaryLine}><Text style={styles.summaryLabel}>Montant demandé</Text><Text style={styles.summaryValue}>{localFormatted || "—"}</Text></View><View style={styles.summaryLine}><Text style={styles.summaryLabel}>Frais</Text><Text style={styles.summaryLabel}>À confirmer</Text></View></View>
            <Pressable
              disabled={!canOpenCheckout}
              onPress={() => void openCheckoutSheet()}
              style={[
                styles.submitBtn,
                canOpenCheckout ? styles.submitBtnReady : styles.submitBtnDisabled,
              ]}
            >
              {loading && !manualSheetOpen ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <>
                  <Lock
                    size={14}
                    color={canOpenCheckout ? "#ffffff" : COLORS.dim}
                    strokeWidth={2.3}
                  />
                  <Text
                    style={[
                      styles.submitBtnText,
                      !canOpenCheckout && { color: COLORS.dim },
                    ]}
                  >
                    Créditer {validAmount ? localFormatted : ""}
                  </Text>
                </>
              )}
            </Pressable>
            <Text style={styles.amountHint}>{isManual ? "Dépôt soumis à validation" : "Paiement sécurisé par le prestataire"}</Text>
            {method === "stripe" ? <Text style={styles.amountHint}>Les cartes prépayées Visa, Mastercard ou American Express peuvent être refusées selon l’émetteur et le prestataire. La saisie et la validation se font chez le prestataire.</Text> : null}
          </View>
        </View>
      </ScrollView>

      {/* BottomSheet intégré sur la page Déposer des fonds pour Mobile Money & Virement */}
      <Modal
        visible={manualSheetOpen}
        transparent
        statusBarTranslucent
        animationType="slide"
        onRequestClose={closeManualSheet}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.sheetBackdrop}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={closeManualSheet}
          />
          <View style={styles.sheetCard}>
            <View style={styles.sheetGrabber} />

            <View style={styles.sheetHeader}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={styles.sheetTitle}>
                  {method === "mobile_money"
                    ? "Dépôt Mobile Money"
                    : "Dépôt par virement bancaire"}
                </Text>
                <Text numberOfLines={1} style={styles.sheetSub}>
                  Montant à créditer : {localFormatted}
                </Text>
              </View>
              <Pressable onPress={closeManualSheet} style={styles.sheetCloseBtn}>
                <X size={16} color={COLORS.ink} strokeWidth={2.3} />
              </Pressable>
            </View>

            {manualSheetDone ? (
              <View style={styles.doneWrap}>
                <View style={styles.doneCircle}>
                  <Check size={20} color={COLORS.win} strokeWidth={2.6} />
                </View>
                <Text style={styles.doneTitle}>Demande enregistrée</Text>
                <Text style={styles.doneSub}>
                  Votre dépôt de{" "}
                  <Text style={{ fontWeight: "500", color: COLORS.ink }}>
                    {localFormatted}
                  </Text>{" "}
                  (
                  {method === "mobile_money"
                    ? "Mobile Money"
                    : "Virement bancaire"}
                  ) sera crédité sur votre solde dès validation.
                </Text>
                <View style={styles.doneBtns}>
                  <Pressable
                    onPress={() => {
                      closeManualSheet();
                      router.push("/parametres/transactions");
                    }}
                    style={styles.grayBtn}
                  >
                    <Text style={styles.grayBtnText}>Historique</Text>
                  </Pressable>
                  <Pressable
                    onPress={closeManualSheet}
                    style={styles.redBtn}
                  >
                    <Text style={styles.redBtnText}>Fermer</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={{ marginTop: 12 }}>
                <View style={styles.sheetHintBox}>
                  <Text style={styles.sheetHintText}>
                    {method === "mobile_money"
                      ? `Opérateurs pris en charge (${countryConfig.name}) : ${
                          countryConfig.mobileMoneyHint || "Mobile Money"
                        }. Indiquez le numéro émetteur ou l'identifiant TXN du transfert.`
                      : "Effectuez votre virement puis renseignez ci-dessous la référence bancaire ou l'intitulé de l'opération."}
                  </Text>
                </View>

                <Text style={[styles.fieldCaps, { marginTop: 12 }]}>
                  {method === "mobile_money"
                    ? "NUMÉRO OU RÉF. MOBILE MONEY"
                    : "RÉFÉRENCE VIREMENT BANCAIRE"}
                </Text>
                <TextInput
                  value={reference}
                  onChangeText={(v) => {
                    setReference(v);
                    if (sheetError) setSheetError(null);
                  }}
                  autoFocus
                  placeholder={
                    method === "mobile_money"
                      ? `Ex. ${
                          countryConfig.mobileMoneyHint || "Mobile Money"
                        } / ID TXN`
                      : "Ex. Réf. virement bancaire"
                  }
                  placeholderTextColor={COLORS.dim}
                  style={styles.refInput}
                />

                {sheetError ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{sheetError}</Text>
                  </View>
                ) : null}

                <Pressable
                  disabled={loading || reference.trim().length < 4}
                  onPress={() => void submitManualInSheet()}
                  style={[
                    styles.submitBtn,
                    !loading && reference.trim().length >= 4
                      ? styles.submitBtnReady
                      : styles.submitBtnDisabled,
                  ]}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <>
                      <Lock
                        size={14}
                        color={
                          reference.trim().length >= 4 ? "#ffffff" : COLORS.dim
                        }
                        strokeWidth={2.3}
                      />
                      <Text
                        style={[
                          styles.submitBtnText,
                          reference.trim().length < 4 && { color: COLORS.dim },
                        ]}
                      >
                        Confirmer {localFormatted}
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function validLocalLabel(
  localAmount: number,
  currency: Parameters<typeof formatLocalAmount>[1]
): string {
  return localAmount > 0 ? formatLocalAmount(localAmount, currency) : "";
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: COLORS.deep,
  },
  content: {
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 28,
  },
  guestWrap: {
    paddingHorizontal: 8,
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
    fontSize: 12,
    fontWeight: "700",
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
    fontSize: 10,
    fontWeight: "500",
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
    fontSize: 9.5,
    fontWeight: "500",
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
  amountHint: { marginTop: 8, textAlign: "center", fontSize: 10, color: COLORS.mist },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: COLORS.dim, alignItems: "center", justifyContent: "center" },
  radioSelected: { borderColor: COLORS.betclicRed },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.betclicRed },
  summary: { marginTop: 12, gap: 5 },
  summaryLine: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  summaryLabel: { fontSize: 10.5, color: COLORS.mist },
  summaryValue: { fontSize: 10.5, color: COLORS.ink },
  amountInput: {
    flex: 1,
    textAlign: "center",
    fontSize: 23,
    fontWeight: "700",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
    paddingVertical: 0,
  },
  euroSymbol: {
    fontSize: 12,
    fontWeight: "500",
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
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  methodsGrid: {
    marginTop: 8,
    gap: 6,
  },
  methodCell: {
    width: "100%",
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
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.ink,
  },
  methodSub: {
    fontSize: 9.5,
    color: COLORS.dim,
  },
  refInput: {
    marginTop: 6,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "rgba(241,243,245,0.65)",
    paddingHorizontal: 12,
    fontSize: 11,
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
    fontSize: 10,
    fontWeight: "500",
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
    fontSize: 11,
    fontWeight: "500",
    color: "#ffffff",
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(9, 13, 22, 0.54)",
  },
  sheetCard: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
  },
  sheetGrabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#d1d5db",
    marginBottom: 10,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sheetTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.ink,
  },
  sheetSub: {
    marginTop: 2,
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.mist,
  },
  sheetCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetHintBox: {
    borderRadius: 10,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  sheetHintText: {
    fontSize: 10.5,
    lineHeight: 16,
    color: COLORS.mist,
  },
  doneWrap: {
    marginTop: 14,
    alignItems: "center",
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
    fontSize: 12.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  doneSub: {
    marginTop: 4,
    fontSize: 10.5,
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
    borderRadius: 10,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  grayBtnText: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.ink,
  },
  redBtn: {
    borderRadius: 10,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  redBtnText: {
    fontSize: 10.5,
    fontWeight: "500",
    color: "#ffffff",
  },
  guestTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.ink,
    textAlign: "center",
    marginBottom: 12,
  },
});
