"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Building2, CreditCard, Loader2, Wallet, X } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "./providers";
import { cn, eur } from "@/lib/format";

const QUICK_AMOUNTS = [20, 50, 100];

const METHODS = [
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
    label: "Carte bancaire",
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
  const { balance, setBalance, toast } = useApp();
  const [method, setMethod] = useState<(typeof METHODS)[number]["id"]>("iban");
  const [destination, setDestination] = useState("");
  const [amountText, setAmountText] = useState("20");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const currentMethod = METHODS.find((m) => m.id === method) ?? METHODS[0];
  const parsed = Number(amountText.replace(",", "."));
  const amount = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
  const overBalance = amount > balance;
  const belowMin = amount > 0 && amount < 10;

  const canSubmit =
    !loading &&
    amount >= 10 &&
    !overBalance &&
    destination.trim().length >= 4;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.requestWithdrawal({
        method,
        destination: destination.trim(),
        amount,
      });
      setBalance(res.balance);
      toast({
        kind: "success",
        title: "Demande de retrait enregistrée",
        description: `${eur(amount)} réservés en attente de validation`,
      });
      setDestination("");
      onSuccess?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Retrait impossible";
      setError(msg);
    } finally {
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
          className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] w-full max-w-[440px] flex-col rounded-t-3xl border-t border-edge bg-surface shadow-2xl"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3.5">
            <div>
              <h2 className="font-display text-[17px] font-bold text-ink">Retirer mes gains</h2>
              <p className="text-[11.5px] text-dim">
                Solde disponible : <strong className="text-ink">{eur(balance)}</strong>
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
            <label className="text-[11.5px] font-semibold text-mist">Mode de réception</label>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
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
                      "flex flex-col items-center gap-1 rounded-2xl border p-2.5 text-center transition-colors",
                      active
                        ? "border-betclic-red bg-betclic-red/8 text-betclic-red"
                        : "border-edge bg-white text-mist"
                    )}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2.1} />
                    <span className="font-display text-[11px] font-bold leading-tight">
                      {m.label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3.5">
              <label className="text-[11.5px] font-semibold text-mist">{currentMethod.hint}</label>
              <input
                type="text"
                value={destination}
                onChange={(e) => {
                  setDestination(e.target.value);
                  setError(null);
                }}
                placeholder={currentMethod.placeholder}
                className="mt-1.5 h-11 w-full rounded-2xl border border-edge bg-white px-3.5 text-[15px] font-medium text-ink outline-none focus:border-ink"
              />
            </div>

            <div className="mt-3.5">
              <div className="flex items-center justify-between text-[11.5px]">
                <label className="font-semibold text-mist">Montant à retirer (min. 10 €)</label>
              </div>
              <div
                className={cn(
                  "mt-1.5 flex h-12 items-center rounded-2xl border bg-white px-3.5",
                  overBalance || belowMin ? "border-betclic-red" : "border-edge focus-within:border-ink"
                )}
              >
                <input
                  type="text"
                  inputMode="decimal"
                  value={amountText}
                  onChange={(e) => {
                    setAmountText(e.target.value.replace(/[^0-9.,]/g, ""));
                    setError(null);
                  }}
                  placeholder="20"
                  className="w-full bg-transparent font-display text-[20px] font-bold tabular-nums text-ink outline-none"
                />
                <span className="font-display text-[16px] font-bold text-dim">€</span>
              </div>

              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {QUICK_AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => {
                      setAmountText(String(amt));
                      setError(null);
                    }}
                    className={cn(
                      "h-8 rounded-xl border font-display text-[12px] font-bold",
                      amount === amt
                        ? "border-ink bg-ink text-white"
                        : "border-edge bg-elev text-ink"
                    )}
                  >
                    {amt} €
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setAmountText(String(Math.max(0, Math.floor(balance * 100) / 100)));
                    setError(null);
                  }}
                  className="h-8 rounded-xl border border-betclic-red/30 bg-betclic-red/10 font-display text-[11.5px] font-bold text-betclic-red"
                >
                  TOUT
                </button>
              </div>
            </div>

            {belowMin && (
              <p className="mt-2 text-[11.5px] font-medium text-betclic-red">
                Montant minimum de retrait : 10,00 €
              </p>
            )}
            {overBalance && (
              <p className="mt-2 text-[11.5px] font-medium text-betclic-red">
                Ce montant dépasse votre solde disponible.
              </p>
            )}
            {error && (
              <p className="mt-2 rounded-xl bg-betclic-red/8 px-3 py-2 text-[12px] font-medium text-betclic-red">
                {error}
              </p>
            )}

            <p className="mt-3 rounded-xl bg-elev px-3 py-2 text-[11px] leading-relaxed text-mist">
              Le montant est immédiatement réservé sur votre compte. Vous pouvez annuler votre
              demande en un clic tant qu&apos;elle est en attente de validation.
            </p>

            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                "mt-3.5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl font-display text-[14px] font-bold transition-all",
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
