"use client";

import { PaymentMethodMark } from "@/components/payment-method-mark";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Check,
  CreditCard,
  History,
  Loader2,
  Smartphone,
  Wallet,
} from "lucide-react";
import { ApiRequestError, api } from "@/lib/api";
import { getCachedWallet } from "@/lib/client-entity-cache";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import { generateIdempotencyKey } from "@/lib/odds-lock";
import { useApp } from "@/components/providers";
import {
  PulseFlashLoader,
  triggerRouteLoader,
} from "@/components/pulse-flash-loader";
import {
  formatLocalAmount,
  formatLocalInputString,
  formatPresetChip,
  localToEur,
  maxSpendableLocalFromEur,
} from "@/lib/countries";
import { cn, eur } from "@/lib/format";

const METHODS = [
  {
    id: "mobile_money",
    label: "Mobile Money",
    placeholder: "Opérateur + numéro Mobile Money",
    hint: "Opérateur + numéro Mobile Money",
    Icon: Smartphone,
  },
  {
    id: "iban",
    label: "Virement bancaire",
    placeholder: "FR76 3000 6000 0112 3456 7890 189",
    hint: "IBAN / compte bancaire",
    Icon: Building2,
  },
  {
    id: "paypal",
    label: "PayPal",
    placeholder: "votre.email@exemple.fr",
    hint: "Email du compte PayPal",
    Icon: Wallet,
  },
  {
    id: "card",
    label: "Carte",
    placeholder: "Visa / Mastercard •••• 4242",
    hint: "4 derniers chiffres ou réf. carte",
    Icon: CreditCard,
  },
] as const;

