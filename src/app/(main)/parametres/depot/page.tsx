"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Gift,
  CreditCard,
  History,
  Loader2,
  Lock,
  Smartphone,
  Wallet,
} from "lucide-react";
import { ApiRequestError, api, type PaymentProvider } from "@/lib/api";
import {
  DepositCheckoutSheet,
  type DepositCheckoutSheetSession,
} from "@/components/deposit-checkout-sheet";
import { generateIdempotencyKey } from "@/lib/odds-lock";
import { useApp } from "@/components/providers";
import {
  PulseFlashLoader,
  triggerRouteLoader,
} from "@/components/pulse-flash-loader";
import {
  formatLocalAmount,
  formatPresetChip,
  localToEur,
} from "@/lib/countries";
import { cn } from "@/lib/format";

type DepositMethod = "mobile_money" | "sepa" | "gift_card" | "stripe" | "paypal";

export default function DepositPage() {
  const router = useRouter();
  const { authReady, toast, user, countryConfig, currency, currencyConfig } =
    useApp();
  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  const [paypalClientId, setPaypalClientId] = useState<string | null>(null);
  const [stripePublishableKey, setStripePublishableKey] = useState<
    string | null
  >(null);
  const [prevCur, setPrevCur] = useState(currency);
  const [amountText, setAmountText] = useState(() =>
    String(currencyConfig.defaultDepositLocal)
  );
  if (prevCur !== currency) {
    setPrevCur(currency);
    setAmountText(String(currencyConfig.defaultDepositLocal));
  }
  const [method, setMethod] = useState<DepositMethod>("mobile_money");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetSession, setSheetSession] =
    useState<DepositCheckoutSheetSession | null>(null);

  const inFlightRef = useRef(false);
  const idempotencySlotRef = useRef<{ key: string; sig: string } | null>(null);
  const popupWindowRef = useRef<Window | null>(null);
  const handledUrlReturnRef = useRef(false);

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

  // Traitement sur place d'un éventuel retour `?deposit=stripe|paypal|cancelled` sur `/parametres/depot`
  useEffect(() => {
    if (handledUrlReturnRef.current || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const dep = params.get("deposit");
    if (!dep) return;
    handledUrlReturnRef.current = true;

    const ref = params.get("ref");
    const token = params.get("token") ?? params.get("ba_token");
    window.history.replaceState(null, "", "/parametres/depot");

    if (dep === "cancelled") {
      toast({ kind: "info", title: "Paiement annulé" });
      return;
    }
    if (dep === "stripe" && ref) {
      queueMicrotask(() => {
        setSheetSession({
          kind: "verifying",
          provider: "stripe",
          providerRef: ref,
        });
      });
      return;
    }
    if (dep === "paypal" && token) {
      queueMicrotask(() => {
        setSheetSession({
          kind: "verifying",
          provider: "paypal",
          providerRef: token,
        });
      });
    }
  }, [toast]);

  if (!authReady && !user) {
    return <PulseFlashLoader />;
  }

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-2 pt-3 pb-6 lg:px-0">
        <div className="glass-card rounded-xl p-4 text-center">
          <p className="font-display text-[12px] font-medium text-ink">
            Connectez-vous pour effectuer un dépôt
          </p>
          <div className="mt-3 flex justify-center">
            <Link
              href="/auth?mode=login"
              className="btn-red rounded-xl px-4 py-2 text-[10.5px]"
            >
              Connexion
            </Link>
          </div>
        </div>
      </div>
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
  const localFormatted =
    localAmount > 0 ? formatLocalAmount(localAmount, currency) : "";
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
    (isManual || Boolean(onlineProvider?.enabled));

  const submit = async () => {
    if (!canSubmit || inFlightRef.current) return;
    setError(null);

    if (method === "mobile_money" || method === "sepa" || method === "gift_card") {
      setSheetSession({
        kind: "manual",
        method,
        amountEur: amount,
        amountLabel: localFormatted,
      });
      return;
    }

    inFlightRef.current = true;
    const useEmbeddedStripe =
      method === "stripe" && Boolean(stripePublishableKey);
    const sig = `${method}:${useEmbeddedStripe ? "emb" : "online"}:${amount}`;
    if (!idempotencySlotRef.current || idempotencySlotRef.current.sig !== sig) {
      idempotencySlotRef.current = {
        key: generateIdempotencyKey("dep"),
        sig,
      };
    }
    const idempotencyKey = idempotencySlotRef.current.key;

    // Si Stripe fonctionne en mode hébergé (sans clé publique `pk_...`) sur navigateur,
    // on pré-ouvre une fenêtre compacte centrée dans le geste utilisateur tout en gardant
    // le BottomSheet de suivi ouvert sur la page Déposer des fonds.
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

    setLoading(true);
    try {
      const r = await api.payments.create(method, amount, idempotencyKey, {
        uiMode: useEmbeddedStripe ? "embedded" : "hosted",
        returnPath: "/parametres/depot",
      });
      idempotencySlotRef.current = null;

      if (method === "paypal") {
        setSheetSession({
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
        setSheetSession({
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
      if (preOpenedPopup && !preOpenedPopup.closed) {
        try {
          preOpenedPopup.close();
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
    <>
      <div className="mx-auto w-full max-w-[1600px] px-2 pb-6 pt-2 lg:px-0 lg:py-0">
        {/* En-tête compact en ligne */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined" && window.history.length > 1) {
                  router.back();
                } else {
                  triggerRouteLoader("/parametres");
                  router.push("/parametres");
                }
              }}
              aria-label="Retour au compte"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-ink ring-1 ring-edge active:scale-95 lg:h-9 lg:w-9"
            >
              <ArrowLeft
                className="h-3.5 w-3.5 lg:h-4 lg:w-4"
                strokeWidth={2.3}
              />
            </button>
            <h1 className="truncate font-display text-[12px] font-bold leading-tight text-ink lg:text-[13.5px]">
              Déposer des fonds
            </h1>
          </div>

          <Link
            href="/parametres/transactions"
            className="inline-flex h-7.5 shrink-0 items-center gap-1 rounded-full bg-elev px-2.5 font-display text-[10px] font-medium text-ink transition-colors hover:bg-edge"
          >
            <History className="h-3 w-3" />
            Historique
          </Link>
        </div>

        <div className="mt-2.5 lg:mt-4">
          <div className="space-y-2.5 lg:space-y-4">
            {/* Montant compact */}
            <section className="glass-card rounded-xl p-3 lg:rounded-2xl lg:p-4">
              <label className="text-[9.5px] font-medium uppercase tracking-wider text-mist lg:text-[10px]">
                Montant à créditer
              </label>
              <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-edge bg-elev/60 px-3 py-1.5 focus-within:border-betclic-red lg:py-2.5">
                <input
                  type="text"
                  inputMode={
                    currencyConfig.decimals === 0 ? "numeric" : "decimal"
                  }
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  className="w-full bg-transparent text-center font-display text-[23px] font-bold tabular-nums text-ink outline-none lg:text-left lg:text-[16px] lg:font-medium"
                  placeholder={String(currencyConfig.defaultDepositLocal)}
                />
                <span className="shrink-0 font-display text-[12px] font-medium text-dim lg:text-[13.5px]">
                  {currencyConfig.symbol}
                </span>
              </div>

              <p className="mt-2 text-center text-[10px] text-mist lg:hidden">Entre {formatLocalAmount(effectiveMinLocal, currency)} et {formatLocalAmount(currencyConfig.maxDepositLocal, currency)}</p>
              <div className="mt-2 grid grid-cols-5 gap-1.5">
                {currencyConfig.depositPresetsLocal.map((q) => {
                  const active = localAmount === q;
                  return (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setAmountText(String(q))}
                      className={cn(
                        "h-8 rounded-lg px-1 font-display text-[9.5px] font-medium tabular-nums transition-colors lg:h-9 lg:rounded-xl lg:text-[10px]",
                        active
                          ? "bg-betclic-red text-white shadow-xs"
                          : "bg-elev text-ink hover:bg-edge"
                      )}
                    >
                      <span className="block truncate">
                        {formatPresetChip(q, currency)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Moyens de paiement compacts en ligne */}
            <section className="glass-card rounded-xl p-3 lg:rounded-2xl lg:p-4">
              <p className="text-[9.5px] font-medium uppercase tracking-wider text-mist lg:text-[10px]">
                Moyen de paiement
              </p>

              <div className="mt-2 grid grid-cols-1 gap-1.5 lg:grid-cols-2">
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
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={selected}
                      disabled={!m.available}
                      onClick={() => {
                        setMethod(m.id);
                        setError(null);
                      }}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all lg:rounded-xl lg:p-3",
                        selected
                          ? "border-betclic-red bg-betclic-red/8"
                          : "border-edge bg-elev/40 hover:border-ink/20",
                        !m.available && "cursor-not-allowed opacity-50"
                      )}
                    >
                      <m.Icon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          selected ? "text-betclic-red" : "text-mist"
                        )}
                      />
                      <div className="min-w-0">
                        <span className="block truncate font-display text-[10.5px] font-medium leading-tight text-ink lg:text-[11px]">
                          {m.label}
                        </span>
                        <span className="block truncate text-[9.5px] leading-tight text-dim lg:text-[10px]">
                          {m.sub}
                        </span>
                      </div>
                      <span aria-hidden="true" className={cn("ml-auto grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 lg:hidden", selected ? "border-betclic-red" : "border-dim")}>
                        {selected && <span className="h-2 w-2 rounded-full bg-betclic-red" />}
                      </span>
                    </button>
                  );
                })}
              </div>

              {error ? (
                <p className="mt-2 rounded-lg bg-betclic-red/10 px-2.5 py-1.5 text-[10px] font-medium text-betclic-red">
                  {error}
                </p>
              ) : null}

              <div className="mt-3 space-y-1 text-[10.5px] text-mist lg:hidden"><div className="flex justify-between gap-2"><span>Montant demandé</span><span className="text-ink">{localFormatted || "—"}</span></div><div className="flex justify-between gap-2"><span>Frais</span><span>À confirmer</span></div></div>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void submit()}
                className={cn(
                  "mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl font-display text-[11px] font-medium transition-all lg:h-11 lg:text-[11.5px]",
                  canSubmit
                    ? "bg-win text-white shadow-sm active:scale-[0.99]"
                    : "cursor-not-allowed bg-elev text-dim"
                )}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Lock className="h-3.5 w-3.5" />
                    Créditer {validAmount ? localFormatted : ""}
                  </>
                )}
              </button>
              <p className="mt-2 text-center text-[10px] text-dim lg:hidden">{isManual ? "Dépôt soumis à validation" : "Paiement sécurisé par le prestataire"}</p>
            </section>
          </div>
        </div>
      </div>

      <DepositCheckoutSheet
        session={sheetSession}
        onClose={() => setSheetSession(null)}
        popupWindowRef={popupWindowRef}
      />
    </>
  );
}
