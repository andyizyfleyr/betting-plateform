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

/** Recharge du solde — choix du montant puis du prestataire (Stripe/PayPal). */
export function RechargeModal({ open, onClose }: Props) {
  const { toast } = useApp();
  const dragControls = useDragControls();
  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  const [amount, setAmount] = useState(25);
  const [provider, setProvider] = useState<"stripe" | "paypal">("stripe");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = providers.filter((p) => p.enabled);

  useEffect(() => {
    if (open) {
      setAmount(25);
      setLoading(false);
      setError(null);
      api.payments.providers().then((r) => {
          setProviders(r.providers);
          const fallback = r.providers.find((p) => p.enabled);
          if (fallback) setProvider(fallback.id);
        })
        .catch(() => setProviders([]));
    }
  }, [open]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const valid = amount >= 5 && amount <= 2000;

  const submit = async () => {
    if (loading || !valid || !provider) return;
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
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={loading ? undefined : onClose}
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: "102%" }}
            animate={{ y: 0 }}
            exit={{ y: "102%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            drag={loading ? false : "y"}
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.55 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 130 || info.velocity.y > 600) onClose();
            }}
            className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] w-full max-w-[27.5rem] flex-col overflow-hidden rounded-t-[24px] border-t border-edge bg-surface shadow-[0_-20px_80px_-20px_rgba(0,0,0,0.3)]"
          >
            <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-betclic-red/70 to-transparent" />

            <div className="no-scrollbar overflow-y-auto px-4 pb-4 pb-safe">
              <div
                onPointerDown={(e) => dragControls.start(e)}
                className="mx-auto mt-2 h-1 w-10 cursor-grab rounded-full bg-elev active:cursor-grabbing"
              />

              <div className="flex items-center justify-between pt-2.5">
                <h2 className="font-display text-base font-bold tracking-tight">Recharger le solde</h2>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={onClose}
                  className="glass-pill grid h-8 w-8 place-items-center rounded-full text-mist"
                  aria-label="Fermer"
                >
                  <X className="h-4 w-4" strokeWidth={2.2} />
                </motion.button>
              </div>

              {/* Montant */}
              <div className="mt-3 flex items-end justify-between px-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[9.5px] font-semibold tracking-[0.24em] text-dim">MONTANT</span>
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setAmount(Number.isFinite(v) ? v : 0);
                    }}
                    className={cn(
                      "w-24 bg-transparent font-display text-[32px] font-bold leading-none tracking-tight tabular-nums outline-none",
                      valid ? "text-ink" : "text-live"
                    )}
                    aria-label="Montant à recharger"
                  />
                  <span className="font-display text-[20px] font-bold text-dim">€</span>
                </div>
              </div>

              <div className="mt-2.5 grid grid-cols-5 gap-1.5">
                {QUICK.map((q) => (
                  <motion.button
                    key={q}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setAmount(q)}
                    className={cn(
                      "glass-pill rounded-lg py-1.5 font-display text-[12px] font-bold transition-colors",
                      amount === q
                        ? "text-betclic-red"
                        : "text-ink active:border-betclic-red/50 active:text-betclic-red"
                    )}
                  >
                    {q}€
                  </motion.button>
                ))}
              </div>

              {(!valid || amount < 5 || amount > 2000) && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="mt-1.5 px-1 text-[11px] font-semibold text-live"
                >
                  Montant valide : 5 € à 2000 €
                </motion.p>
              )}

              {/* Prestataires */}
              <div className="mt-3 px-1">
                <p className="text-[9.5px] font-semibold tracking-[0.24em] text-dim">MOYEN DE PAIEMENT</p>
              </div>

              {enabled.length === 0 && (
                <div className="glass-card mt-2 rounded-2xl px-3.5 py-4 text-[12px] text-mist">
                  Aucun moyen de paiement configuré pour le moment.
                </div>
              )}

              <div className="mt-2 grid grid-cols-2 gap-2">
                <ProviderCard
                    provider={selected("stripe")}
                    label="Carte bancaire"
                    sub="Stripe Checkout"
                    Icon={CreditCard}
                    active={provider === "stripe"}
                    onClick={() => provider && setProvider("stripe")}
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

              {error && (
                <motion.p
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1 }}
                  className="mt-2 text-center text-[11px] font-semibold text-live"
                >
                  {error}
                </motion.p>
              )}

              <motion.button
                whileTap={{ scale: 0.97 }}
                disabled={!valid || loading}
                onClick={submit}
                className={cn(
                  "mt-3 flex h-[50px] w-full items-center justify-center gap-2 rounded-xl font-display text-[14.5px] font-bold transition-opacity",
                  valid && !loading
                    ? "bg-[linear-gradient(135deg,#E10014,#FB6962)] text-white shadow-[0_14px_38px_-10px_rgba(225,0,20,0.6),inset_0_1px_0_rgba(255,255,255,0.4)]"
                    : "bg-elev text-dim"
                )}
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2.4} />
                ) : (
                  <>
                    Recharger {eur(amount)}
                    <span className="opacity-60">·</span>
                    {selected(provider)?.name ?? "Paiement"}
                  </>
                )}
              </motion.button>

              <p className="mt-2 flex items-center justify-center gap-1 text-[9.5px] text-dim">
                <Lock className="h-3 w-3" strokeWidth={2.2} />
                Paiement sécurisé, crédit immédiat sur votre solde.
              </p>
              <p className="mt-1 text-center text-[9px] text-mist">
                18+ · Jouer comporte des risques : endettement, isolement, dépendance.
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
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
    <motion.button
      whileTap={enabled ? { scale: 0.97 } : undefined}
      onClick={enabled ? onClick : undefined}
      disabled={!enabled}
      className={cn(
        "relative flex flex-col items-start gap-2 rounded-2xl border p-3.5 text-left transition-colors",
        !enabled
          ? "cursor-not-allowed border-edge bg-elev/40 opacity-50"
          : active
            ? "border-betclic-red/40 bg-betclic-red/5"
            : "border-edge bg-white"
      )}
    >
      <span
        className={cn(
          "grid h-9 w-9 place-items-center rounded-xl",
          active ? "bg-betclic-red text-white" : "bg-betclic-red/10 text-betclic-red"
        )}
      >
        <Icon className="h-4.5 w-4.5" strokeWidth={2.2} />
      </span>
      <span className="mt-1.5 font-display text-[13px] font-bold leading-tight">{label}</span>
      <span className="text-[10px] text-mist">{enabled ? sub : "Non configuré"}</span>
      {enabled && (
        <span
          className={cn(
            "absolute right-2 top-2 rounded border px-1 py-0.5 font-display text-[8px] font-bold tracking-[0.14em]",
            live ? "border-win/40 text-win" : "border-amber-500/60 text-amber-500"
          )}
        >
          {live ? "LIVE" : "SANDBOX"}
        </span>
      )}
    </motion.button>
  );
}