export default function WithdrawPage() {
  const router = useRouter();
  const {
    authReady,
    balance,
    setBalance,
    toast,
    user,
    bumpBets,
    betsVersion,
    countryConfig,
    currency,
    currencyConfig,
  } = useApp();
  const [method, setMethod] =
    useState<(typeof METHODS)[number]["id"]>("mobile_money");
  const [destination, setDestination] = useState("");
  const [prevCur, setPrevCur] = useState(currency);
  const [amountText, setAmountText] = useState(() =>
    String(currencyConfig.defaultWithdrawalLocal)
  );
  if (prevCur !== currency) {
    setPrevCur(currency);
    setAmountText(String(currencyConfig.defaultWithdrawalLocal));
  }
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
    if (!user && authReady) return;
    let active = true;
    const syncEligibility = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      api
        .wallet()
        .then((w) => {
          if (!active) return;
          if (typeof w.balance === "number") setBalance(w.balance);
          setEligibility({
            withdrawable: w.summary.withdrawable ?? w.balance,
            bonusLocked: w.summary.bonusLocked ?? 0,
            qualifiedWagered: w.summary.qualifiedWagered ?? 0,
            bonusRemaining: w.summary.bonusRemaining ?? 0,
          });
        })
        .catch(() => {});
    };
    syncEligibility();
    const id = setInterval(syncEligibility, 8_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [authReady, betsVersion, balance, setBalance, user]);

  if (!authReady && !user) {
    return <PulseFlashLoader />;
  }

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-2 pt-3 pb-6 lg:px-0">
        <div className="glass-card rounded-xl p-4 text-center">
          <p className="font-display text-[12px] font-medium text-ink">
            Connectez-vous pour retirer vos gains
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

  const withdrawable = eligibility ? eligibility.withdrawable : balance;
  const bonusRemaining = eligibility?.bonusRemaining ?? 0;
  const bonusLocked = eligibility?.bonusLocked ?? 0;
  const qualifiedWagered = eligibility?.qualifiedWagered ?? 0;
  const progressPct =
    bonusLocked > 0
      ? Math.min(100, Math.round((qualifiedWagered / bonusLocked) * 100))
      : 100;

  const currentMethod = METHODS.find((m) => m.id === method) ?? METHODS[0];
  const methodPlaceholder =
    currentMethod.id === "mobile_money"
      ? `${countryConfig.mobileMoneyHint || "Mobile Money"} · numéro de compte`
      : currentMethod.placeholder;
  const parsed = Number(amountText.replace(",", "."));
  const localAmount =
    Number.isFinite(parsed) && parsed > 0
      ? currencyConfig.decimals === 0
        ? Math.round(parsed)
        : Math.round(parsed * 100) / 100
      : 0;
  const amount = localToEur(localAmount, currency, withdrawable);
  const overWithdrawable = amount > withdrawable + 1e-5;
  const belowMin = localAmount > 0 && localAmount < currencyConfig.minWithdrawalLocal;
  const quickWithdrawPresets = currencyConfig.withdrawalPresetsLocal;

  const canSubmit =
    !loading &&
    localAmount >= currencyConfig.minWithdrawalLocal &&
    !overWithdrawable &&
    destination.trim().length >= 4;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || inFlightRef.current) return;
    inFlightRef.current = true;
    const cleanDest = destination.trim();
    const sig = `${method}:${cleanDest}:${amount}`;
    if (!idempotencySlotRef.current || idempotencySlotRef.current.sig !== sig) {
      idempotencySlotRef.current = {
        key: generateIdempotencyKey("wd"),
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
      playUiSound(user.sound, "bet");
      triggerHaptic(user.haptics, [18, 28]);
      setDone(true);
      toast({
        kind: "success",
        title: "Demande de retrait enregistrée",
        description: `${eur(amount)} réservés en attente de validation`,
      });
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        err.status >= 400 &&
        err.status < 500
      ) {
        idempotencySlotRef.current = null;
      }
      setError(err instanceof Error ? err.message : "Retrait impossible");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

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
          <div className="min-w-0">
            <h1 className="truncate font-display text-[12px] font-bold leading-tight text-ink lg:text-[13.5px]">
              Retirer mes gains
            </h1>
            <p className="truncate text-[10px] leading-tight text-dim lg:text-[10.5px]">
              Retirable : {eur(withdrawable)}
            </p>
          </div>
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
        {done ? (
          <div className="glass-card rounded-xl p-4 text-center lg:rounded-2xl lg:p-6">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-win/15 text-win">
              <Check className="h-5 w-5" strokeWidth={2.6} />
            </div>
            <h2 className="mt-2.5 font-display text-[12.5px] font-bold text-ink">
              Demande transmise
            </h2>
            <p className="mt-1 text-[10.5px] leading-relaxed text-mist">
              Votre retrait de <strong className="text-ink">{eur(amount)}</strong>{" "}
              vers <strong className="text-ink">{destination.trim()}</strong> est
              en cours de traitement.
            </p>
            <div className="mt-3.5 flex flex-wrap justify-center gap-2">
              <Link
                href="/parametres/transactions"
                className="rounded-lg bg-elev px-3.5 py-2 font-display text-[10.5px] font-medium text-ink"
              >
                Transactions
              </Link>
              <Link
                href="/parametres"
                className="btn-red rounded-lg px-4 py-2 text-[10.5px]"
              >
                Compte
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-2.5 lg:space-y-4">
            {/* Barre de déblocage bonus uniquement si applicable */}
            {bonusRemaining > 0 && (
              <section className="glass-card rounded-xl px-3 py-2.5 text-[10px] text-mist lg:rounded-2xl lg:p-4">
                <div className="flex justify-between">
                  <span>Déblocage bonus ({progressPct}%)</span>
                  <span className="font-medium tabular-nums text-ink">
                    Reste {eur(bonusRemaining)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-elev">
                  <div
                    className="h-full rounded-full bg-betclic-red"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </section>
            )}

            {/* Formulaire compact */}
            <section className="glass-card space-y-2.5 rounded-xl p-3 lg:space-y-3.5 lg:rounded-2xl lg:p-4">
              <div>
                <label className="text-[9.5px] font-medium uppercase tracking-wider text-mist lg:text-[10px]">
                  Montant du retrait
                </label>
                <div className="mt-1 flex items-center gap-2 rounded-xl border border-edge bg-elev/60 px-3 py-1.5 focus-within:border-betclic-red lg:py-2.5">
                  <input
                    type="text"
                    inputMode={currencyConfig.decimals === 0 ? "numeric" : "decimal"}
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    className="w-full bg-transparent text-center font-display text-[23px] font-bold tabular-nums text-ink outline-none lg:text-left lg:text-[16px] lg:font-medium"
                    placeholder={String(currencyConfig.defaultWithdrawalLocal)}
                  />
                  <span className="shrink-0 font-display text-[12px] font-medium text-dim lg:text-[13.5px]">
                    {currencyConfig.symbol}
                  </span>
                </div>

                <p className="mt-2 text-center text-[10px] text-mist lg:hidden">Minimum {formatLocalAmount(currencyConfig.minWithdrawalLocal, currency)}</p>
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {quickWithdrawPresets.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setAmountText(String(q))}
                      className={cn(
                        "h-8 rounded-lg px-1 font-display text-[9.5px] font-medium tabular-nums transition-colors lg:h-9 lg:rounded-xl lg:text-[10px]",
                        localAmount === q
                          ? "bg-betclic-red text-white"
                          : "bg-elev text-ink hover:bg-edge"
                      )}
                    >
                      <span className="block truncate">{formatPresetChip(q, currency)}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const maxLoc = maxSpendableLocalFromEur(withdrawable, currency);
                      setAmountText(
                        maxLoc > 0
                          ? formatLocalInputString(maxLoc, currency, ".")
                          : "0"
                      );
                    }}
                    className="h-8 rounded-lg border border-betclic-red/30 bg-betclic-red/10 font-display text-[10px] font-medium text-betclic-red lg:h-9 lg:rounded-xl"
                  >
                    MAX
                  </button>
                </div>

                {belowMin && (
                  <p className="mt-1 text-[10px] font-medium text-betclic-red">
                    Minimum de retrait :{" "}
                    {formatLocalAmount(currencyConfig.minWithdrawalLocal, currency)}.
                  </p>
                )}
                {overWithdrawable && (
                  <p className="mt-1 text-[10px] font-medium text-betclic-red">
                    Dépasse le solde retirable ({eur(withdrawable)}).
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-edge bg-white p-3 lg:border-0 lg:p-0">
                <p className="text-[9.5px] font-medium uppercase tracking-wider text-mist lg:text-[10px]">
                  Canal de réception
                </p>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {METHODS.map((m) => {
                    const active = method === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setMethod(m.id)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left transition-all lg:rounded-xl lg:p-2.5",
                          active
                            ? "border-betclic-red bg-betclic-red/8"
                            : "border-edge bg-elev/40"
                        )}
                      >
                        <PaymentMethodMark method={m.id} fallback={
                      <m.Icon
                          className={cn(
                            "h-3.5 w-3.5 shrink-0 lg:h-4 lg:w-4",
                            active ? "text-betclic-red" : "text-mist"
                          )}
                        />
                      } />
                        <span className="truncate font-display text-[10.5px] font-medium text-ink lg:text-[10.5px]">
                          {m.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-edge bg-white p-3 lg:border-0 lg:p-0">
                <label className="text-[9.5px] font-medium uppercase tracking-wider text-mist lg:text-[10px]">
                  {currentMethod.hint}
                </label>
                <input
                  type="text"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder={methodPlaceholder}
                  className="mt-1 h-9.5 w-full rounded-lg border border-edge bg-elev/60 px-3 text-[10.5px] font-medium text-ink outline-none focus:border-betclic-red lg:h-11 lg:rounded-xl lg:text-[11px]"
                />
              </div>

              {error && (
                <p className="rounded-lg bg-betclic-red/10 px-2.5 py-1.5 text-[10px] font-medium text-betclic-red">
                  {error}
                </p>
              )}

              <div className="space-y-1 text-[10.5px] text-mist lg:hidden"><div className="flex justify-between gap-2"><span>Montant demandé</span><span className="text-ink">{localAmount > 0 ? formatLocalAmount(localAmount, currency) : "—"}</span></div><div className="flex justify-between gap-2"><span>Frais et montant reçu</span><span>À confirmer</span></div></div>
              <button
                type="submit"
                disabled={!canSubmit}
                className={cn(
                  "flex h-10 w-full items-center justify-center gap-1.5 rounded-xl font-display text-[11px] font-medium transition-all lg:h-11 lg:text-[11.5px]",
                  canSubmit
                    ? "bg-betclic-red text-white shadow-sm active:scale-[0.99]"
                    : "cursor-not-allowed bg-elev text-dim"
                )}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    Retirer {localAmount >= currencyConfig.minWithdrawalLocal ? eur(amount) : ""}
                  </>
                )}
              </button>
            </section>
          </form>
        )}
      </div>
    </div>
  );
}
