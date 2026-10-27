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
      <div className="mx-auto max-w-xl px-4 pt-6 pb-8">
        <div className="glass-card rounded-2xl p-6 text-center">
          <p className="font-display text-[17px] font-bold text-ink">
            Connectez-vous pour retirer vos gains
          </p>
          <div className="mt-4 flex justify-center">
            <Link
              href="/auth?mode=login"
              className="btn-red rounded-xl px-5 py-2.5 text-[12.5px]"
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
    <div className="pb-8">
      {/* En-tête collant */}
      <div className="sticky top-[52px] z-30 border-b border-edge bg-white/95 px-3.5 py-2.5 backdrop-blur lg:top-0 lg:rounded-t-2xl lg:px-5">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined" && window.history.length > 1) {
                  router.back();
                } else {
                  router.push("/parametres");
                }
              }}
              aria-label="Retour au compte"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-elev text-ink transition-colors hover:bg-edge active:scale-95"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2.3} />
            </button>
            <div className="min-w-0">
              <h1 className="truncate font-display text-[15px] font-extrabold text-ink">
                Retirer mes gains
              </h1>
              <p className="truncate text-[11px] text-dim">
                Retirable immédiatement : {eur(withdrawable)}
              </p>
            </div>
          </div>

          <Link
            href="/parametres/transactions"
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-elev px-2.5 font-display text-[11px] font-bold text-ink transition-colors hover:bg-edge"
          >
            <History className="h-3.5 w-3.5" />
            Historique
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-xl px-3.5 pt-4 lg:px-0">
        {done ? (
          <div className="glass-card rounded-2xl p-6 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-win/15 text-win">
              <Check className="h-7 w-7" strokeWidth={2.6} />
            </div>
            <h2 className="mt-3 font-display text-[18px] font-extrabold text-ink">
              Demande de retrait transmise
            </h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-mist">
              Votre retrait de <strong className="text-ink">{eur(amount)}</strong>{" "}
              vers <strong className="text-ink">{destination.trim()}</strong> est
              en cours de traitement.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2.5">
              <Link
                href="/parametres/transactions"
                className="rounded-xl bg-elev px-4 py-2.5 font-display text-[12.5px] font-bold text-ink"
              >
                Suivre le retrait
              </Link>
              <Link
                href="/parametres"
                className="btn-red rounded-xl px-5 py-2.5 text-[12.5px]"
              >
                Retour au compte
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {/* Éligibilité & progression bonus éventuelle */}
            <section className="glass-card rounded-2xl p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-[11.5px] font-semibold text-mist">
                  Montant retirable
                </span>
                <span className="font-display text-[20px] font-black tabular-nums text-win">
                  {eur(withdrawable)}
                </span>
              </div>
              {bonusRemaining > 0 && (
                <div className="mt-3 border-t border-edge/80 pt-2.5 text-[11px] text-mist">
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
                </div>
              )}
            </section>

            {/* Montant & destination */}
            <section className="glass-card space-y-3.5 rounded-2xl p-4">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-mist">
                  Montant du retrait (min. 10 €)
                </label>
                <div className="mt-1.5 flex items-center gap-2 rounded-2xl border border-edge bg-elev/60 px-3.5 py-2.5 focus-within:border-betclic-red">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    className="w-full bg-transparent font-display text-[22px] font-black tabular-nums text-ink outline-none"
                    placeholder="20"
                  />
                  <span className="font-display text-[18px] font-extrabold text-dim">
                    €
                  </span>
                </div>

                <div className="mt-2.5 grid grid-cols-4 gap-1.5">
                  {QUICK_AMOUNTS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setAmountText(String(q))}
                      className={cn(
                        "h-9 rounded-xl font-display text-[12px] font-bold tabular-nums transition-colors",
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
                  <p className="mt-1.5 text-[11px] font-semibold text-betclic-red">
                    Le montant minimal de retrait est de 10,00 €.
                  </p>
                )}
                {overWithdrawable && (
                  <p className="mt-1.5 text-[11px] font-semibold text-betclic-red">
                    Montant supérieur à votre solde retirable ({eur(withdrawable)}).
                  </p>
                )}
              </div>

              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-mist">
                  Canal de réception
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {METHODS.map((m) => {
                    const active = method === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setMethod(m.id)}
                        className={cn(
                          "flex items-center gap-2 rounded-xl border p-2.5 text-left transition-all",
                          active
                            ? "border-betclic-red bg-betclic-red/8"
                            : "border-edge bg-elev/40"
                        )}
                      >
                        <m.Icon
                          className={cn(
                            "h-4 w-4 shrink-0",
                            active ? "text-betclic-red" : "text-mist"
                          )}
                        />
                        <span className="truncate font-display text-[12px] font-bold text-ink">
                          {m.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-mist">
                  {currentMethod.hint}
                </label>
                <input
                  type="text"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder={currentMethod.placeholder}
                  className="mt-1.5 h-11 w-full rounded-xl border border-edge bg-elev/60 px-3.5 text-[13px] font-medium text-ink outline-none focus:border-betclic-red"
                />
              </div>

              {error && (
                <p className="rounded-xl bg-betclic-red/10 px-3 py-2 text-[12px] font-semibold text-betclic-red">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className={cn(
                  "flex h-12 w-full items-center justify-center gap-2 rounded-2xl font-display text-[14px] font-extrabold transition-all",
                  canSubmit
                    ? "bg-betclic-red text-white shadow-sm active:scale-[0.99]"
                    : "cursor-not-allowed bg-elev text-dim"
                )}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <ArrowUpRight className="h-4 w-4" />
                    Demander le retrait {amount >= 10 ? `· ${eur(amount)}` : ""}
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
