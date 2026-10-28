"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  Building2,
  CreditCard,
  Loader2,
  Lock,
  Smartphone,
  Wallet,
  X,
} from "lucide-react";
import { ApiRequestError, api } from "@/lib/api";
import {
  formatLocalAmount,
  formatLocalInputString,
  formatPresetChip,
  localToEur,
  maxSpendableLocalFromEur,
} from "@/lib/countries";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import { generateIdempotencyKey } from "@/lib/odds-lock";
import { useApp } from "./providers";
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

export function WithdrawModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { balance, setBalance, toast, user, countryConfig, currency, currencyConfig } =
    useApp();
  const [method, setMethod] = useState<(typeof METHODS)[number]["id"]>("mobile_money");
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
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const idempotencySlotRef = useRef<{ key: string; sig: string } | null>(null);
  const [eligibility, setEligibility] = useState<{
    withdrawable: number;
    bonusLocked: number;
    qualifiedWagered: number;
    bonusRemaining: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
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
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open]);

  if (!open) return null;

  const withdrawable = eligibility ? eligibility.withdrawable : balance;
  const bonusRemaining = eligibility?.bonusRemaining ?? 0;
  const bonusLocked = eligibility?.bonusLocked ?? 0;
  const qualifiedWagered = eligibility?.qualifiedWagered ?? 0;
  const progressPct =
    bonusLocked > 0 ? Math.min(100, Math.round((qualifiedWagered / bonusLocked) * 100)) : 100;

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
      playUiSound(user?.sound, "bet");
      triggerHaptic(user?.haptics, [18, 28]);
      toast({
        kind: "success",
        title: "Demande de retrait enregistrée",
        description: `${eur(amount)} réservés en attente de validation`,
      });
      setDestination("");
      onSuccess?.();
      onClose();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status >= 400 && err.status < 500) {
        idempotencySlotRef.current = null;
      }
      const msg = err instanceof Error ? err.message : "Retrait impossible";
      setError(msg);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[80]">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={loading ? undefined : onClose}
          className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        />
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 380, damping: 36 }}
          className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] w-full max-w-[440px] flex-col rounded-t-3xl border-t border-edge bg-surface shadow-2xl lg:inset-0 lg:m-auto lg:h-fit lg:max-h-[85dvh] lg:max-w-[480px] lg:rounded-3xl lg:border"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3.5">
            <div>
              <h2 className="font-display text-[13.5px] font-bold text-ink">Retirer mes gains</h2>
              <p className="text-[10.5px] text-dim">
                Solde retirable : <strong className="text-win">{eur(withdrawable)}</strong>
                {withdrawable < balance && (
                  <span className="text-dim"> (total {eur(balance)})</span>
                )}
              </p>
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

          <form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3.5">
            {bonusRemaining > 0 && (
              <div className="mb-3.5 rounded-2xl border border-amber-500/25 bg-amber-500/8 p-3">
                <div className="flex items-center justify-between gap-2 text-[10.5px]">
                  <span className="inline-flex items-center gap-1 font-display font-medium text-amber-900">
                    <Lock className="h-3.5 w-3.5 text-amber-700" strokeWidth={2.3} />
                    Déblocage du bonus de bienvenue
                  </span>
                  <span className="font-display font-medium tabular-nums text-amber-900">
                    {progressPct}%
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-amber-950/10">
                  <div
                    className="h-full rounded-full bg-amber-600 transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-amber-900/85">
                  Misez encore <strong>{eur(bonusRemaining)}</strong> sur des paris réglés à cote{" "}
                  <strong>≥ 1,30</strong> pour rendre l&apos;intégralité du bonus retirable.
                </p>
              </div>
            )}

            <label className="text-[10.5px] font-medium text-mist">Mode de réception</label>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {METHODS.map((m) => {
                const active = method === m.id;
                const Icon = m.Icon;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setMethod(m.id);
                      setError(null);
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded-2xl border p-2.5 text-left transition-colors",
                      active
                        ? "border-betclic-red bg-betclic-red/8 text-betclic-red"
                        : "border-edge bg-white text-mist"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={2.1} />
                    <span className="truncate font-display text-[10.5px] font-medium leading-tight">
                      {m.label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3.5">
              <label className="text-[10.5px] font-medium text-mist">{currentMethod.hint}</label>
              <input
                type="text"
                value={destination}
                onChange={(e) => {
                  setDestination(e.target.value);
                  setError(null);
                }}
                placeholder={methodPlaceholder}
                className="mt-1.5 h-11 w-full rounded-2xl border border-edge bg-white px-3.5 text-[12px] font-medium text-ink outline-none focus:border-ink"
              />
            </div>

            <div className="mt-3.5">
              <label className="text-[10.5px] font-medium text-mist">
                Montant à retirer (min.{" "}
                {formatLocalAmount(currencyConfig.minWithdrawalLocal, currency)})
              </label>
              <div
                className={cn(
                  "mt-1.5 flex h-12 items-center rounded-2xl border bg-white px-3.5",
                  overWithdrawable || belowMin
                    ? "border-betclic-red"
                    : "border-edge focus-within:border-ink"
                )}
              >
                <input
                  type="text"
                  inputMode={currencyConfig.decimals === 0 ? "numeric" : "decimal"}
                  value={amountText}
                  onChange={(e) => {
                    setAmountText(e.target.value.replace(/[^0-9.,]/g, ""));
                    setError(null);
                  }}
                  placeholder={String(currencyConfig.defaultWithdrawalLocal)}
                  className="w-full bg-transparent font-display text-[14.5px] font-medium tabular-nums text-ink outline-none"
                />
                <span className="shrink-0 font-display text-[12px] font-medium text-dim">
                  {currencyConfig.symbol}
                </span>
              </div>

              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {quickWithdrawPresets.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => {
                      setAmountText(String(amt));
                      setError(null);
                    }}
                    className={cn(
                      "h-8 rounded-xl border px-1 font-display text-[9.5px] font-medium",
                      localAmount === amt
                        ? "border-ink bg-ink text-white"
                        : "border-edge bg-elev text-ink"
                    )}
                  >
                    <span className="block truncate">{formatPresetChip(amt, currency)}</span>
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
                    setError(null);
                  }}
                  className="h-8 rounded-xl border border-betclic-red/30 bg-betclic-red/10 font-display text-[10.5px] font-medium text-betclic-red"
                >
                  MAX
                </button>
              </div>
            </div>

            {belowMin && (
              <p className="mt-2 text-[10.5px] font-medium text-betclic-red">
                Montant minimum de retrait :{" "}
                {formatLocalAmount(currencyConfig.minWithdrawalLocal, currency)}
              </p>
            )}
            {overWithdrawable && (
              <p className="mt-2 text-[10.5px] font-medium text-betclic-red">
                {amount <= balance
                  ? `Montant supérieur à votre solde retirable (${eur(withdrawable)}).`
                  : "Ce montant dépasse votre solde disponible."}
              </p>
            )}
            {error && (
              <p className="mt-2 rounded-xl bg-betclic-red/8 px-3 py-2 text-[10.5px] font-medium text-betclic-red">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                "mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl font-display text-[11.5px] font-medium transition-all",
                canSubmit ? "bg-betclic-red text-white shadow-sm" : "bg-elev text-dim"
              )}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Enregistrement…
                </>
              ) : (
                <>
                  Demander le retrait {amount > 0 ? `(${eur(amount)})` : ""}
                  <ArrowUpRight className="h-4 w-4" strokeWidth={2.4} />
                </>
              )}
            </button>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
