import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ArrowUpRight,
  CreditCard,
  Smartphone,
  Wallet,
  X,
} from "lucide-react-native";
import { useApp } from "@/context/app-context";
import { api, ApiHttpError, generateIdempotencyKey } from "@/lib/api";
import {
  formatLocalAmount,
  formatPresetChip,
  localToEur,
} from "@/lib/countries";
import { eur } from "@/lib/format";
import { openInAppUrl } from "@/lib/external-url";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

export function RechargeModal() {
  const router = useRouter();
  const {
    rechargeOpen,
    closeRecharge,
    balance,
    paymentProviders,
    toast,
    countryConfig,
    currency,
    currencyConfig,
  } = useApp();

  const [prevCur, setPrevCur] = useState(currency);
  const [amount, setAmount] = useState(() =>
    String(currencyConfig.defaultDepositLocal)
  );
  if (prevCur !== currency) {
    setPrevCur(currency);
    setAmount(String(currencyConfig.defaultDepositLocal));
  }
  const [method, setMethod] = useState<
    "stripe" | "paypal" | "mobile_money" | "sepa"
  >("mobile_money");
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);

  if (!rechargeOpen) return null;

  const rawLocal = Math.max(0, parseFloat(amount.replace(",", ".")) || 0);
  const localAmount =
    currencyConfig.decimals === 0
      ? Math.round(rawLocal)
      : Math.round(rawLocal * 100) / 100;
  const numAmount = localToEur(localAmount, currency);
  const isManual = method === "mobile_money" || method === "sepa";
  const effectiveMinLocal = isManual
    ? currencyConfig.minDepositLocal
    : Math.max(
        currencyConfig.minDepositLocal,
        currencyConfig.decimals === 0
          ? Math.ceil(0.5 * currencyConfig.rateFromEur)
          : Math.ceil(0.5 * currencyConfig.rateFromEur * 100) / 100
      );

  const stripeEnabled = paymentProviders.some(
    (p) => p.id === "stripe" && p.enabled
  );
  const paypalEnabled = paymentProviders.some(
    (p) => p.id === "paypal" && p.enabled
  );

  const handleSubmit = async () => {
    if (localAmount < effectiveMinLocal) {
      toast({
        kind: "error",
        title: `Montant minimum : ${formatLocalAmount(effectiveMinLocal, currency)}`,
      });
      return;
    }
    if (localAmount > currencyConfig.maxDepositLocal) {
      toast({
        kind: "error",
        title: `Montant maximum : ${formatLocalAmount(currencyConfig.maxDepositLocal, currency)}`,
      });
      return;
    }

    setLoading(true);
    try {
      const idem = generateIdempotencyKey("dep");
      if (method === "stripe" || method === "paypal") {
        const res = await api.payments.create(method, numAmount, idem, {
          returnPath: "/parametres/depot",
        });
        if (res.url) {
          closeRecharge();
          openInAppUrl(res.url, {
            title:
              method === "paypal" ? "Paiement PayPal" : "Paiement par carte",
            provider: method,
            providerRef: res.providerRef,
            amountLabel: formatLocalAmount(localAmount, currency),
          });
          return;
        }
      } else {
        if (reference.trim().length < 4) {
          toast({
            kind: "error",
            title: "Référence requise",
            description:
              "Saisissez la référence de votre transfert (4 caractères min.).",
          });
          setLoading(false);
          return;
        }
        await api.payments.manual({
          method,
          reference: reference.trim(),
          amount: numAmount,
          idempotencyKey: idem,
        });
        toast({
          kind: "success",
          title: "Demande de dépôt transmise",
          description: `Votre dépôt de ${eur(numAmount)} sera crédité dès validation.`,
        });
        setReference("");
        closeRecharge();
      }
    } catch (err) {
      toast({
        kind: "error",
        title: "Dépôt indisponible",
        description:
          err instanceof ApiHttpError ? err.message : "Veuillez réessayer.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={closeRecharge}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeRecharge} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.topRow}>
            <View>
              <Text style={styles.title}>Recharger mon compte</Text>
              <Text style={styles.sub}>Solde actuel : {eur(balance)}</Text>
            </View>
            <Pressable onPress={closeRecharge} style={styles.closeBtn}>
              <X size={17} color={COLORS.mist} strokeWidth={2.2} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.body}
          >
            <View style={styles.chipsRow}>
              {currencyConfig.depositPresetsLocal.map((a) => {
                const active = Math.abs(localAmount - a) < 0.01;
                return (
                  <Pressable
                    key={a}
                    onPress={() => setAmount(String(a))}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.chipText,
                        active && styles.chipTextActive,
                      ]}
                    >
                      {formatPresetChip(a, currency)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType={
                currencyConfig.decimals === 0 ? "number-pad" : "decimal-pad"
              }
              placeholder={`Montant en ${currencyConfig.symbol}`}
              placeholderTextColor={COLORS.dim}
              style={styles.input}
            />

            <View style={styles.methodsGrid}>
              <Pressable
                onPress={() => setMethod("mobile_money")}
                style={[
                  styles.methodBtn,
                  method === "mobile_money" && styles.methodBtnActive,
                ]}
              >
                <Smartphone
                  size={16}
                  color={
                    method === "mobile_money" ? COLORS.betclicRed : COLORS.mist
                  }
                />
                <Text style={styles.methodLabel}>Mobile Money</Text>
              </Pressable>

              <Pressable
                onPress={() => setMethod("sepa")}
                style={[
                  styles.methodBtn,
                  method === "sepa" && styles.methodBtnActive,
                ]}
              >
                <Wallet
                  size={16}
                  color={method === "sepa" ? COLORS.betclicRed : COLORS.mist}
                />
                <Text style={styles.methodLabel}>Virement bancaire</Text>
              </Pressable>

              {stripeEnabled ? (
                <Pressable
                  onPress={() => setMethod("stripe")}
                  style={[
                    styles.methodBtn,
                    method === "stripe" && styles.methodBtnActive,
                  ]}
                >
                  <CreditCard
                    size={16}
                    color={
                      method === "stripe" ? COLORS.betclicRed : COLORS.mist
                    }
                  />
                  <Text style={styles.methodLabel}>Carte bancaire</Text>
                </Pressable>
              ) : null}

              {paypalEnabled ? (
                <Pressable
                  onPress={() => setMethod("paypal")}
                  style={[
                    styles.methodBtn,
                    method === "paypal" && styles.methodBtnActive,
                  ]}
                >
                  <CreditCard
                    size={16}
                    color={
                      method === "paypal" ? COLORS.betclicRed : COLORS.mist
                    }
                  />
                  <Text style={styles.methodLabel}>PayPal</Text>
                </Pressable>
              ) : null}
            </View>

            {method === "mobile_money" || method === "sepa" ? (
              <TextInput
                value={reference}
                onChangeText={setReference}
                placeholder={
                  method === "mobile_money"
                    ? `${countryConfig.mobileMoneyHint || "Mobile Money"} · Réf TXN`
                    : "Référence du virement bancaire"
                }
                placeholderTextColor={COLORS.dim}
                style={styles.input}
              />
            ) : null}

            <Pressable
              disabled={loading}
              onPress={handleSubmit}
              style={[styles.submitBtn, loading && { opacity: 0.65 }]}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.submitText}>
                  Déposer {eur(numAmount)}
                </Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => {
                closeRecharge();
                router.push("/parametres/depot");
              }}
              style={styles.fullPageLink}
            >
              <Text style={styles.fullPageText}>
                Ouvrir la page Dépôt complète
              </Text>
              <ArrowUpRight size={14} color={COLORS.mist} strokeWidth={2.2} />
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    maxHeight: "88%",
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.edge,
    marginBottom: 10,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: {
    fontSize: 12.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  sub: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.dim,
    marginTop: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    gap: 11,
  },
  chipsRow: {
    flexDirection: "row",
    gap: 6,
  },
  chip: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: COLORS.betclicRed,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.ink,
  },
  chipTextActive: {
    color: "#ffffff",
  },
  input: {
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    borderWidth: 1,
    borderColor: COLORS.edge,
    paddingHorizontal: 13,
    fontSize: 11.5,
    fontWeight: "500",
    color: COLORS.ink,
  },
  methodsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  methodBtn: {
    width: "48.5%",
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    borderWidth: 1.5,
    borderColor: "transparent",
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  methodBtnActive: {
    borderColor: COLORS.betclicRed,
    backgroundColor: "rgba(225, 0, 20, 0.06)",
  },
  methodLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.ink,
  },
  submitBtn: {
    height: 48,
    borderRadius: 13,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#ffffff",
  },
  fullPageLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 6,
  },
  fullPageText: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.mist,
  },
});
