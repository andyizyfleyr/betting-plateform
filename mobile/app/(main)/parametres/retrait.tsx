import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Check,
  CreditCard,
  History,
  Smartphone,
  Wallet,
} from "lucide-react-native";
import { useApp } from "@/context/app-context";
import { api, ApiHttpError } from "@/lib/api";
import { getCachedWallet } from "@/lib/entity-cache";
import { eur } from "@/lib/format";
import { createIdempotencyKey } from "@/lib/http";
import { useRouter } from "@/lib/router";
import { COLORS, triggerHaptic } from "@/theme/tokens";

const QUICK_AMOUNTS = [20, 50, 100, 250];

const METHODS = [
  {
    id: "mobile_money" as const,
    label: "Mobile Money",
    placeholder: "MTN / Moov / Orange · +229 01 …",
    hint: "Opérateur + numéro Mobile Money",
    Icon: Smartphone,
  },
  {
    id: "iban" as const,
    label: "Virement SEPA",
    placeholder: "FR76 3000 6000 0112 3456 7890 189",
    hint: "IBAN européen",
    Icon: Building2,
  },
  {
    id: "paypal" as const,
    label: "PayPal",
    placeholder: "votre.email@exemple.fr",
    hint: "Email du compte PayPal",
    Icon: Wallet,
  },
  {
    id: "card" as const,
    label: "Carte",
    placeholder: "Visa / Mastercard •••• 4242",
    hint: "4 derniers chiffres ou réf. carte",
    Icon: CreditCard,
  },
];

