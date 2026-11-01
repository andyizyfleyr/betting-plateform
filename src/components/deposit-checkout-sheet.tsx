"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import {
  Check,
  ExternalLink,
  Loader2,
  Lock,
  X,
} from "lucide-react";
import { ApiRequestError, api } from "@/lib/api";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import { generateIdempotencyKey } from "@/lib/odds-lock";
import { useApp } from "@/components/providers";
import { cn } from "@/lib/format";
import {
  GIFT_CARDS,
  GiftCardId,
  getGiftCardDef,
  validateGiftCard,
} from "@/lib/gift-cards";
import { Gift } from "lucide-react";
import { GiftCardMark } from "@/components/gift-card-mark";
import { MobileMoneyBrandStrip } from "@/components/mobile-money-brand-strip";

export type DepositCheckoutSheetSession =
  | {
      kind: "manual";
      method: "mobile_money" | "sepa" | "gift_card";
      initialCardType?: GiftCardId;
      amountEur: number;
      amountLabel: string;
      initialReference?: string;
    }
  | {
      kind: "stripe";
      amountLabel: string;
      providerRef: string;
      checkoutUrl: string | null;
      clientSecret?: string | null;
      stripePublishableKey?: string | null;
    }
  | {
      kind: "paypal";
      amountLabel: string;
      providerRef: string;
      checkoutUrl: string | null;
      paypalClientId?: string | null;
      chargeCurrency?: string;
    }
  | {
      kind: "verifying";
      provider: "stripe" | "paypal";
      providerRef: string;
      amountLabel?: string;
    };

interface Props {
  session: DepositCheckoutSheetSession | null;
  onClose: () => void;
  popupWindowRef?: React.MutableRefObject<Window | null>;
}

interface PayPalNamespace {
  Buttons?: (opts: {
    style?: Record<string, unknown>;
    createOrder: () => Promise<string> | string;
    onApprove: (data: { orderID?: string }) => Promise<void>;
    onCancel?: () => void;
    onError?: () => void;
  }) => { render: (el: HTMLElement) => Promise<void>; close?: () => void };
}

interface StripeEmbeddedCheckoutInstance {
  mount: (el: HTMLElement) => void;
  destroy: () => void;
}

interface StripeClientInstance {
  initEmbeddedCheckout: (opts: {
    clientSecret: string;
  }) => Promise<StripeEmbeddedCheckoutInstance>;
}

