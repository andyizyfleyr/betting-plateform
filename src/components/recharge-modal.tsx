"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { Building2, Check, CreditCard, Loader2, Lock, Smartphone, Wallet, X } from "lucide-react";
import { api, type PaymentProvider } from "@/lib/api";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import { useApp } from "@/components/providers";
import { cn, eur } from "@/lib/format";

const QUICK = [10, 25, 50, 100, 250];

type DepositMethod = "mobile_money" | "sepa" | "stripe" | "paypal";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RechargeModal({ open, onClose }: Props) {
  return <AnimatePresence>{open && <RechargeSheet onClose={onClose} />}</AnimatePresence>;
}

function RechargeSheet({ onClose }: { onClose: () => void }) {
  const { toast, balance, user, bumpBets } = useApp();
  const dragControls = useDragControls();
  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  const [amountText, setAmountText] = useState("25");
  const [method, setMethod] = useState<DepositMethod>("mobile_money");
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [doneManual, setDoneManual] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const parsed = Number(amountText.replace(",", "."));
  const amount = Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
  const validAmount = amount >= 5 && amount <= 2000;

  const isManual = method === "mobile_money" || method === "sepa";
  const onlineProvider =
    method === "stripe" || method === "paypal"
      ? providers.find((p) => p.id === method)
      : undefined;

  const canSubmit =
    !loading &&
    validAmount &&
    (isManual ? reference.trim().length >= 4 : Boolean(onlineProvider?.enabled));

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      if (method === "mobile_money" || method === "sepa") {
        await api.payments.manual({
          method,
          reference: reference.trim(),
          amount,
        });
        playUiSound(user?.sound, "bet");
        triggerHaptic(user?.haptics, [18, 28]);
        bumpBets();
        setDoneManual(true);
        setLoading(false);
        return;
      }
      const r = await api.payments.create(method, amount);
      window.location.href = r.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dépôt indisponible");
      setLoading(false);
      toast({ kind: "error", title: "Dépôt impossible", description: "Vérifiez les informations" });
    }
  };

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
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[90dvh] w-full max-w-[440px] flex-col rounded-t-3xl border-t border-edge bg-surface shadow-2xl"
      >
        {doneManual ? (
          <div className="px-5 pb-7 pt-6 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-win/15 text-win">
              <Check className="h-7 w-7" strokeWidth={2.6} />
            </div>
            <h3 className="mt-3 font-display text-[18px] font-bold text-ink">
              Demande de dépôt transmise
            </h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-mist">
              Votre dépôt de <strong className="text-ink">{eur(amount)}</strong> (
              {method === "mobile_money" ? "Mobile Money" : "Virement SEPA"}) sera crédité sur votre
              solde dès validation par l&apos;équipe.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 h-11 w-full rounded-2xl bg-betclic-red font-display text-[13.5px] font-bold text-white"
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
                <h2 className="font-display text-[17px] font-bold tracking-tight text-ink">
                  Recharger mon solde
                </h2>
                <p className="text-[11.5px] text-dim">Actuel : {eur(balance)}</p>
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
              <label htmlFor="recharge-amount" className="text-[11.5px] font-semibold text-mist">
                Montant du dépôt (5 € à 2 000 €)
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
                  inputMode="decimal"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value.replace(/[^0-9.,]/g, ""))}
                  className="w-full bg-transparent font-display text-[20px] font-bold tabular-nums text-ink outline-none"
                  aria-label="Montant à recharger"
                />
                <span className="font-display text-[17px] font-bold text-dim">€</span>
              </div>

              <div className="mt-2 grid grid-cols-5 gap-1.5">
                {QUICK.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setAmountText(String(q))}
                    className={cn(
                      "h-8 rounded-xl border font-display text-[12px] font-bold transition-colors active:scale-95",
                      amount === q
                        ? "border-ink bg-ink text-white"
                        : "border-edge bg-elev text-ink"
                    )}
                  >
                    {q} €
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <p className="text-[11.5px] font-semibold text-mist">Moyen de paiement</p>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <MethodCard
                  label="Mobile Money"
                  sub="MTN · Moov · Orange"
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
                  label="Virement SEPA"
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

            {isManual && (
              <div className="mt-3.5">
                <label className="text-[11.5px] font-semibold text-mist">
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
                      ? "Ex : MTN +229 01 97 00 00 00 · Réf 8492"
                      : "Ex : Virement Alex Martin · Réf PULSE-25"
                  }
                  className="mt-1.5 h-11 w-full rounded-2xl border border-edge bg-white px-3.5 text-[14.5px] font-medium text-ink outline-none focus:border-ink"
                />
              </div>
            )}

            {error && (
              <p className="mt-3 rounded-xl bg-betclic-red/8 px-3 py-2 text-[12px] font-medium text-betclic-red">
                {error}
              </p>
            )}

            <button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
              className={cn(
                "mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl font-display text-[14.5px] font-bold transition-all active:scale-[0.99]",
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

            <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[11px] text-dim">
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
          <span className="rounded bg-win/12 px-1.5 py-0.5 font-display text-[9px] font-bold uppercase text-win">
            {badge}
          </span>
        )}
      </div>
      <span className="mt-1.5 font-display text-[12.5px] font-bold text-ink">{label}</span>
      <span className="truncate text-[10.5px] text-dim">{sub}</span>
    </button>
  );
}
