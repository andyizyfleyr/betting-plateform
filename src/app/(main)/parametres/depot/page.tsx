"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Check,
  CreditCard,
  History,
  Loader2,
  Lock,
  Smartphone,
  Wallet,
} from "lucide-react";
import { ApiRequestError, api, type PaymentProvider } from "@/lib/api";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
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
import { cn, eur } from "@/lib/format";

type DepositMethod = "mobile_money" | "sepa" | "stripe" | "paypal";

export default function DepositPage() {
  const router = useRouter();
  const { authReady, toast, user, bumpBets, countryConfig, currency, currencyConfig } =
    useApp();
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

  const canSubmit =
    !loading &&
    validAmount &&
    (isManual ? reference.trim().length >= 4 : Boolean(onlineProvider?.enabled));

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
      if (method === "mobile_money" || method === "sepa") {
        await api.payments.manual({
          method,
          reference: cleanRef,
          amount,
          idempotencyKey,
        });
        idempotencySlotRef.current = null;
        playUiSound(user.sound, "bet");
        triggerHaptic(user.haptics, [18, 28]);
        bumpBets();
        setDoneManual(true);
        inFlightRef.current = false;
        setLoading(false);
        return;
      }
      const r = await api.payments.create(method, amount, idempotencyKey);
      idempotencySlotRef.current = null;
      window.location.assign(r.url);
    } catch (e) {
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
            <ArrowLeft className="h-3.5 w-3.5 lg:h-4 lg:w-4" strokeWidth={2.3} />
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
        {doneManual ? (
          <div className="glass-card rounded-xl p-4 text-center lg:rounded-2xl lg:p-6">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-win/15 text-win">
              <Check className="h-5 w-5" strokeWidth={2.6} />
            </div>
            <h2 className="mt-2.5 font-display text-[12.5px] font-bold text-ink">
              Demande enregistrée
            </h2>
            <p className="mt-1 text-[10.5px] leading-relaxed text-mist">
              Votre dépôt de <strong className="text-ink">{eur(amount)}</strong> (
              {method === "mobile_money" ? "Mobile Money" : "Virement SEPA"}) sera
              crédité dès validation.
            </p>
            <div className="mt-3.5 flex flex-wrap justify-center gap-2">
              <Link
                href="/parametres/transactions"
                className="rounded-lg bg-elev px-3.5 py-2 font-display text-[10.5px] font-medium text-ink"
              >
                Transactions
              </Link>
              <Link
                href="/matchs"
                className="btn-red rounded-lg px-4 py-2 text-[10.5px]"
              >
                Matchs
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 lg:space-y-4">
            {/* Montant compact */}
            <section className="glass-card rounded-xl p-3 lg:rounded-2xl lg:p-4">
              <label className="text-[9.5px] font-medium uppercase tracking-wider text-mist lg:text-[10px]">
                Montant à créditer ({formatLocalAmount(effectiveMinLocal, currency)} –{" "}
                {formatLocalAmount(currencyConfig.maxDepositLocal, currency)})
              </label>
              <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-edge bg-elev/60 px-3 py-1.5 focus-within:border-betclic-red lg:py-2.5">
                <input
                  type="text"
                  inputMode={currencyConfig.decimals === 0 ? "numeric" : "decimal"}
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  className="w-full bg-transparent font-display text-[13.5px] font-medium tabular-nums text-ink outline-none lg:text-[16px]"
                  placeholder={String(currencyConfig.defaultDepositLocal)}
                />
                <span className="shrink-0 font-display text-[12px] font-medium text-dim lg:text-[13.5px]">
                  {currencyConfig.symbol}
                </span>
              </div>

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
                      <span className="block truncate">{formatPresetChip(q, currency)}</span>
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

              <div className="mt-2 grid grid-cols-2 gap-1.5">
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
                      disabled={!m.available}
                      onClick={() => setMethod(m.id)}
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
                    </button>
                  );
                })}
              </div>

              {isManual && (
                <div className="mt-2.5">
                  <label className="text-[9.5px] font-medium uppercase tracking-wider text-mist lg:text-[10px]">
                    {method === "mobile_money"
                      ? "Numéro ou réf. Mobile Money"
                      : "Référence virement SEPA"}
                  </label>
                  <input
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder={
                      method === "mobile_money"
                        ? `Ex. ${countryConfig.mobileMoneyHint || "Mobile Money"} / ID TXN`
                        : "Ex. Réf. virement bancaire"
                    }
                    className="mt-1 h-9.5 w-full rounded-lg border border-edge bg-elev/60 px-3 text-[10.5px] font-medium text-ink outline-none focus:border-betclic-red lg:h-11 lg:rounded-xl lg:text-[11px]"
                  />
                </div>
              )}

              {error && (
                <p className="mt-2 rounded-lg bg-betclic-red/10 px-2.5 py-1.5 text-[10px] font-medium text-betclic-red">
                  {error}
                </p>
              )}

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
                    Créditer {validAmount ? eur(amount) : ""}
                  </>
                )}
              </button>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