function loadExternalScript(src: string, attrKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("SSR"));
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-pulse-sdk="${attrKey}"]`
    );
    if (existing) {
      if (existing.dataset.loaded === "1") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("SDK load error")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.pulseSdk = attrKey;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error("SDK load error"));
    document.head.appendChild(script);
  });
}

export function DepositCheckoutSheet({
  session,
  onClose,
  popupWindowRef,
}: Props) {
  return (
    <AnimatePresence>
      {session ? (
        <DepositCheckoutSheetBody
          key={`${session.kind}-${"providerRef" in session ? session.providerRef : session.method}`}
          session={session}
          onClose={onClose}
          popupWindowRef={popupWindowRef}
        />
      ) : null}
    </AnimatePresence>
  );
}

function DepositCheckoutSheetBody({
  session,
  onClose,
  popupWindowRef,
}: {
  session: DepositCheckoutSheetSession;
  onClose: () => void;
  popupWindowRef?: React.MutableRefObject<Window | null>;
}) {
  const { applyUser, bumpBets, countryConfig, setBalance, toast, user } =
    useApp();
  const dragControls = useDragControls();

  const [reference, setReference] = useState(
    session.kind === "manual" ? session.initialReference ?? "" : ""
  );
  const [selectedGiftCardId, setSelectedGiftCardId] = useState<GiftCardId>(
    session.kind === "manual" && session.initialCardType
      ? session.initialCardType
      : "transcash"
  );
  const [giftCardCode, setGiftCardCode] = useState(
    session.kind === "manual" && session.initialReference ? session.initialReference : ""
  );
  const giftCardDef = getGiftCardDef(selectedGiftCardId);
  const giftValidation = validateGiftCard(selectedGiftCardId, giftCardCode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedKind, setCompletedKind] = useState<
    "credited" | "manual_recorded" | null
  >(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkFailed, setSdkFailed] = useState(false);

  const paypalContainerRef = useRef<HTMLDivElement | null>(null);
  const stripeContainerRef = useRef<HTMLDivElement | null>(null);
  const inFlightRef = useRef(false);
  const idempotencySlotRef = useRef<{ key: string; sig: string } | null>(null);
  const handledCompleteRef = useRef(false);

  const closePopupIfOpen = useCallback(() => {
    try {
      if (popupWindowRef?.current && !popupWindowRef.current.closed) {
        popupWindowRef.current.close();
      }
      if (popupWindowRef) {
        popupWindowRef.current = null;
      }
    } catch {
      /* ignore */
    }
  }, [popupWindowRef]);

  const refreshWalletState = useCallback(async () => {
    try {
      const [settingsRes, walletRes] = await Promise.all([
        api.settings().catch(() => null),
        api.wallet({ forceRefresh: true }).catch(() => null),
      ]);
      if (settingsRes?.user) {
        applyUser(settingsRes.user);
      } else if (walletRes && typeof walletRes.balance === "number") {
        setBalance(walletRes.balance);
      }
      bumpBets();
    } catch {
      /* ignore */
    }
  }, [applyUser, bumpBets, setBalance]);

  const markOnlineCredited = useCallback(async () => {
    if (handledCompleteRef.current) return;
    handledCompleteRef.current = true;
    closePopupIfOpen();
    await refreshWalletState();
    playUiSound(user?.sound, "win");
    triggerHaptic(user?.haptics, [18, 28]);
    setCompletedKind("credited");
    toast({ kind: "success", title: "Solde rechargé" });
  }, [closePopupIfOpen, refreshWalletState, toast, user?.haptics, user?.sound]);

  const capturePayPalOrder = useCallback(
    async (orderId: string) => {
      if (!orderId || handledCompleteRef.current) return;
      setSubmitting(true);
      setError(null);
      try {
        const safeToken = orderId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
        const idemKey =
          safeToken.length >= 6
            ? `ppcap_${safeToken}_v1`
            : generateIdempotencyKey("ppcap");
        const r = await api.payments.capturePayPal(orderId, idemKey);
        if (r.user) applyUser(r.user);
        await markOnlineCredited();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Validation PayPal non confirmée"
        );
      } finally {
        setSubmitting(false);
      }
    },
    [applyUser, markOnlineCredited]
  );

  // Vérification initiale lors d'un retour URL `?deposit=stripe|paypal` sur `/parametres/depot`
  useEffect(() => {
    if (session.kind !== "verifying") return;
    let cancelled = false;

    if (session.provider === "paypal") {
      queueMicrotask(() => {
        if (!cancelled) void capturePayPalOrder(session.providerRef);
      });
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      for (let i = 0; i < 8; i++) {
        if (cancelled || handledCompleteRef.current) return;
        try {
          const st = await api.payments.status(session.providerRef);
          if (st.credited) {
            await markOnlineCredited();
            return;
          }
        } catch {
          /* retry */
        }
        await new Promise((r) => setTimeout(r, 1_300));
      }
      if (!cancelled && !handledCompleteRef.current) {
        setError(
          "Vérification toujours en cours. Votre solde sera mis à jour automatiquement."
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [capturePayPalOrder, markOnlineCredited, session]);

  // Montage Stripe Embedded Checkout directement dans le BottomSheet si `pk_...` + `clientSecret` présents
  useEffect(() => {
    if (
      session.kind !== "stripe" ||
      !session.clientSecret ||
      !session.stripePublishableKey ||
      completedKind
    ) {
      return;
    }
    let cancelled = false;
    let checkoutInstance: StripeEmbeddedCheckoutInstance | null = null;

    loadExternalScript("https://js.stripe.com/v3/", "stripe-v3")
      .then(async () => {
        if (cancelled || !stripeContainerRef.current) return;
        const win = window as unknown as {
          Stripe?: (pk: string) => StripeClientInstance;
        };
        if (typeof win.Stripe !== "function") {
          setSdkFailed(true);
          return;
        }
        const stripe = win.Stripe(session.stripePublishableKey!);
        checkoutInstance = await stripe.initEmbeddedCheckout({
          clientSecret: session.clientSecret!,
        });
        if (cancelled || !stripeContainerRef.current) {
          checkoutInstance.destroy();
          return;
        }
        stripeContainerRef.current.innerHTML = "";
        checkoutInstance.mount(stripeContainerRef.current);
        setSdkReady(true);
      })
      .catch(() => {
        if (!cancelled) setSdkFailed(true);
      });

    return () => {
      cancelled = true;
      if (checkoutInstance) {
        try {
          checkoutInstance.destroy();
        } catch {
          /* ignore */
        }
      }
    };
  }, [completedKind, session]);

  // Montage des boutons officiels PayPal Smart Payment directement dans le BottomSheet
  useEffect(() => {
    if (
      session.kind !== "paypal" ||
      !session.paypalClientId ||
      completedKind
    ) {
      return;
    }
    let cancelled = false;
    const cur = (session.chargeCurrency || "EUR").toUpperCase();
    const sdkKey = `paypal-${session.paypalClientId.slice(0, 12)}-${cur}`;
    const sdkUrl = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      session.paypalClientId
    )}&currency=${encodeURIComponent(cur)}&intent=capture&commit=true`;

    loadExternalScript(sdkUrl, sdkKey)
      .then(async () => {
        if (cancelled || !paypalContainerRef.current) return;
        const win = window as unknown as { paypal?: PayPalNamespace };
        if (!win.paypal?.Buttons) {
          setSdkFailed(true);
          return;
        }
        paypalContainerRef.current.innerHTML = "";
        const buttons = win.paypal.Buttons({
          style: {
            layout: "vertical",
            shape: "rect",
            label: "pay",
            height: 42,
          },
          createOrder: () => session.providerRef,
          onApprove: async (data) => {
            await capturePayPalOrder(data.orderID || session.providerRef);
          },
          onError: () => {
            if (!cancelled) setSdkFailed(true);
          },
        });
        await buttons.render(paypalContainerRef.current);
        if (!cancelled) setSdkReady(true);
      })
      .catch(() => {
        if (!cancelled) setSdkFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [capturePayPalOrder, completedKind, session]);

  // Surveillance automatique en temps réel du statut Stripe pendant que le BottomSheet est ouvert
  useEffect(() => {
    if (session.kind !== "stripe" || completedKind) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (cancelled || handledCompleteRef.current) return;
      api.payments
        .status(session.providerRef)
        .then((st) => {
          if (!cancelled && st.credited) {
            void markOnlineCredited();
          }
        })
        .catch(() => {
          /* ignore */
        });
    }, 2_400);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [completedKind, markOnlineCredited, session]);

  const handleClose = () => {
    if (submitting) return;
    closePopupIfOpen();
    onClose();
  };

  const openOverlayWindow = (url: string | null) => {
    if (!url || typeof window === "undefined") return;
    const w = 460;
    const h = 680;
    const left = Math.max(0, Math.round((window.screen.width - w) / 2));
    const top = Math.max(0, Math.round((window.screen.height - h) / 2));
    const popup = window.open(
      url,
      "pulse_deposit_checkout",
      `popup=yes,width=${w},height=${h},left=${left},top=${top}`
    );
    if (popup && popupWindowRef) {
      popupWindowRef.current = popup;
      popup.focus();
      return;
    }
    window.location.assign(url);
  };

    const submitManual = async () => {
    if (session.kind !== "manual" || submitting || inFlightRef.current) return;

    if (session.method === "gift_card") {
      if (!giftValidation.valid) {
        setError(giftValidation.error ?? "Code invalide selon le format de la carte.");
        return;
      }
      inFlightRef.current = true;
      const sig = `gift_card:${selectedGiftCardId}:${giftValidation.cleaned}:${session.amountEur}`;
      if (!idempotencySlotRef.current || idempotencySlotRef.current.sig !== sig) {
        idempotencySlotRef.current = {
          key: generateIdempotencyKey("dep"),
          sig,
        };
      }
      setSubmitting(true);
      setError(null);
      try {
        await api.payments.manual({
          method: "gift_card",
          cardType: selectedGiftCardId,
          code: giftValidation.cleaned,
          amount: session.amountEur,
          idempotencyKey: idempotencySlotRef.current.key,
        });
        idempotencySlotRef.current = null;
        playUiSound(user?.sound, "bet");
        triggerHaptic(user?.haptics, [18, 28]);
        bumpBets();
        setCompletedKind("manual_recorded");
      } catch (e) {
        if (e instanceof ApiRequestError && e.status >= 400 && e.status < 500) {
          idempotencySlotRef.current = null;
        }
        setError(e instanceof Error ? e.message : "Dépôt indisponible");
      } finally {
        inFlightRef.current = false;
        setSubmitting(false);
      }
      return;
    }

    const cleanRef = reference.trim();
    if (cleanRef.length < 4) {
      setError("Saisissez la référence ou le numéro (4 caractères min.).");
      return;
    }
    inFlightRef.current = true;
    const sig = `${session.method}:${cleanRef}:${session.amountEur}`;
    if (!idempotencySlotRef.current || idempotencySlotRef.current.sig !== sig) {
      idempotencySlotRef.current = {
        key: generateIdempotencyKey("dep"),
        sig,
      };
    }

    setSubmitting(true);
    setError(null);
    try {
      await api.payments.manual({
        method: session.method,
        reference: cleanRef,
        amount: session.amountEur,
        idempotencyKey: idempotencySlotRef.current.key,
      });
      idempotencySlotRef.current = null;
      playUiSound(user?.sound, "bet");
      triggerHaptic(user?.haptics, [18, 28]);
      bumpBets();
      setCompletedKind("manual_recorded");
    } catch (e) {
      if (e instanceof ApiRequestError && e.status >= 400 && e.status < 500) {
        idempotencySlotRef.current = null;
      }
      setError(e instanceof Error ? e.message : "Dépôt indisponible");
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  const sheetTitle =
    session.kind === "manual"
      ? session.method === "mobile_money"
        ? "Dépôt Mobile Money"
        : session.method === "gift_card"
          ? "Dépôt Carte Cadeau & Ticket"
          : "Dépôt par virement bancaire"
      : session.kind === "paypal"
        ? "Paiement PayPal"
        : session.kind === "stripe"
          ? "Paiement par carte"
          : "Confirmation du paiement";

  const amountBadge =
    "amountLabel" in session && session.amountLabel ? session.amountLabel : "";

  return (
    <div className="fixed inset-0 z-[90]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={handleClose}
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 390, damping: 36 }}
        drag={submitting ? false : "y"}
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.45 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 550) handleClose();
        }}
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] w-full max-w-[460px] flex-col rounded-t-3xl border-t border-edge bg-surface shadow-2xl"
      >
        <div className="px-4 pt-2.5 pb-2">
          <div
            onPointerDown={(e) => dragControls.start(e)}
            className="mx-auto h-1 w-10 cursor-grab rounded-full bg-edge active:cursor-grabbing"
          />
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate font-display text-[12.5px] font-bold text-ink">
                {sheetTitle}
                {amountBadge ? ` · ${amountBadge}` : ""}
              </h2>
              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-mist">
                <Lock className="h-2.5 w-2.5 text-win" strokeWidth={2.4} />
                Transaction chiffrée sans quitter Déposer des fonds
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Fermer"
              className="grid h-7.5 w-7.5 shrink-0 place-items-center rounded-full bg-elev text-ink hover:bg-edge"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.3} />
            </button>
          </div>
        </div>

        <div className="h-px w-full bg-edge" />

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3.5 pb-6">
          {completedKind === "credited" ? (
            <div className="py-3 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-win/15 text-win">
                <Check className="h-6 w-6" strokeWidth={2.6} />
              </div>
              <h3 className="mt-2.5 font-display text-[13px] font-bold text-ink">
                Solde rechargé
              </h3>
              <p className="mt-1 text-[11px] leading-relaxed text-mist">
                Votre dépôt{amountBadge ? ` de ${amountBadge}` : ""} a été
                crédité immédiatement sur votre compte.
              </p>
              <button
                type="button"
                onClick={handleClose}
                className="mt-4 h-10 w-full rounded-xl bg-betclic-red font-display text-[11px] font-medium text-white"
              >
                Continuer
              </button>
            </div>
          ) : completedKind === "manual_recorded" ? (
            <div className="py-3 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-win/15 text-win">
                <Check className="h-6 w-6" strokeWidth={2.6} />
              </div>
              <h3 className="mt-2.5 font-display text-[13px] font-bold text-ink">
                Demande enregistrée
              </h3>
              <p className="mt-1 text-[11px] leading-relaxed text-mist">
                Votre dépôt{amountBadge ? ` de ${amountBadge}` : ""} sera
                crédité sur votre solde dès validation.
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <Link
                  href="/parametres/transactions"
                  onClick={handleClose}
                  className="rounded-xl bg-elev px-4 py-2.5 font-display text-[10.5px] font-medium text-ink"
                >
                  Historique
                </Link>
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-xl bg-betclic-red px-5 py-2.5 font-display text-[10.5px] font-medium text-white"
                >
                  Fermer
                </button>
              </div>
            </div>
          ) : session.kind === "manual" ? (
            session.method === "gift_card" ? (
              <div className="space-y-3">
                <div className="rounded-xl bg-elev px-3 py-2 text-[10.5px] leading-relaxed text-mist">
                  Sélectionnez votre carte cadeau ou ticket, puis saisissez son code. Votre demande sera vérifiée par un administrateur avant validation.
                </div>

                <div>
                  <label className="text-[9.5px] font-medium uppercase tracking-wider text-mist">
                    Carte cadeau ({GIFT_CARDS.length})
                  </label>
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5 max-h-36 overflow-y-auto pr-0.5">
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
                            "flex flex-col items-start rounded-lg border p-1.5 text-left transition-all",
                            isSel
                              ? "border-betclic-red bg-betclic-red/10 text-ink shadow-xs"
                              : "border-edge bg-elev/50 text-mist hover:border-ink/20 hover:text-ink"
                          )}
                        >
                          <GiftCardMark id={c.id} className="mb-1" />
                          <span className="truncate font-display text-[10px] font-bold leading-tight">
                            {c.shortLabel}
                          </span>
                          <span className="text-[8.5px] text-dim">
                            {c.hint}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-[9.5px] font-medium uppercase tracking-wider text-mist">
                      Code {giftCardDef.label}
                    </label>
                    <span
                      className={cn(
                        "text-[9px] font-mono tabular-nums font-semibold",
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
                        : giftCardDef.expectedDigits}{" "}
                      {giftCardDef.isNumericOnly ? "chiffres" : "car."}
                    </span>
                  </div>

                  <div className="relative mt-1">
                    <input
                      type="text"
                      autoFocus
                      value={giftCardCode}
                      onChange={(e) => {
                        setGiftCardCode(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder={`Ex: ${giftCardDef.placeholder}`}
                      className={cn(
                        "h-10 w-full rounded-xl border px-3 pr-8 font-mono text-[11.5px] font-medium tracking-wide uppercase outline-none transition-colors",
                        giftCardCode.length === 0
                          ? "border-edge bg-elev/60 text-ink focus:border-betclic-red"
                          : giftValidation.valid
                            ? "border-win bg-win/5 text-win focus:border-win"
                            : "border-betclic-red bg-betclic-red/5 text-betclic-red focus:border-betclic-red"
                      )}
                    />
                    {giftCardCode.length > 0 && giftValidation.valid ? (
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 grid h-4 w-4 place-items-center rounded-full bg-win text-white">
                        <Check className="h-2.5 w-2.5" strokeWidth={3} />
                      </span>
                    ) : null}
                  </div>

                  {giftCardCode.length > 0 && !giftValidation.valid ? (
                    <p className="mt-1 text-[9.5px] font-medium text-betclic-red">
                      ⚠ {giftValidation.error}
                    </p>
                  ) : giftCardCode.length > 0 && giftValidation.valid ? (
                    <p className="mt-1 text-[9.5px] font-medium text-win">
                      ✓ Format valide pour {giftCardDef.shortLabel} ({giftValidation.formatted})
                    </p>
                  ) : null}
                </div>

                {error ? (
                  <p className="rounded-lg bg-betclic-red/10 px-2.5 py-1.5 text-[10px] font-medium text-betclic-red">
                    {error}
                  </p>
                ) : null}

                <button
                  type="button"
                  disabled={submitting || !giftValidation.valid}
                  onClick={() => void submitManual()}
                  className={cn(
                    "mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl font-display text-[11px] font-medium transition-all",
                    !submitting && giftValidation.valid
                      ? "bg-win text-white shadow-xs active:scale-[0.99]"
                      : "cursor-not-allowed bg-elev text-dim opacity-70"
                  )}
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Lock className="h-3.5 w-3.5" />
                      Soumettre mon code · {session.amountLabel}
                    </>
                  )}
                </button>
              </div>
            ) : <div>
              <div className="rounded-xl bg-elev px-3 py-2.5 text-[10.5px] leading-relaxed text-mist">
                {session.method === "mobile_money"
                  ? `Opérateurs pris en charge (${countryConfig.name}) : ${
                      countryConfig.mobileMoneyHint || "Mobile Money"
                    }. Indiquez le numéro émetteur ou l'identifiant TXN du transfert.`
                  : "Effectuez votre virement puis renseignez ci-dessous la référence bancaire de l'opération."}
              </div>

              {session.method === "mobile_money" ? (
                <MobileMoneyBrandStrip countryCode={countryConfig.code} className="mt-2" />
              ) : null}

              <label className="mt-3 block text-[9.5px] font-medium uppercase tracking-wider text-mist">
                {session.method === "mobile_money"
                  ? "Numéro ou réf. Mobile Money"
                  : "Référence virement bancaire"}
              </label>
              <input
                type="text"
                autoFocus
                value={reference}
                onChange={(e) => {
                  setReference(e.target.value);
                  if (error) setError(null);
                }}
                placeholder={
                  session.method === "mobile_money"
                    ? `Ex. ${
                        countryConfig.mobileMoneyHint || "Mobile Money"
                      } / ID TXN`
                    : "Ex. Réf. virement bancaire"
                }
                className="mt-1.5 h-10 w-full rounded-xl border border-edge bg-elev/60 px-3 text-[11px] font-medium text-ink outline-none focus:border-betclic-red"
              />

              {error ? (
                <p className="mt-2 rounded-lg bg-betclic-red/10 px-2.5 py-1.5 text-[10px] font-medium text-betclic-red">
                  {error}
                </p>
              ) : null}

              <button
                type="button"
                disabled={submitting || reference.trim().length < 4}
                onClick={() => void submitManual()}
                className={cn(
                  "mt-3.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl font-display text-[11px] font-medium transition-all",
                  !submitting && reference.trim().length >= 4
                    ? "bg-win text-white shadow-xs active:scale-[0.99]"
                    : "cursor-not-allowed bg-elev text-dim"
                )}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Lock className="h-3.5 w-3.5" />
                    Confirmer {session.amountLabel}
                  </>
                )}
              </button>
            </div>
          ) : session.kind === "paypal" ? (
            <div>
              {session.paypalClientId && !sdkFailed ? (
                <div className="space-y-2.5">
                  {!sdkReady ? (
                    <div className="flex items-center justify-center gap-2 py-5 text-[11px] text-mist">
                      <Loader2 className="h-4 w-4 animate-spin text-betclic-red" />
                      Chargement du module sécurisé PayPal…
                    </div>
                  ) : null}
                  <div ref={paypalContainerRef} className="min-h-[44px]" />
                </div>
              ) : null}

              {(sdkFailed || !session.paypalClientId) && session.checkoutUrl ? (
                <div className="space-y-3 py-1 text-center">
                  <p className="text-[11px] leading-relaxed text-mist">
                    Finalisez votre dépôt PayPal de{" "}
                    <span className="font-medium text-ink">
                      {session.amountLabel}
                    </span>{" "}
                    dans la fenêtre sécurisée ci-dessous.
                  </p>
                  <button
                    type="button"
                    onClick={() => openOverlayWindow(session.checkoutUrl)}
                    className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-betclic-red font-display text-[11px] font-medium text-white"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Continuer sur PayPal sécurisé
                  </button>
                </div>
              ) : null}

              {error ? (
                <p className="mt-2.5 rounded-lg bg-betclic-red/10 px-2.5 py-1.5 text-[10px] font-medium text-betclic-red">
                  {error}
                </p>
              ) : null}
            </div>
          ) : session.kind === "stripe" ? (
            <div>
              {session.clientSecret &&
              session.stripePublishableKey &&
              !sdkFailed ? (
                <div>
                  {!sdkReady ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-mist">
                      <Loader2 className="h-4 w-4 animate-spin text-betclic-red" />
                      Ouverture du terminal carte sécurisé…
                    </div>
                  ) : null}
                  <div ref={stripeContainerRef} className="min-h-[280px]" />
                </div>
              ) : (
                <div className="space-y-3 py-1 text-center">
                  <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-betclic-red/10 px-3 py-1.5 text-[10.5px] font-medium text-betclic-red">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    En attente de validation sécurisée…
                  </div>
                  <p className="text-[11px] leading-relaxed text-mist">
                    Complétez le règlement par carte de{" "}
                    <span className="font-medium text-ink">
                      {session.amountLabel}
                    </span>
                    . Dès validation, ce panneau confirme et crédite votre solde
                    automatiquement ici.
                  </p>
                  {session.checkoutUrl ? (
                    <button
                      type="button"
                      onClick={() => openOverlayWindow(session.checkoutUrl)}
                      className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-betclic-red font-display text-[11px] font-medium text-white"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Ouvrir le terminal de paiement Stripe
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={async () => {
                      setSubmitting(true);
                      setError(null);
                      try {
                        const st = await api.payments.status(
                          session.providerRef
                        );
                        if (st.credited) {
                          await markOnlineCredited();
                        } else {
                          setError(
                            "Paiement pas encore confirmé par la banque."
                          );
                        }
                      } catch {
                        setError("Vérification momentanément indisponible.");
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                    className="h-9.5 w-full rounded-xl bg-elev font-display text-[10.5px] font-medium text-ink hover:bg-edge"
                  >
                    {submitting
                      ? "Vérification…"
                      : "J'ai validé mon paiement"}
                  </button>
                </div>
              )}

              {error ? (
                <p className="mt-2.5 rounded-lg bg-betclic-red/10 px-2.5 py-1.5 text-[10px] font-medium text-betclic-red">
                  {error}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="py-5 text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-betclic-red" />
              <p className="mt-2.5 text-[11px] text-mist">
                Validation sécurisée de votre dépôt en cours…
              </p>
              {error ? (
                <p className="mt-2.5 rounded-lg bg-betclic-red/10 px-2.5 py-1.5 text-[10px] font-medium text-betclic-red">
                  {error}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
