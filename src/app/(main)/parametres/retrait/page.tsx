"use client";

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
import { triggerRouteLoader } from "@/components/pulse-flash-loader";
import { cn, eur } from "@/lib/format";

const QUICK_AMOUNTS = [20, 50, 100, 250];

const METHODS = [
  {
    id: "mobile_money",
    label: "Mobile Money",
    placeholder: "MTN / Moov / Orange · +229 01 …",
    hint: "Opérateur + numéro Mobile Money",
    Icon: Smartphone,
  },
  {
    id: "iban",
    label: "Virement SEPA",
    placeholder: "FR76 3000 6000 0112 3456 7890 189",
    hint: "IBAN européen",
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
  const { balance, setBalance, toast, user, bumpBets } = useApp();
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
      <div className="mx-auto max-w-xl px-3 pt-4 pb-6">
        <div className="glass-card rounded-xl p-4 text-center">
          <p className="font-display text-[14.5px] font-bold text-ink">
            Connectez-vous pour retirer vos gains
          </p>
          <div className="mt-3 flex justify-center">
            <Link
              href="/auth?mode=login"
              className="btn-red rounded-xl px-4 py-2 text-[12px]"
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
    <div className="mx-auto w-full max-w-xl px-3 pb-6 pt-2.5 lg:px-0 lg:py-0">
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
            <h1 className="truncate font-display text-[14.5px] font-extrabold leading-tight text-ink lg:text-[18px]">
              Retirer mes gains
            </h1>
            <p className="truncate text-[10.5px] leading-tight text-dim lg:text-[11.5px]">
              Retirable : {eur(withdrawable)}
            </p>
          </div>
        </div>

        <Link
          href="/parametres/transactions"
          className="inline-flex h-7.5 shrink-0 items-center gap-1 rounded-full bg-elev px-2.5 font-display text-[10.5px] font-bold text-ink transition-colors hover:bg-edge"
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
            <h2 className="mt-2.5 font-display text-[15.5px] font-extrabold text-ink">
              Demande transmise
            </h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-mist">
              Votre retrait de <strong className="text-ink">{eur(amount)}</strong>{" "}
              vers <strong className="text-ink">{destination.trim()}</strong> est
              en cours de traitement.
            </p>
            <div className="mt-3.5 flex flex-wrap justify-center gap-2">
              <Link
                href="/parametres/transactions"
                className="rounded-lg bg-elev px-3.5 py-2 font-display text-[11.5px] font-bold text-ink"
              >
                Transactions
              </Link>
              <Link
                href="/parametres"
                className="btn-red rounded-lg px-4 py-2 text-[11.5px]"
              >
                Compte
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-2.5 lg:space-y-4">
            {/* Barre de déblocage bonus uniquement si applicable */}
            {bonusRemaining > 0 && (
              <section className="glass-card rounded-xl px-3 py-2.5 text-[10.5px] text-mist lg:rounded-2xl lg:p-4">
                <div className="flex justify-between">
                  <span>Déblocage bonus ({progressPct}%)</span>
                  <span className="font-semibold tabular-nums text-ink">
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
                <label className="text-[10px] font-bold uppercase tracking-wider text-mist lg:text-[11px]">
                  Montant du retrait (min. 10 €)
                </label>
                <div className="mt-1 flex items-center gap-2 rounded-xl border border-edge bg-elev/60 px-3 py-1.5 focus-within:border-betclic-red lg:py-2.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    className="w-full bg-transparent font-display text-[18px] font-black tabular-nums text-ink outline-none lg:text-[22px]"
                    placeholder="20"
                  />
                  <span className="font-display text-[15px] font-extrabold text-dim lg:text-[18px]">
                    €
                  </span>
                </div>

                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {QUICK_AMOUNTS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setAmountText(String(q))}
                      className={cn(
                        "h-8 rounded-lg font-display text-[11.5px] font-bold tabular-nums transition-colors lg:h-9 lg:rounded-xl lg:text-[12px]",
                        amount === q
                          ? "bg-betclic-red text-white"
                          : "bg-elev text-ink hover:bg-edge"
                      )}
                    >
                      {q} €
                    </button>
                  ))}
                </div>

                {belowMin && (
                  <p className="mt-1 text-[10.5px] font-semibold text-betclic-red">
                    Minimum de retrait : 10,00 €.
                  </p>
                )}
                {overWithdrawable && (
                  <p className="mt-1 text-[10.5px] font-semibold text-betclic-red">
                    Dépasse le solde retirable ({eur(withdrawable)}).
                  </p>
                )}
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-mist lg:text-[11px]">
                  Canal de réception
                </p>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {METHODS.map((m) => {
                    const active = method === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setMethod(m.id)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left transition-all lg:rounded-xl lg:p-2.5",
                          active
                            ? "border-betclic-red bg-betclic-red/8"
                            : "border-edge bg-elev/40"
                        )}
                      >
                        <m.Icon
                          className={cn(
                            "h-3.5 w-3.5 shrink-0 lg:h-4 lg:w-4",
                            active ? "text-betclic-red" : "text-mist"
                          )}
                        />
                        <span className="truncate font-display text-[11.5px] font-bold text-ink lg:text-[12px]">
                          {m.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-mist lg:text-[11px]">
                  {currentMethod.hint}
                </label>
                <input
                  type="text"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder={currentMethod.placeholder}
                  className="mt-1 h-9.5 w-full rounded-lg border border-edge bg-elev/60 px-3 text-[12px] font-medium text-ink outline-none focus:border-betclic-red lg:h-11 lg:rounded-xl lg:text-[13px]"
                />
              </div>

              {error && (
                <p className="rounded-lg bg-betclic-red/10 px-2.5 py-1.5 text-[11px] font-semibold text-betclic-red">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className={cn(
                  "flex h-10 w-full items-center justify-center gap-1.5 rounded-xl font-display text-[13px] font-extrabold transition-all lg:h-11 lg:text-[14px]",
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
                    Retirer {amount >= 10 ? eur(amount) : ""}
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
