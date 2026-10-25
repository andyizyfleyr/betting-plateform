"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { CreditCard, Loader2, Lock, Wallet, X } from "lucide-react";
import { api, type PaymentProvider } from "@/lib/api";
import { useApp } from "@/components/providers";
import { cn, eur } from "@/lib/format";

const QUICK = [10, 25, 50, 100, 250];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RechargeModal({ open, onClose }: Props) {
  return (
    <AnimatePresence>
      {open && <RechargeSheet onClose={onClose} />}
    </AnimatePresence>
  );
}

function RechargeSheet({ onClose }: { onClose: () => void }) {
  const { toast, balance } = useApp();
  const dragControls = useDragControls();
  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  const [amountText, setAmountText] = useState("25");
  const [provider, setProvider] = useState<"stripe" | "paypal">("stripe");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = providers.filter((p) => p.enabled);

  useEffect(() => {
    let active = true;
    api.payments
      .providers()
      .then((r) => {
        if (!active) return;
        setProviders(r.providers);
        const fallback = r.providers.find((p) => p.enabled);
        if (fallback) setProvider(fallback.id);
      })
      .catch(() => {
        if (active) setProviders([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const parsed = Number(amountText.replace(",", "."));
  const amount = Number.isFinite(parsed) ? parsed : 0;
  const valid = amount >= 5 && amount <= 2000;

  const submit = async () => {
    if (loading || !valid || enabled.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.payments.create(provider, amount);
      window.location.href = r.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Paiement indisponible");
      setLoading(false);
      toast({ kind: "error", title: "Paiement impossible", description: "Réessayez plus tard" });
    }
  };

  const selected = (id: "stripe" | "paypal") => providers.find((p) => p.id === id);

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
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[90dvh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-3xl border-t border-edge bg-surface shadow-2xl"
      >
        <div className="no-scrollbar overflow-y-auto px-4 pb-5 pb-safe pt-2">
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
                "mt-1.5 flex h-13 items-center rounded-2xl border bg-white px-3.5",
                valid ? "border-edge focus-within:border-ink" : "border-betclic-red"
              )}
            >
              <input
                id="recharge-amount"
                type="text"
                inputMode="decimal"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value.replace(/[^0-9.,]/g, ""))}
                className="w-full bg-transparent font-display text-[22px] font-bold tabular-nums text-ink outline-none"
                aria-label="Montant à recharger"
              />
              <span className="font-display text-[18px] font-bold text-dim">€</span>
            </div>

            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {QUICK.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setAmountText(String(q))}
                  className={cn(
                    "h-9 rounded-xl border font-display text-[12.5px] font-bold transition-colors active:scale-95",
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
              <ProviderCard
                provider={selected("stripe")}
                label="Carte bancaire"
                sub="Stripe"
                Icon={CreditCard}
                active={provider === "stripe"}
                onClick={() => setProvider("stripe")}
              />
              <ProviderCard
                provider={selected("paypal")}
                label="PayPal"
                sub="Compte PayPal"
                Icon={Wallet}
                active={provider === "paypal"}
                onClick={() => setProvider("paypal")}
              />
            </div>
          </div>

          {enabled.length === 0 && (
            <p className="mt-3 rounded-xl bg-elev px-3 py-2.5 text-[12px] text-mist">
              Aucun prestataire de paiement n&apos;est actif sur cet environnement.
            </p>
          )}

          {error && (
            <p className="mt-3 rounded-xl bg-betclic-red/8 px-3 py-2 text-[12px] font-medium text-betclic-red">
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={!valid || loading || enabled.length === 0}
            onClick={submit}
            className={cn(
              "mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl font-display text-[14.5px] font-bold transition-all active:scale-[0.99]",
              valid && !loading && enabled.length > 0
                ? "bg-betclic-red text-white shadow-sm"
                : "bg-elev text-dim"
            )}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
            ) : (
              <>Continuer · {eur(valid ? amount : 0)}</>
            )}
          </button>

          <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[11px] text-dim">
            <Lock className="h-3 w-3" strokeWidth={2.2} />
            Transaction chiffrée · crédit immédiat
          </p>
        </div>
      </motion.div>
    </div>
  );
}

function ProviderCard({
  provider,
  label,
  sub,
  Icon,
  active,
  onClick,
}: {
  provider?: PaymentProvider;
  label: string;
  sub: string;
  Icon: typeof CreditCard;
  active: boolean;
  onClick: () => void;
}) {
  const enabled = provider?.enabled ?? false;
  const live = provider?.live ?? false;

  return (
    <button
      type="button"
      onClick={enabled ? onClick : undefined}
      disabled={!enabled}
      className={cn(
        "relative flex flex-col items-start rounded-2xl border p-3 text-left transition-colors",
        !enabled
          ? "cursor-not-allowed border-edge bg-elev/50 opacity-55"
          : active
            ? "border-betclic-red bg-betclic-red/5"
            : "border-edge bg-white active:bg-elev"
      )}
    >
      <div className="flex w-full items-center justify-between">
        <span
          className={cn(
            "grid h-8 w-8 place-items-center rounded-xl",
            active && enabled ? "bg-betclic-red text-white" : "bg-elev text-ink"
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={2.2} />
        </span>
        {enabled && (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 font-display text-[9px] font-bold uppercase",
              live ? "bg-win/10 text-win" : "bg-amber-500/15 text-amber-700"
            )}
          >
            {live ? "Live" : "Test"}
          </span>
        )}
      </div>
      <span className="mt-2 font-display text-[13px] font-bold text-ink">{label}</span>
      <span className="text-[11px] text-dim">{enabled ? sub : "Indisponible"}</span>
    </button>
  );
}
