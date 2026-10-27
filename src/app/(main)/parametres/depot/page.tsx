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
import { getCachedWallet } from "@/lib/client-entity-cache";
import { playUiSound, triggerHaptic } from "@/lib/feedback";
import { generateIdempotencyKey } from "@/lib/odds-lock";
import { useApp } from "@/components/providers";
import { cn, eur } from "@/lib/format";

const QUICK = [10, 25, 50, 100, 250];
type DepositMethod = "mobile_money" | "sepa" | "stripe" | "paypal";

export default function DepositPage() {
  const router = useRouter();
  const { toast, balance, user, bumpBets } = useApp();
  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  const [amountText, setAmountText] = useState("25");
  const [method, setMethod] = useState<DepositMethod>("mobile_money");
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [doneManual, setDoneManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const idempotencySlotRef = useRef<{ key: string; sig: string } | null>(null);

  const cachedWallet = getCachedWallet();
  const displayBalance = balance || cachedWallet?.balance || 0;

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

  if (!user) {
    return (
      <div className="mx-auto max-w-xl px-4 pt-6 pb-8">
        <div className="glass-card rounded-2xl p-6 text-center">
          <p className="font-display text-[17px] font-bold text-ink">
            Connectez-vous pour effectuer un dépôt
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
      window.location.href = r.url;
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
                Déposer des fonds
              </h1>
              <p className="truncate text-[11px] text-dim">
                Solde disponible : {eur(displayBalance)}
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
        {doneManual ? (
          <div className="glass-card rounded-2xl p-6 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-win/15 text-win">
              <Check className="h-7 w-7" strokeWidth={2.6} />
            </div>
            <h2 className="mt-3 font-display text-[18px] font-extrabold text-ink">
              Demande de dépôt enregistrée
            </h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-mist">
              Votre dépôt de <strong className="text-ink">{eur(amount)}</strong> (
              {method === "mobile_money" ? "Mobile Money" : "Virement SEPA"}) sera
              crédité sur votre solde dès validation.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2.5">
              <Link
                href="/parametres/transactions"
                className="rounded-xl bg-elev px-4 py-2.5 font-display text-[12.5px] font-bold text-ink"
              >
                Suivre mes transactions
              </Link>
              <Link
                href="/matchs"
                className="btn-red rounded-xl px-5 py-2.5 text-[12.5px]"
              >
                Retour aux matchs
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Montant du dépôt */}
            <section className="glass-card rounded-2xl p-4">
              <label className="text-[11px] font-bold uppercase tracking-wider text-mist">
                Montant à créditer (5 € – 2 000 €)
              </label>
              <div className="mt-2 flex items-center gap-2 rounded-2xl border border-edge bg-elev/60 px-3.5 py-2.5 focus-within:border-betclic-red">
                <input
                  type="text"
                  inputMode="decimal"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  className="w-full bg-transparent font-display text-[22px] font-black tabular-nums text-ink outline-none"
                  placeholder="25"
                />
                <span className="font-display text-[18px] font-extrabold text-dim">
                  €
                </span>
              </div>

              <div className="mt-3 grid grid-cols-5 gap-1.5">
                {QUICK.map((q) => {
                  const active = amount === q;
                  return (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setAmountText(String(q))}
                      className={cn(
                        "h-9 rounded-xl font-display text-[12px] font-bold tabular-nums transition-colors",
                        active
                          ? "bg-betclic-red text-white shadow-xs"
                          : "bg-elev text-ink hover:bg-edge"
                      )}
                    >
                      {q} €
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Méthode de paiement */}
            <section className="glass-card rounded-2xl p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-mist">
                Moyen de paiement
              </p>

              <div className="mt-2.5 grid grid-cols-2 gap-2">
                {[
                  {
                    id: "mobile_money" as const,
                    label: "Mobile Money",
                    sub: "MTN · Moov · Orange",
                    Icon: Smartphone,
                    available: true,
                  },
                  {
                    id: "sepa" as const,
                    label: "Virement SEPA",
                    sub: "IBAN instantané",
                    Icon: Building2,
                    available: true,
                  },
                  {
                    id: "stripe" as const,
                    label: "Carte bancaire",
                    sub: stripeInfo?.enabled ? "Visa · Mastercard" : "Bientôt actif",
                    Icon: CreditCard,
                    available: Boolean(stripeInfo?.enabled),
                  },
                  {
                    id: "paypal" as const,
                    label: "PayPal",
                    sub: paypalInfo?.enabled ? "Paiement express" : "Bientôt actif",
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
                        "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all",
                        selected
                          ? "border-betclic-red bg-betclic-red/8"
                          : "border-edge bg-elev/40 hover:border-ink/20",
                        !m.available && "cursor-not-allowed opacity-50"
                      )}
                    >
                      <m.Icon
                        className={cn(
                          "h-4 w-4",
                          selected ? "text-betclic-red" : "text-mist"
                        )}
                      />
                      <span className="font-display text-[12.5px] font-bold text-ink">
                        {m.label}
                      </span>
                      <span className="text-[10.5px] text-dim">{m.sub}</span>
                    </button>
                  );
                })}
              </div>

              {isManual && (
                <div className="mt-3.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-mist">
                    {method === "mobile_money"
                      ? "Numéro ou référence Mobile Money"
                      : "Référence du virement SEPA"}
                  </label>
                  <input
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder={
                      method === "mobile_money"
                        ? "Ex. MTN +229 01 … / ID TXN"
                        : "Ex. Réf. virement SEPA"
                    }
                    className="mt-1.5 h-11 w-full rounded-xl border border-edge bg-elev/60 px-3.5 text-[13px] font-medium text-ink outline-none focus:border-betclic-red"
                  />
                </div>
              )}

              {error && (
                <p className="mt-3 rounded-xl bg-betclic-red/10 px-3 py-2 text-[12px] font-semibold text-betclic-red">
                  {error}
                </p>
              )}

              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void submit()}
                className={cn(
                  "mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl font-display text-[14px] font-extrabold transition-all",
                  canSubmit
                    ? "bg-win text-white shadow-sm active:scale-[0.99]"
                    : "cursor-not-allowed bg-elev text-dim"
                )}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Lock className="h-4 w-4" />
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