export default function WithdrawScreen() {
  const router = useRouter();
  const { balance, setBalance, toast, user, bumpBets, hapticsEnabled } =
    useApp();

  const [method, setMethod] =
    useState<(typeof METHODS)[number]["id"]>("mobile_money");
  const [destination, setDestination] = useState("");
  const [amountText, setAmountText] = useState("20");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const idempotencySlotRef = useRef<{ key: string; sig: string } | null>(null);

  const [eligibility, setEligibility] = useState(() => {
    const cached = getCachedWallet();
    if (!cached) return null;
    return {
      withdrawable: cached.summary.withdrawable ?? cached.balance,
      bonusLocked: cached.summary.bonusLocked ?? 0,
      qualifiedWagered: cached.summary.qualifiedWagered ?? 0,
      bonusRemaining: cached.summary.bonusRemaining ?? 0,
    };
  });

  useEffect(() => {
    if (!user) return;
    let active = true;
    api
      .wallet()
      .then((w) => {
        if (!active) return;
        setEligibility({
          withdrawable: w.summary.withdrawable ?? w.balance,
          bonusLocked: w.summary.bonusLocked ?? 0,
          qualifiedWagered: w.summary.qualifiedWagered ?? 0,
          bonusRemaining: w.summary.bonusRemaining ?? 0,
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user]);

  if (!user) {
    return (
      <View style={[styles.page, styles.guestWrap]}>
        <View style={styles.card}>
          <Text style={styles.guestTitle}>
            Connectez-vous pour retirer vos gains
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

  const withdrawable = eligibility ? eligibility.withdrawable : balance;
  const bonusRemaining = eligibility?.bonusRemaining ?? 0;
  const bonusLocked = eligibility?.bonusLocked ?? 0;
  const qualifiedWagered = eligibility?.qualifiedWagered ?? 0;
  const progressPct =
    bonusLocked > 0
      ? Math.min(100, Math.round((qualifiedWagered / bonusLocked) * 100))
      : 100;

  const currentMethod = METHODS.find((m) => m.id === method) ?? METHODS[0];
  const parsed = Number(amountText.replace(",", "."));
  const amount =
    Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
  const overWithdrawable = amount > withdrawable;
  const belowMin = amount > 0 && amount < 10;

  const canSubmit =
    !loading &&
    amount >= 10 &&
    !overWithdrawable &&
    destination.trim().length >= 4;

  const submit = async () => {
    if (!canSubmit || inFlightRef.current) return;
    inFlightRef.current = true;
    const cleanDest = destination.trim();
    const sig = `${method}:${cleanDest}:${amount}`;
    if (!idempotencySlotRef.current || idempotencySlotRef.current.sig !== sig) {
      idempotencySlotRef.current = {
        key: createIdempotencyKey("wd"),
        sig,
      };
    }
    const idempotencyKey = idempotencySlotRef.current.key;

    setLoading(true);
    setError(null);
    try {
      const res = await api.requestWithdrawal({
        method,
        destination: cleanDest,
        amount,
        idempotencyKey,
      });
      idempotencySlotRef.current = null;
      setBalance(res.balance);
      bumpBets();
      triggerHaptic("success", hapticsEnabled);
      setDone(true);
      toast({
        kind: "success",
        title: "Demande de retrait enregistrée",
        description: `${eur(amount)} réservés en attente de validation`,
      });
    } catch (err) {
      if (err instanceof ApiHttpError && err.status >= 400 && err.status < 500) {
        idempotencySlotRef.current = null;
      }
      setError(err instanceof Error ? err.message : "Retrait impossible");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* En-tête compact identique à src/app/(main)/parametres/retrait/page.tsx */}
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
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={styles.headerTitle}>
              Retirer mes gains
            </Text>
            <Text numberOfLines={1} style={styles.headerSub}>
              Retirable : {eur(withdrawable)}
            </Text>
          </View>
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
        {done ? (
          <View style={[styles.card, { alignItems: "center" }]}>
            <View style={styles.doneCircle}>
              <Check size={20} color={COLORS.win} strokeWidth={2.6} />
            </View>
            <Text style={styles.doneTitle}>Demande transmise</Text>
            <Text style={styles.doneSub}>
              Votre retrait de{" "}
              <Text style={{ fontWeight: "700", color: COLORS.ink }}>
                {eur(amount)}
              </Text>{" "}
              vers{" "}
              <Text style={{ fontWeight: "700", color: COLORS.ink }}>
                {destination.trim()}
              </Text>{" "}
              est en cours de traitement.
            </Text>
            <View style={styles.doneBtns}>
              <Pressable
                onPress={() => router.push("/parametres/transactions")}
                style={styles.grayBtn}
              >
                <Text style={styles.grayBtnText}>Transactions</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push("/parametres")}
                style={styles.redBtn}
              >
                <Text style={styles.redBtnText}>Compte</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {bonusRemaining > 0 ? (
              <View style={styles.card}>
                <View style={styles.bonusRow}>
                  <Text style={styles.bonusLeft}>
                    Déblocage bonus ({progressPct}%)
                  </Text>
                  <Text style={styles.bonusRight}>
                    Reste {eur(bonusRemaining)}
                  </Text>
                </View>
                <View style={styles.bonusTrack}>
                  <View
                    style={[styles.bonusFill, { width: `${progressPct}%` }]}
                  />
                </View>
              </View>
            ) : null}

            <View style={[styles.card, { gap: 10 }]}>
              <View>
                <Text style={styles.fieldCaps}>
                  MONTANT DU RETRAIT (MIN. 10 €)
                </Text>
                <View style={styles.amountInputWrap}>
                  <TextInput
                    value={amountText}
                    onChangeText={setAmountText}
                    keyboardType="decimal-pad"
                    placeholder="20"
                    placeholderTextColor={COLORS.dim}
                    style={styles.amountInput}
                  />
                  <Text style={styles.euroSymbol}>€</Text>
                </View>

                <View style={styles.quickGrid}>
                  {QUICK_AMOUNTS.map((q) => (
                    <Pressable
                      key={q}
                      onPress={() => setAmountText(String(q))}
                      style={[
                        styles.quickChip,
                        amount === q && styles.quickChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.quickChipText,
                          amount === q && { color: "#ffffff" },
                        ]}
                      >
                        {q} €
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {belowMin ? (
                  <Text style={styles.inlineWarn}>
                    Minimum de retrait : 10,00 €.
                  </Text>
                ) : null}
                {overWithdrawable ? (
                  <Text style={styles.inlineWarn}>
                    Dépasse le solde retirable ({eur(withdrawable)}).
                  </Text>
                ) : null}
              </View>

              <View>
                <Text style={styles.fieldCaps}>CANAL DE RÉCEPTION</Text>
                <View style={styles.methodsGrid}>
                  {METHODS.map((m) => {
                    const active = method === m.id;
                    return (
                      <Pressable
                        key={m.id}
                        onPress={() => setMethod(m.id)}
                        style={[
                          styles.methodCell,
                          active && styles.methodCellSelected,
                        ]}
                      >
                        <m.Icon
                          size={14}
                          color={active ? COLORS.betclicRed : COLORS.mist}
                          strokeWidth={2.2}
                        />
                        <Text numberOfLines={1} style={styles.methodLabel}>
                          {m.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View>
                <Text style={styles.fieldCaps}>
                  {currentMethod.hint.toUpperCase()}
                </Text>
                <TextInput
                  value={destination}
                  onChangeText={setDestination}
                  placeholder={currentMethod.placeholder}
                  placeholderTextColor={COLORS.dim}
                  style={styles.destInput}
                />
              </View>

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
                    <ArrowUpRight
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
                      Retirer {amount >= 10 ? eur(amount) : ""}
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
    fontSize: 14.5,
    fontWeight: "800",
    color: COLORS.ink,
  },
  headerSub: {
    fontSize: 10.5,
    color: COLORS.dim,
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
  bonusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  bonusLeft: {
    fontSize: 10.5,
    color: COLORS.mist,
  },
  bonusRight: {
    fontSize: 10.5,
    fontWeight: "600",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  bonusTrack: {
    marginTop: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    overflow: "hidden",
  },
  bonusFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: COLORS.betclicRed,
  },
  fieldCaps: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: COLORS.mist,
  },
  amountInputWrap: {
    marginTop: 4,
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
  inlineWarn: {
    marginTop: 4,
    fontSize: 10.5,
    fontWeight: "600",
    color: COLORS.betclicRed,
  },
  methodsGrid: {
    marginTop: 6,
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
    gap: 6,
  },
  methodCellSelected: {
    borderColor: COLORS.betclicRed,
    backgroundColor: "rgba(225,0,20,0.08)",
  },
  methodLabel: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  destInput: {
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
    height: 40,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  submitBtnReady: {
    backgroundColor: COLORS.betclicRed,
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
