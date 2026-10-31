"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { Building2, Check, CreditCard, Gift, Loader2, Lock, Smartphone, Wallet, X } from "lucide-react";
import { ApiRequestError, api, type PaymentProvider } from "@/lib/api";
import {
  formatLocalAmount,
  formatPresetChip,
  localToEur,
} from "@/lib/countries";
import {
  DepositCheckoutSheet,
  type DepositCheckoutSheetSession,
} from "@/components/deposit-checkout-sheet";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import { generateIdempotencyKey } from "@/lib/odds-lock";
import { useApp } from "@/components/providers";
import { cn, eur } from "@/lib/format";
import {
  GIFT_CARDS,
  GiftCardId,
  getGiftCardDef,
  validateGiftCard,
} from "@/lib/gift-cards";

type DepositMethod = "mobile_money" | "sepa" | "gift_card" | "stripe" | "paypal";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RechargeModal({ open, onClose }: Props) {
  return <AnimatePresence>{open && <RechargeSheet onClose={onClose} />}</AnimatePresence>;
}

function RechargeSheet({ onClose }: { onClose: () => void }) {
  const { toast, balance, user, bumpBets, countryConfig, currency, currencyConfig } =
    useApp();
  const dragControls = useDragControls();
  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  const [paypalClientId, setPaypalClientId] = useState<string | null>(null);
  const [stripePublishableKey, setStripePublishableKey] = useState<
    string | null
  >(null);
  const [checkoutSession, setCheckoutSession] =
    useState<DepositCheckoutSheetSession | null>(null);
  const popupWindowRef = useRef<Window | null>(null);
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
  const [selectedGiftCardId, setSelectedGiftCardId] = useState<GiftCardId>("transcash");
  const [giftCardCode, setGiftCardCode] = useState("");
  const giftCardDef = getGiftCardDef(selectedGiftCardId);
  const giftValidation = validateGiftCard(selectedGiftCardId, giftCardCode);
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
        setPaypalClientId(r.paypalClientId ?? null);
        setStripePublishableKey(r.stripePublishableKey ?? null);
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

  const parsed = Number(amountText.replace(",", "."));
  const localAmount =
    Number.isFinite(parsed) && parsed > 0
      ? currencyConfig.decimals === 0
        ? Math.round(parsed)
        : Math.round(parsed * 100) / 100
      : 0;
  const amount = localToEur(localAmount, currency);
  const isManual = method === "mobile_money" || method === "sepa" || method === "gift_card";
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

  const canSubmit =
    !loading &&
    validAmount &&
    (isManual ? (method === "gift_card" ? giftValidation.valid : reference.trim().length >= 4) : Boolean(onlineProvider?.enabled));

  const submit = async () => {
    if (!canSubmit || inFlightRef.current) return;
    inFlightRef.current = true;
    const cleanRef = reference.trim();
    const sig = `${method}:${isManual ? cleanRef : "online"}:${amount}`;
    if (!idempotencySlotRef.current || idempotencySlotRef.current.sig !== sig) {
      idempotencySlotRef.current = {
        key: generateIdempotencyKey("dep"),
        sig,
      };
    }
    const idempotencyKey = idempotencySlotRef.current.key;

    setLoading(true);
    setError(null);
    try {
      if (method === "gift_card") {
        if (!giftValidation.valid) {
          setError(giftValidation.error ?? "Code invalide");
          inFlightRef.current = false;
          setLoading(false);
          return;
        }
        await api.payments.manual({
          method: "gift_card",
          cardType: selectedGiftCardId,
          code: giftValidation.cleaned,
          amount,
          idempotencyKey,
        });
        idempotencySlotRef.current = null;
        playUiSound(user?.sound, "bet");
        triggerHaptic(user?.haptics, [18, 28]);
        bumpBets();
        setDoneManual(true);
        inFlightRef.current = false;
        setLoading(false);
        return;
      }
      if (method === "mobile_money" || method === "sepa") {
        await api.payments.manual({
          method,
          reference: cleanRef,
          amount,
          idempotencyKey,
        });
        idempotencySlotRef.current = null;
        playUiSound(user?.sound, "bet");
        triggerHaptic(user?.haptics, [18, 28]);
        bumpBets();
        setDoneManual(true);
        inFlightRef.current = false;
        setLoading(false);
        return;
      }
      const useEmbeddedStripe =
        method === "stripe" && Boolean(stripePublishableKey);
      let preOpenedPopup: Window | null = null;
      if (
        method === "stripe" &&
        !useEmbeddedStripe &&
        typeof window !== "undefined" &&
        !/PulseBetAndroid/i.test(window.navigator.userAgent)
      ) {
        const w = 460;
        const h = 680;
        const left = Math.max(0, Math.round((window.screen.width - w) / 2));
        const top = Math.max(0, Math.round((window.screen.height - h) / 2));
        preOpenedPopup = window.open(
          "about:blank",
          "pulse_deposit_checkout",
          `popup=yes,width=${w},height=${h},left=${left},top=${top}`
        );
        popupWindowRef.current = preOpenedPopup;
      }

      const r = await api.payments.create(method, amount, idempotencyKey, {
        uiMode: useEmbeddedStripe ? "embedded" : "hosted",
        returnPath: "/parametres/depot",
      });
      idempotencySlotRef.current = null;
      const localFormatted = formatLocalAmount(localAmount, currency);
      if (method === "paypal") {
        setCheckoutSession({
          kind: "paypal",
          amountLabel: localFormatted,
          providerRef: r.providerRef || "",
          checkoutUrl: r.url,
          paypalClientId,
          chargeCurrency: r.chargeCurrency || "EUR",
        });
      } else {
        if (preOpenedPopup && !preOpenedPopup.closed && r.url) {
          preOpenedPopup.location.assign(r.url);
        }
        setCheckoutSession({
          kind: "stripe",
          amountLabel: localFormatted,
          providerRef: r.providerRef || "",
          checkoutUrl: r.url,
          clientSecret: r.clientSecret ?? null,
          stripePublishableKey,
        });
      }
      inFlightRef.current = false;
      setLoading(false);
    } catch (e) {
      if (popupWindowRef.current && !popupWindowRef.current.closed) {
        try {
          popupWindowRef.current.close();
        } catch {
          /* ignore */
        }
      }
      popupWindowRef.current = null;
      if (e instanceof ApiRequestError && e.status >= 400 && e.status < 500) {
        idempotencySlotRef.current = null;
      }
      setError(e instanceof Error ? e.message : "Dépôt indisponible");
      inFlightRef.current = false;
      setLoading(false);
      toast({ kind: "error", title: "Dépôt impossible", description: "Vérifiez les informations" });
    }
  };

  if (checkoutSession) {
    return (
      <DepositCheckoutSheet
        session={checkoutSession}
        onClose={() => {
          setCheckoutSession(null);
          onClose();
        }}
        popupWindowRef={popupWindowRef}
      />
    );
  }

  const stripeInfo = providers.find((p) => p.id === "stripe");
  const paypalInfo = providers.find((p) => p.id === "paypal");

  return (
    <div className="fixed inset-0 z-[80]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={loading ? undefined : onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 36 }}
        drag={loading ? false : "y"}
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 550) onClose();
        }}
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[90dvh] w-full max-w-[440px] flex-col rounded-t-3xl border-t border-edge bg-surface shadow-2xl lg:inset-0 lg:m-auto lg:h-fit lg:max-h-[86dvh] lg:max-w-[480px] lg:rounded-3xl lg:border"
      >
        {doneManual ? (
          <div className="px-5 pb-7 pt-6 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-win/15 text-win">
              <Check className="h-7 w-7" strokeWidth={2.6} />
            </div>
            <h3 className="mt-3 font-display text-[13.5px] font-bold text-ink">
              Demande de dépôt transmise
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-mist">
              Votre dépôt de <strong className="text-ink">{eur(amount)}</strong> (
              {method === "mobile_money" ? "Mobile Money" : "Virement SEPA"}) sera crédité sur votre
              solde dès validation par l&apos;équipe.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 h-11 w-full rounded-2xl bg-betclic-red font-display text-[11.5px] font-medium text-white"
            >
              Parfait
            </button>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2">
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="mx-auto h-1 w-10 cursor-grab rounded-full bg-edge active:cursor-grabbing"
            />

            <div className="mt-3 flex items-center justify-between">
              <div>
                <h2 className="font-display text-[13.5px] font-bold tracking-tight text-ink">
                  Recharger mon solde
                </h2>
                <p className="text-[10.5px] text-dim">Actuel : {eur(balance)}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid h-8 w-8 place-items-center rounded-full bg-elev text-mist active:scale-95"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" strokeWidth={2.2} />
              </button>
            </div>

            <div className="mt-3.5">
              <label htmlFor="recharge-amount" className="text-[10.5px] font-medium text-mist">
                Montant du dépôt ({formatLocalAmount(effectiveMinLocal, currency)} à{" "}
                {formatLocalAmount(currencyConfig.maxDepositLocal, currency)})
              </label>
              <div
                className={cn(
                  "mt-1.5 flex h-12 items-center rounded-2xl border bg-white px-3.5",
                  validAmount ? "border-edge focus-within:border-ink" : "border-betclic-red"
                )}
              >
                <input
                  id="recharge-amount"
                  type="text"
                  inputMode={currencyConfig.decimals === 0 ? "numeric" : "decimal"}
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value.replace(/[^0-9.,]/g, ""))}
                  className="w-full bg-transparent font-display text-[14.5px] font-medium tabular-nums text-ink outline-none"
                  aria-label="Montant à recharger"
                />
                <span className="shrink-0 font-display text-[12px] font-medium text-dim">
                  {currencyConfig.symbol}
                </span>
              </div>

              <div className="mt-2 grid grid-cols-5 gap-1.5">
                {currencyConfig.depositPresetsLocal.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setAmountText(String(q))}
                    className={cn(
                      "h-8 rounded-xl border px-1 font-display text-[9.5px] font-medium transition-colors active:scale-95",
                      localAmount === q
                        ? "border-ink bg-ink text-white"
                        : "border-edge bg-elev text-ink"
                    )}
                  >
                    <span className="block truncate">{formatPresetChip(q, currency)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <p className="text-[10.5px] font-medium text-mist">Moyen de paiement</p>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <MethodCard
                  label="Mobile Money"
                  sub={countryConfig.mobileMoneyHint || "Transfert mobile instantané"}
                  badge="Actif"
                  Icon={Smartphone}
                  enabled
                  active={method === "mobile_money"}
                  onClick={() => {
                    setMethod("mobile_money");
                    setError(null);
                  }}
                />
                <MethodCard
                  label="Virement bancaire"
                  sub="IBAN / Réf. bancaire"
                  badge="Actif"
                  Icon={Building2}
                  enabled
                  active={method === "sepa"}
                  onClick={() => {
                    setMethod("sepa");
                    setError(null);
                  }}
                />
                <MethodCard
                  label="Cartes cadeaux"
                  sub="Transcash, PCS, Paysafe..."
                  badge="Nouveau"
                  Icon={Gift}
                  enabled
                  active={method === "gift_card"}
                  onClick={() => {
                    setMethod("gift_card");
                    setError(null);
                  }}
                />
                {stripeInfo?.enabled && (
                  <MethodCard
                    label="Carte bancaire"
                    sub="Stripe"
                    badge={stripeInfo.live ? "Live" : "Test"}
                    Icon={CreditCard}
                    enabled
                    active={method === "stripe"}
                    onClick={() => {
                      setMethod("stripe");
                      setError(null);
                    }}
                  />
                )}
                {paypalInfo?.enabled && (
                  <MethodCard
                    label="PayPal"
                    sub="Compte PayPal"
                    badge={paypalInfo.live ? "Live" : "Test"}
                    Icon={Wallet}
                    enabled
                    active={method === "paypal"}
                    onClick={() => {
                      setMethod("paypal");
                      setError(null);
                    }}
                  />
                )}
              </div>
            </div>

            {method === "gift_card" ? (
              <div className="mt-3.5 space-y-2.5">
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-[10.5px] font-medium text-mist">
                      Type de carte ({GIFT_CARDS.length})
                    </label>
                    <span className="text-[9.5px] text-dim">{giftCardDef.hint}</span>
                  </div>
                  <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                    {GIFT_CARDS.map((c) => {
                      const isSel = selectedGiftCardId === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setSelectedGiftCardId(c.id);
                            setError(null);
                          }}
                          className={cn(
                            "shrink-0 rounded-xl border px-2.5 py-1.5 text-left transition-colors",
                            isSel
                              ? "border-betclic-red bg-betclic-red/8 text-ink"
                              : "border-edge bg-elev text-mist hover:text-ink"
                          )}
                        >
                          <p className="font-display text-[11px] font-semibold">{c.shortLabel}</p>
                          <p className="text-[9px] text-dim">{c.expectedDigits ? `${c.expectedDigits} ch.` : c.hint}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="recharge-gift-code" className="text-[10.5px] font-medium text-mist">
                      Code {giftCardDef.label}
                    </label>
                    <span
                      className={cn(
                        "font-mono text-[10px] font-medium",
                        giftCardCode.length === 0
                          ? "text-dim"
                          : giftValidation.valid
                          ? "text-win"
                          : "text-betclic-red"
                      )}
                    >
                      {giftValidation.currentLength}/
                      {giftCardDef.minDigits && giftCardDef.maxDigits
                        ? `${giftCardDef.minDigits}-${giftCardDef.maxDigits}`
                        : giftCardDef.expectedDigits}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "mt-1.5 flex h-11 items-center rounded-2xl border px-3.5 transition-colors",
                      giftCardCode.length === 0
                        ? "border-edge bg-white focus-within:border-ink"
                        : giftValidation.valid
                        ? "border-win bg-win/5 focus-within:border-win"
                        : "border-betclic-red bg-betclic-red/5 focus-within:border-betclic-red"
                    )}
                  >
                    <input
                      id="recharge-gift-code"
                      type="text"
                      value={giftCardCode}
                      onChange={(e) => {
                        setGiftCardCode(e.target.value.toUpperCase());
                        setError(null);
                      }}
                      placeholder={`Ex : ${giftCardDef.placeholder}`}
                      className="w-full bg-transparent font-mono text-[13px] font-semibold tracking-wider text-ink outline-none"
                    />
                    {giftValidation.valid && (
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-win text-white">
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                    )}
                  </div>
                  {giftCardCode.length > 0 && !giftValidation.valid && (
                    <p className="mt-1 text-[10px] font-medium text-betclic-red">
                      {giftValidation.error}
                    </p>
                  )}
                </div>
              </div>
            ) : isManual ? (
              <div className="mt-3.5">
                <label className="text-[10.5px] font-medium text-mist">
                  {method === "mobile_money"
                    ? "Opérateur + numéro / réf. transfert"
                    : "Nom émetteur ou référence du virement"}
                </label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => {
                    setReference(e.target.value);
                    setError(null);
                  }}
                  placeholder={
                    method === "mobile_money"
                      ? `Ex : ${countryConfig.mobileMoneyHint || "Mobile Money"} · Réf 8492`
                      : "Ex : Virement Alex Martin · Réf PULSE-25"
                  }
                  className="mt-1.5 h-11 w-full rounded-2xl border border-edge bg-white px-3.5 text-[12px] font-medium text-ink outline-none focus:border-ink"
                />
              </div>
            ) : null}

            {error && (
              <p className="mt-3 rounded-xl bg-betclic-red/8 px-3 py-2 text-[10.5px] font-medium text-betclic-red">
                {error}
              </p>
            )}

            <button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
              className={cn(
                "mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl font-display text-[12px] font-medium transition-all active:scale-[0.99]",
                canSubmit ? "bg-betclic-red text-white shadow-sm" : "bg-elev text-dim"
              )}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
              ) : isManual ? (
                <>Déclarer mon dépôt · {eur(validAmount ? amount : 0)}</>
              ) : (
                <>Continuer · {eur(validAmount ? amount : 0)}</>
              )}
            </button>

            <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[10px] text-dim">
              <Lock className="h-3 w-3" strokeWidth={2.2} />
              {isManual
                ? "Vérification rapide et crédit sécurisé dans votre portefeuille"
                : "Transaction chiffrée · crédit immédiat"}
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function MethodCard({
  label,
  sub,
  badge,
  Icon,
  enabled,
  active,
  onClick,
}: {
  label: string;
  sub: string;
  badge?: string;
  Icon: typeof CreditCard;
  enabled: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={enabled ? onClick : undefined}
      disabled={!enabled}
      className={cn(
        "relative flex flex-col items-start rounded-2xl border p-2.5 text-left transition-colors",
        active
          ? "border-betclic-red bg-betclic-red/6"
          : "border-edge bg-white active:bg-elev"
      )}
    >
      <div className="flex w-full items-center justify-between">
        <span
          className={cn(
            "grid h-7 w-7 place-items-center rounded-xl",
            active ? "bg-betclic-red text-white" : "bg-elev text-ink"
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
        </span>
        {badge && (
          <span className="rounded bg-win/12 px-1.5 py-0.5 font-display text-[9px] font-medium uppercase text-win">
            {badge}
          </span>
        )}
      </div>
      <span className="mt-1.5 font-display text-[11px] font-medium text-ink">{label}</span>
      <span className="truncate text-[10px] text-dim">{sub}</span>
    </button>
  );
}
