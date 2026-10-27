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
import * as WebBrowser from "expo-web-browser";
import { CreditCard, Landmark, Smartphone, Wallet, X } from "@/components/icons";
import { api } from "@/lib/api";
import { eur } from "@/lib/format";
import { colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

const AMOUNTS = [10, 25, 50, 100, 250];

export function RechargeModal() {
  const {
    rechargeOpen,
    closeRecharge,
    paymentProviders,
    setBalance,
    hapticsEnabled,
    toast,
  } = useApp();

  const [amount, setAmount] = useState<number>(25);
  const [provider, setProvider] = useState<
    "stripe" | "paypal" | "mobile_money" | "sepa"
  >("stripe");
  const [senderRef, setSenderRef] = useState("");
  const [phoneOrIban, setPhoneOrIban] = useState("");
  const [loading, setLoading] = useState(false);

  const selectedProviderInfo = paymentProviders.find((p) => p.id === provider);

  const handleDeposit = async () => {
    if (amount < 5 || loading) return;
    setLoading(true);
    try {
      if (provider === "stripe") {
        const res = await api.payments.stripeCheckout(amount);
        if (res.mode === "live_redirect" && res.url) {
          await WebBrowser.openBrowserAsync(res.url);
          closeRecharge();
          toast({
            kind: "info",
            title: "Paiement Stripe ouvert",
            subtitle: "Votre solde sera crédité dès confirmation du paiement.",
          });
        } else {
          if (typeof res.balance === "number") setBalance(res.balance);
          closeRecharge();
          toast({
            kind: "win",
            title: `+${eur(amount)} crédités`,
            subtitle: "Rechargement instantané effectué",
          });
        }
      } else if (provider === "paypal") {
        const res = await api.payments.paypalOrder(amount);
        if (res.mode === "live_redirect" && res.url) {
          await WebBrowser.openBrowserAsync(res.url);
          closeRecharge();
          toast({
            kind: "info",
            title: "PayPal ouvert",
            subtitle: "Validez dans votre navigateur sécurisé.",
          });
        } else {
          if (typeof res.balance === "number") setBalance(res.balance);
          closeRecharge();
          toast({
            kind: "win",
            title: `+${eur(amount)} crédités via PayPal`,
          });
        }
      } else {
        if (!senderRef.trim()) {
          toast({
            kind: "error",
            title: "Référence requise",
            subtitle: "Indiquez la référence de votre transfert.",
          });
          setLoading(false);
          return;
        }
        const res = await api.payments.manualRequest({
          provider,
          amount,
          senderRef: senderRef.trim(),
          phoneOrIban: phoneOrIban.trim() || undefined,
        });
        setSenderRef("");
        closeRecharge();
        toast({
          kind: "success",
          title: "Demande de dépôt transmise",
          subtitle: res.message,
        });
      }
    } catch (err) {
      toast({
        kind: "error",
        title: "Échec du dépôt",
        subtitle: err instanceof Error ? err.message : "Réessayez",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={rechargeOpen}
      transparent
      animationType="slide"
      onRequestClose={closeRecharge}
    >
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={closeRecharge} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView bounces={false} contentContainerStyle={styles.content}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>Déposer des fonds</Text>
              <Pressable onPress={closeRecharge} style={styles.closeBtn}>
                <X size={17} color={colors.ink} strokeWidth={2.4} />
              </Pressable>
            </View>

            <View style={styles.amountsGrid}>
              {AMOUNTS.map((a) => {
                const active = amount === a;
                return (
                  <Pressable
                    key={a}
                    onPress={() => {
                      triggerHaptic("light", hapticsEnabled);
                      setAmount(a);
                    }}
                    style={[styles.amountBtn, active && styles.amountBtnActive]}
                  >
                    <Text
                      style={[
                        styles.amountBtnText,
                        active && styles.amountBtnTextActive,
                      ]}
                    >
                      {a} €
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.providersGrid}>
              {(
                [
                  { id: "stripe", label: "Carte bancaire", Icon: CreditCard },
                  { id: "paypal", label: "PayPal", Icon: Wallet },
                  { id: "mobile_money", label: "Mobile Money", Icon: Smartphone },
                  { id: "sepa", label: "Virement SEPA", Icon: Landmark },
                ] as const
              ).map((m) => {
                const active = provider === m.id;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => {
                      triggerHaptic("light", hapticsEnabled);
                      setProvider(m.id);
                    }}
                    style={[styles.methodCard, active && styles.methodCardActive]}
                  >
                    <m.Icon
                      size={17}
                      color={active ? colors.betclicRed : colors.mist}
                      strokeWidth={2.3}
                    />
                    <Text
                      style={[
                        styles.methodLabel,
                        active && styles.methodLabelActive,
                      ]}
                    >
                      {m.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {(provider === "mobile_money" || provider === "sepa") && (
              <View style={styles.manualBox}>
                {selectedProviderInfo?.manualInstructions && (
                  <Text style={styles.instructionsText}>
                    Bénéficiaire :{" "}
                    {selectedProviderInfo.manualInstructions.beneficiary} ·{" "}
                    {selectedProviderInfo.manualInstructions.account}
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
                  placeholder="Référence / ID de transaction *"
                  placeholderTextColor={colors.dim}
                  style={styles.input}
                />
              </View>
            )}

            <Pressable
              disabled={loading || amount < 5}
              onPress={() => void handleDeposit()}
              style={[styles.submitBtn, loading && { opacity: 0.6 }]}
            >
              {loading ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.submitText}>
                  Créditer {eur(amount)}
                </Text>
              )}
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
    backgroundColor: "rgba(17, 24, 39, 0.48)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    maxHeight: "88%",
  },
  handle: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.edge,
    marginBottom: 8,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    gap: 13,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 17,
    fontWeight: "900",
    color: colors.ink,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  amountsGrid: {
    flexDirection: "row",
    gap: 7,
  },
  amountBtn: {
    flex: 1,
    height: 40,
    borderRadius: 11,
    backgroundColor: colors.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  amountBtnActive: {
    backgroundColor: colors.ink,
  },
  amountBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.ink,
  },
  amountBtnTextActive: {
    color: colors.white,
  },
  providersGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 8,
  },
  methodCard: {
    width: "48.6%",
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.edge,
    backgroundColor: colors.elev,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  methodCardActive: {
    backgroundColor: "rgba(225, 0, 20, 0.08)",
    borderColor: colors.betclicRed,
  },
  methodLabel: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: "700",
    color: colors.ink,
  },
  methodLabelActive: {
    color: colors.betclicRed,
    fontWeight: "800",
  },
  manualBox: {
    gap: 8,
    padding: 11,
    borderRadius: 12,
    backgroundColor: colors.elev,
  },
  instructionsText: {
    fontSize: 11.5,
    fontWeight: "600",
    color: colors.mist,
  },
  input: {
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.edge,
    paddingHorizontal: 11,
    fontSize: 13,
    color: colors.ink,
  },
  submitBtn: {
    height: 46,
    borderRadius: 13,
    backgroundColor: colors.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: {
    fontSize: 14.5,
    fontWeight: "900",
    color: colors.white,
  },
});
