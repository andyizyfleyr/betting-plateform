"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  ArrowUpRight,
  Eye,
  EyeOff,
  Info,
  Bell,
  ChevronRight,
  History,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  User,
  X,
} from "lucide-react";
import { api, type ClientUser, type ClientWalletData } from "@/lib/api";
import { getCachedWallet } from "@/lib/client-entity-cache";
import { useApp } from "@/components/providers";
import {
  PulseFlashLoader,
  triggerRouteLoader,
} from "@/components/pulse-flash-loader";
import { AnimatedNumber } from "@/components/animated-number";
import { Toggle } from "@/components/toggle";
import { TransferCodeSheet } from "@/components/transfer-code-sheet";
import { generateIdempotencyKey } from "@/lib/odds-lock";
import { writeUserPreferences } from "@/lib/user-preferences";
import { cn, eur, formatPlacedAt } from "@/lib/format";

export default function ParametresPage() {
  const {
    authReady,
    user,
    applyUser,
    setBalance,
    toast,
    betsVersion,
    transferCodesEnabled,
  } = useApp();
  const router = useRouter();
  const [wallet, setWallet] = useState<ClientWalletData | null>(() => getCachedWallet());
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [profilName, setProfilName] = useState("");
  const [profilEmail, setProfilEmail] = useState("");
  const [profilSaving, setProfilSaving] = useState(false);
  const [profilEditing, setProfilEditing] = useState(false);

  const toggleProfilEditing = () => {
    if (!profilEditing) {
      setProfilName(user?.name ?? "");
      setProfilEmail(user?.email ?? "");
    }
    setProfilEditing((v) => !v);
  };

  const saveProfile = async () => {
    const name = profilName.trim();
    const email = profilEmail.trim();
    if (name.length === 0 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ kind: "error", title: "Nom ou email invalide" });
      return;
    }
    if (name === user?.name && email === user?.email) {
      toast({ kind: "info", title: "Aucune modification" });
      return;
    }
    setProfilSaving(true);
    try {
      const r = await api.auth.updateProfile({ name, email });
      applyUser(r.user);
      toast({ kind: "success", title: "Profil mis à jour" });
      setProfilEditing(false);
    } catch {
      toast({ kind: "error", title: "Impossible d'enregistrer le profil" });
    } finally {
      setProfilSaving(false);
    }
  };

  const reloadWallet = useCallback(() => {
    api
      .wallet()
      .then((w) => setWallet(w))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    const run = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      api
        .wallet()
        .then((w) => {
          if (active) setWallet(w);
        })
        .catch(() => undefined);
    };
    run();
    const id = setInterval(run, 8_000);
    const onVisible = () => {
      if (!document.hidden) run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [betsVersion, user?.id]);

  // Retour de paiement (Stripe/PayPal) via les params d'URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flow = params.get("deposit");

    if (flow === "cancelled") {
      toast({ kind: "info", title: "Paiement annulé" });
      window.history.replaceState({}, "", "/parametres");
      return;
    }

    if (flow === "stripe") {
      const ref = params.get("ref");
      toast({ kind: "info", title: "Confirmation du paiement…" });
      let tries = 0;
      const tick = async () => {
        if (!ref) return;
        try {
          const s = await api.payments.status(ref);
          if (s.credited) {
            const r = await api.settings();
            applyUser(r.user);
            reloadWallet();
            toast({ kind: "success", title: "Solde rechargé" });
            window.history.replaceState({}, "", "/parametres");
            return;
          }
        } catch {
          /* nouvelle tentative */
        }
        tries += 1;
        if (tries < 8) window.setTimeout(tick, 1500);
        else
          toast({
            kind: "info",
            title: "Vérification en cours",
            description: "Actualisez dans quelques secondes",
          });
      };
      void tick();
      return;
    }

    if (flow === "paypal") {
      const orderId = params.get("token");
      if (orderId) {
        (async () => {
          toast({ kind: "info", title: "Validation du paiement…" });
          try {
            const safeOrderToken = orderId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
            const idemKey =
              safeOrderToken.length >= 6
                ? `ppcap_${safeOrderToken}_v1`
                : generateIdempotencyKey("ppcap");
            const r = await api.payments.capturePayPal(orderId, idemKey);
            if (r.user) applyUser(r.user);
            reloadWallet();
            toast({ kind: "success", title: "Solde rechargé" });
          } catch {
            toast({ kind: "error", title: "Paiement non confirmé" });
          }
          window.history.replaceState({}, "", "/parametres");
        })();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingWithdrawalEntries = useMemo(
    () =>
      (wallet?.entries ?? []).filter(
        (e) =>
          e.type === "withdrawal" &&
          e.canCancel &&
          e.rawId != null
      ),
    [wallet]
  );

  const cancelSlotRef = useRef<Map<number, string>>(new Map());
  const cancelInFlightRef = useRef(false);

  const cancelWithdrawal = async (withdrawalId: number) => {
    if (cancellingId != null || cancelInFlightRef.current) return;
    cancelInFlightRef.current = true;
    const idemKey =
      cancelSlotRef.current.get(withdrawalId) ?? generateIdempotencyKey("wdcancel");
    cancelSlotRef.current.set(withdrawalId, idemKey);
    setCancellingId(withdrawalId);
    try {
      const res = await api.cancelWithdrawal(withdrawalId, idemKey);
      cancelSlotRef.current.delete(withdrawalId);
      setBalance(res.balance);
      reloadWallet();
      toast({ kind: "success", title: "Retrait annulé et recrédité" });
    } catch (e) {
      toast({
        kind: "error",
        title: "Annulation impossible",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      cancelInFlightRef.current = false;
      setCancellingId(null);
    }
  };

  const patch = async (p: Partial<ClientUser>, label: string) => {
    try {
      const r = await api.patchSettings(p);
      // Miroir local : le choix survit à la fermeture de l'application.
      writeUserPreferences(r.user.id, p);
      applyUser(r.user);
      toast({ kind: "success", title: label });
    } catch {
      toast({ kind: "error", title: "Impossible d'enregistrer" });
    }
  };


  if (!authReady && !user) {
    return <PulseFlashLoader />;
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-2 pb-6 pt-2.5 lg:px-0 lg:py-0">
      {/* Carte Solde disponible — fond blanc, tout en haut */}
      <section className="rounded-2xl border border-edge bg-white p-3.5 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-dim">Solde disponible</p>
            {balanceVisible ? (
              <AnimatedNumber value={user?.balance ?? 0} format={eur} className="mt-1 block font-display text-[23px] font-bold leading-tight tabular-nums text-ink" />
            ) : (
              <span className="mt-1 block text-[23px] font-bold leading-tight tabular-nums" aria-label="Solde masqué">••••••</span>
            )}
          </div>
          <button type="button" onClick={() => setBalanceVisible(v => !v)} aria-label={balanceVisible ? "Masquer le solde du portefeuille" : "Afficher le solde du portefeuille"} aria-pressed={!balanceVisible} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-elev text-mist active:bg-edge">{balanceVisible ? <Eye size={18} /> : <EyeOff size={18} />}</button>
        </div>
        {balanceVisible && wallet && wallet.summary.withdrawable != null && (wallet.summary.bonusRemaining ?? 0) > 1e-4 && wallet.summary.withdrawable < (user?.balance ?? 0) - 1e-4 && (
          <p className="mt-1 text-[10px] font-medium text-mist">
            Retirable: <strong className="font-medium text-win">{eur(wallet.summary.withdrawable)}</strong>
            {wallet.summary.bonusRemaining != null && wallet.summary.bonusRemaining > 0 && <span className="text-dim"> · Bonus {eur(wallet.summary.bonusRemaining)}</span>}
          </p>
        )}
        <div className={cn("mt-3 grid gap-2", transferCodesEnabled ? "grid-cols-3" : "grid-cols-2")}>
          <Link href="/parametres/depot" className="flex min-h-10 items-center justify-center gap-1 rounded-xl border border-edge bg-white font-display text-[10.5px] font-medium text-betclic-red active:bg-elev"><Plus size={17} />Déposer</Link>
          <Link href="/parametres/retrait" className="flex min-h-10 items-center justify-center gap-1 rounded-xl border border-edge bg-white font-display text-[10.5px] font-medium text-ink active:bg-elev"><ArrowUpRight size={17} />Retirer</Link>
          {transferCodesEnabled && (
            <button type="button" onClick={() => setTransferOpen(true)} className="flex min-h-10 items-center justify-center gap-1 rounded-xl border border-edge bg-white font-display text-[10.5px] font-medium text-ink active:bg-elev"><ArrowLeftRight size={17} />Transférer</button>
          )}
        </div>
      </section>

      <div className="mt-3 space-y-3 lg:mt-4">
        {/* Retraits en attente avec annulation immédiate */}
        {pendingWithdrawalEntries.length > 0 && (
          <section className="glass-card divide-y divide-edge overflow-hidden rounded-2xl">
            {pendingWithdrawalEntries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-2.5 p-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate font-display text-[11px] font-medium text-ink">
                    Retrait en attente · {eur(Math.abs(entry.amount))}
                  </p>
                  <p className="truncate text-[10px] text-dim">
                    {entry.subtitle} · {formatPlacedAt(entry.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={cancellingId === entry.rawId}
                  onClick={() =>
                    entry.rawId != null && cancelWithdrawal(entry.rawId)
                  }
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-edge bg-elev px-2.5 font-display text-[10px] font-medium text-ink active:scale-95 disabled:opacity-50"
                >
                  {cancellingId === entry.rawId ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.4} />
                  )}
                  Annuler
                </button>
              </div>
            ))}
          </section>
        )}

        {/* Section unique : profil, opérations, réglages, espace administrateur */}
        <section className="glass-card divide-y divide-edge overflow-hidden rounded-2xl">
          {/* Mon profil — nom modifiable, édition repliée derrière le bouton Modifier */}
          <div className="flex items-center gap-3 p-3.5">
            <IconBox><User className="h-4 w-4" strokeWidth={2.1} /></IconBox>
            <p className="min-w-0 flex-1 font-display text-[11.5px] font-medium text-ink">Mon profil</p>
            <button
              type="button"
              onClick={toggleProfilEditing}
              aria-label={profilEditing ? "Fermer la modification du profil" : "Modifier le nom"}
              aria-expanded={profilEditing}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-elev text-ink active:bg-edge"
            >
              {profilEditing ? <X size={14} strokeWidth={2.4} /> : <Pencil size={14} strokeWidth={2.2} />}
            </button>
          </div>

          {profilEditing && (
            <div className="space-y-3 p-3.5">
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-dim">Nom</span>
                <input
                  type="text"
                  value={profilName}
                  onChange={(e) => setProfilName(e.target.value)}
                  placeholder="Votre nom"
                  maxLength={80}
                  className="w-full rounded-xl border border-edge bg-white px-3 py-2.5 font-display text-[12px] font-medium text-ink outline-none transition-colors placeholder:text-mist focus:border-betclic-red/60 focus:ring-2 focus:ring-betclic-red/15"
                />
              </label>
              <button
                type="button"
                onClick={saveProfile}
                disabled={profilSaving}
                className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-betclic-red font-display text-[12px] font-medium text-white transition-opacity active:opacity-90 disabled:opacity-60"
              >
                {profilSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" strokeWidth={2.4} />}
                Enregistrer le profil
              </button>
            </div>
          )}

          <Link href="/parametres/transactions" className="flex items-center gap-3 p-3.5 active:bg-elev">
            <IconBox><History className="h-4 w-4" strokeWidth={2.1} /></IconBox>
            <p className="min-w-0 flex-1 font-display text-[11.5px] font-medium text-ink">Dernières opérations</p>
            <ChevronRight className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.2} />
          </Link>

          <div className="flex items-center justify-between gap-3 p-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <IconBox><SlidersHorizontal className="h-4 w-4" strokeWidth={2.1} /></IconBox>
              <p className="font-display text-[11.5px] font-medium text-ink">Format des cotes</p>
            </div>
            <div className="flex shrink-0 rounded-xl bg-elev p-0.5">
              {(["decimal", "fractional"] as const).map((fmt) => (
                <button key={fmt} type="button" onClick={() => patch({ oddsFormat: fmt }, "Format des cotes mis à jour")}
                  aria-pressed={(user?.oddsFormat ?? "decimal") === fmt}
                  className={cn("rounded-lg px-2.5 py-1 text-[10px] font-medium transition-colors", (user?.oddsFormat ?? "decimal") === fmt ? "bg-white text-ink shadow-2xs" : "text-mist")}>
                  {fmt === "decimal" ? "1.85" : "17/20"}
                </button>
              ))}
            </div>
          </div>

          <SwitchRow Icon={<Bell className="h-4 w-4" />} label="Toutes les notifications" checked={user?.notifications ?? true} onChange={(v) => patch({ notifications: v, notifyMatches: v, notifyBets: v, notifyPayments: v }, v ? "Toutes les notifications activées" : "Notifications désactivées")} last={user?.role !== "admin"} />

          {user?.role === "admin" && (
            <button
              type="button"
              onClick={() => {
                triggerRouteLoader("/admin");
                router.push("/admin");
              }}
              className="flex w-full items-center gap-3 p-3.5 text-left active:bg-elev"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-betclic-red/10 text-betclic-red">
                <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />
              </span>
              <p className="min-w-0 flex-1 font-display text-[11.5px] font-medium text-ink">Espace administrateur</p>
              <ChevronRight className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.2} />
            </button>
          )}
        </section>
      </div>

      {transferOpen && <TransferCodeSheet open onClose={() => setTransferOpen(false)} withdrawable={wallet?.summary.withdrawable == null ? "indisponible" : eur(wallet.summary.withdrawable)} withdrawableEur={wallet?.summary.withdrawable} />}
      <p className="mt-3 flex items-start gap-2 rounded-xl bg-white p-3 text-[10px] leading-relaxed text-mist lg:mt-6 lg:block lg:bg-transparent lg:p-0 lg:text-center lg:text-dim">
        <Info className="h-4 w-4 shrink-0 lg:hidden" /> <span>18+ · Jouer comporte des risques: endettement, isolement, dépendance.</span>
      </p>
    </div>
  );
}

function IconBox({ children }: { children: ReactNode }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-elev text-ink">
      {children}
    </span>
  );
}

function SwitchRow({
  Icon,
  label,
  checked,
  onChange,
  last,
}: {
  Icon: ReactNode;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3 p-3.5", !last && "border-b border-edge")}>
      <IconBox>{Icon}</IconBox>
      <p className="min-w-0 flex-1 font-display text-[11.5px] font-medium text-ink">
        {label}
      </p>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}
