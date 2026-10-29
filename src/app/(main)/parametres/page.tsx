"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Bell,
  ChevronRight,
  Globe,
  History,
  Loader2,
  Lock,
  LogOut,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Vibrate,
  Volume2,
  Wallet,
  X,
  Zap,
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
import { generateIdempotencyKey } from "@/lib/odds-lock";
import { useNetworkQuality } from "@/lib/network-saver";
import { cn, eur, formatPlacedAt, initials, teamHue } from "@/lib/format";

export default function ParametresPage() {
  const {
    authReady,
    user,
    applyUser,
    setBalance,
    toast,
    betsVersion,
    countryConfig,
    currencyConfig,
  } = useApp();
  const { manualDataSaver, autoConstrained, setManualDataSaver } = useNetworkQuality();
  const router = useRouter();
  const [wallet, setWallet] = useState<ClientWalletData | null>(() => getCachedWallet());
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [mobileTab, setMobileTab] = useState<"wallet" | "settings">("wallet");

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
      applyUser(r.user);
      toast({ kind: "success", title: label });
    } catch {
      toast({ kind: "error", title: "Impossible d'enregistrer" });
    }
  };

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api.auth.logout();
    } catch {
      /* déconnexion locale même en cas d'erreur réseau */
    }
    applyUser(null);
    router.push("/auth");
    router.refresh();
    setLoggingOut(false);
  };

  const hue = teamHue(user?.name ?? "Pulse");

  if (!authReady && !user) {
    return <PulseFlashLoader />;
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-2 pb-6 pt-2.5 lg:px-0 lg:py-0">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-[14.5px] font-bold leading-tight tracking-tight text-ink lg:text-[16px]">
          Compte
        </h1>

        {/* Mini-badge profil compact sur mobile */}
        <div className="flex min-w-0 items-center gap-2 lg:hidden">
          <div className="min-w-0 text-right">
            <p className="max-w-[140px] truncate font-display text-[11px] font-medium text-ink">
              {user?.name ?? "—"}
            </p>
            <p className="max-w-[140px] truncate text-[10px] text-dim">
              {user?.email ?? "Session active"}
            </p>
          </div>
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl font-display text-[11px] font-medium text-white"
            style={{
              background: `linear-gradient(140deg, hsl(${hue} 60% 44%), hsl(${(hue + 36) % 360} 68% 30%))`,
            }}
          >
            {initials(user?.name ?? "PU")}
          </span>
        </div>
      </div>

      {/* Découpage mobile en 2 onglets nets : Portefeuille | Réglages */}
      <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-2xl border border-edge bg-white p-1 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileTab("wallet")}
          className={cn(
            "flex h-9.5 items-center justify-center gap-1.5 rounded-xl font-display text-[11px] font-medium transition-colors",
            mobileTab === "wallet"
              ? "bg-betclic-red text-white shadow-2xs"
              : "text-mist active:bg-elev"
          )}
        >
          <Wallet className="h-3.5 w-3.5" strokeWidth={2.3} />
          <span>Portefeuille</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("settings")}
          className={cn(
            "flex h-9.5 items-center justify-center gap-1.5 rounded-xl font-display text-[11px] font-medium transition-colors",
            mobileTab === "settings"
              ? "bg-betclic-red text-white shadow-2xs"
              : "text-mist active:bg-elev"
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2.3} />
          <span>Réglages</span>
        </button>
      </div>

      <div className="mt-3 space-y-4 lg:mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-6 lg:space-y-0">
        {/* Colonne gauche : Portefeuille, Solde et accès direct aux mouvements */}
        <div className={cn("space-y-3", mobileTab !== "wallet" && "hidden lg:block")}>
          <section className="glass-card rounded-2xl p-4 lg:p-5">
            <div className="hidden items-center gap-3 pb-4 lg:flex">
              <span
                className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl font-display text-[12px] font-medium text-white"
                style={{
                  background: `linear-gradient(140deg, hsl(${hue} 60% 44%), hsl(${(hue + 36) % 360} 68% 30%))`,
                }}
              >
                {initials(user?.name ?? "PU")}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-display text-[12.5px] font-medium text-ink">
                    {user?.name ?? "—"}
                  </p>
                  {user?.role === "admin" && (
                    <span className="rounded-md bg-betclic-red/10 px-1.5 py-0.5 font-display text-[9.5px] font-medium uppercase text-betclic-red">
                      Admin
                    </span>
                  )}
                </div>
                <p className="truncate text-[10.5px] text-dim">{user?.email ?? "Session active"}</p>
              </div>
            </div>

            <div className="rounded-xl bg-elev p-3">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <p className="text-[10px] font-medium text-dim">Solde disponible</p>
                  <AnimatedNumber
                    value={user?.balance ?? 0}
                    format={eur}
                    className="mt-0.5 block font-display text-[16px] font-medium leading-none tabular-nums text-ink"
                  />
                  {wallet &&
                    wallet.summary.withdrawable != null &&
                    (wallet.summary.bonusRemaining ?? 0) > 1e-4 &&
                    wallet.summary.withdrawable < (user?.balance ?? 0) - 1e-4 && (
                      <p className="mt-1 text-[10px] font-medium text-mist">
                        Retirable :{" "}
                        <strong className="font-medium text-win">
                          {eur(wallet.summary.withdrawable)}
                        </strong>
                        {wallet.summary.bonusRemaining != null &&
                          wallet.summary.bonusRemaining > 0 && (
                            <span className="text-dim">
                              {" "}
                              · Bonus {eur(wallet.summary.bonusRemaining)}
                            </span>
                          )}
                      </p>
                    )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {wallet && wallet.summary.pendingWithdrawals > 0 && (
                    <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-display text-[9.5px] font-medium text-amber-800">
                      {eur(wallet.summary.pendingWithdrawals)} en retrait
                    </span>
                  )}
                  {wallet && (wallet.summary.pendingDeposits ?? 0) > 0 && (
                    <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 font-display text-[9.5px] font-medium text-sky-800">
                      +{eur(wallet.summary.pendingDeposits ?? 0)} en dépôt
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Link
                  href="/parametres/depot"
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-betclic-red font-display text-[11px] font-medium text-white active:opacity-90"
                >
                  <Plus className="h-4 w-4" strokeWidth={2.6} />
                  Déposer
                </Link>
                <Link
                  href="/parametres/retrait"
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-edge bg-white font-display text-[11px] font-medium text-ink active:bg-surface"
                >
                  <ArrowUpRight className="h-4 w-4 text-betclic-red" strokeWidth={2.4} />
                  Retirer
                </Link>
              </div>
            </div>
          </section>

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

          {/* Lien direct vers la page dédiée des mouvements */}
          <Link
            href="/parametres/transactions"
            className="glass-card flex items-center gap-3 rounded-2xl p-3.5 transition-colors hover:bg-elev/40 active:bg-elev"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-betclic-red/10 text-betclic-red">
              <History className="h-4 w-4" strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-[11.5px] font-medium text-ink">
                Historique des mouvements
              </p>
              <p className="truncate text-[10.5px] text-dim">
                {wallet
                  ? `${wallet.entries.length} opération${wallet.entries.length > 1 ? "s" : ""}`
                  : "Dépôts, retraits, mises et gains"}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.2} />
          </Link>

          {/* Accès Admin (si administrateur) */}
          {user?.role === "admin" && (
            <button
              type="button"
              onClick={() => {
                triggerRouteLoader("/admin");
                router.push("/admin");
              }}
              className="glass-card flex w-full items-center gap-3 rounded-2xl p-3.5 text-left transition-colors active:bg-elev"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-betclic-red/10 text-betclic-red">
                <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-[11.5px] font-medium text-ink">
                  Espace administrateur
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.2} />
            </button>
          )}
        </div>

        {/* Colonne droite : Préférences & Déconnexion */}
        <div className={cn("space-y-3", mobileTab !== "settings" && "hidden lg:block")}>
          <div className="glass-card overflow-hidden rounded-2xl">
            {/* Pays & devise officielle verrouillés à l'inscription */}
            <div className="flex items-center justify-between gap-3 border-b border-edge p-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <IconBox>
                  <Globe className="h-4 w-4" strokeWidth={2.1} />
                </IconBox>
                <div className="min-w-0">
                  <p className="font-display text-[11.5px] font-medium text-ink">
                    Pays & devise du compte
                  </p>
                  <p className="truncate text-[10px] text-dim">
                    {countryConfig.flag} {countryConfig.name} · {currencyConfig.name}
                  </p>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-elev px-2.5 py-1 font-display text-[10px] font-medium text-ink">
                <Lock className="h-3 w-3 text-dim" strokeWidth={2.2} />
                {currencyConfig.code} ({currencyConfig.symbol})
              </span>
            </div>

            {/* Format des cotes */}
            <div className="flex items-center justify-between gap-3 border-b border-edge p-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <IconBox>
                  <SlidersHorizontal className="h-4 w-4" strokeWidth={2.1} />
                </IconBox>
                <p className="font-display text-[11.5px] font-medium text-ink">
                  Format des cotes
                </p>
              </div>
              <div className="flex shrink-0 rounded-xl bg-elev p-0.5">
                {(["decimal", "fractional"] as const).map((fmt) => {
                  const active = (user?.oddsFormat ?? "decimal") === fmt;
                  return (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() =>
                        patch({ oddsFormat: fmt }, "Format des cotes mis à jour")
                      }
                      className={cn(
                        "rounded-lg px-2.5 py-1 font-display text-[10px] font-medium transition-colors",
                        active ? "bg-white text-ink shadow-2xs" : "text-mist"
                      )}
                    >
                      {fmt === "decimal" ? "1.85" : "17/20"}
                    </button>
                  );
                })}
              </div>
            </div>

            <SwitchRow
              Icon={<Bell className="h-4 w-4" strokeWidth={2.1} />}
              label="Toutes les notifications"
              checked={user?.notifications ?? true}
              onChange={(v) => patch({ notifications: v }, "Notifications mises à jour")}
            />
            <SwitchRow
              Icon={<Bell className="h-4 w-4" strokeWidth={2.1} />}
              label="Matchs et buts"
              checked={user?.notifyMatches ?? true}
              onChange={(v) => patch({ notifyMatches: v }, "Préférences mises à jour")}
            />
            <SwitchRow
              Icon={<Bell className="h-4 w-4" strokeWidth={2.1} />}
              label="Résultats des paris"
              checked={user?.notifyBets ?? true}
              onChange={(v) => patch({ notifyBets: v }, "Préférences mises à jour")}
            />
            <SwitchRow
              Icon={<Bell className="h-4 w-4" strokeWidth={2.1} />}
              label="Dépôts et retraits"
              checked={user?.notifyPayments ?? true}
              onChange={(v) => patch({ notifyPayments: v }, "Préférences mises à jour")}
            />
            <SwitchRow
              Icon={<Bell className="h-4 w-4" strokeWidth={2.1} />}
              label="Réclamations"
              checked={user?.notifyDisputes ?? true}
              onChange={(v) => patch({ notifyDisputes: v }, "Préférences mises à jour")}
            />
            <SwitchRow
              Icon={<Volume2 className="h-4 w-4" strokeWidth={2.1} />}
              label="Effets sonores"
              checked={user?.sound ?? true}
              onChange={(v) => patch({ sound: v }, "Sons mis à jour")}
            />
            <SwitchRow
              Icon={<Vibrate className="h-4 w-4" strokeWidth={2.1} />}
              label="Retour haptique"
              checked={user?.haptics ?? true}
              onChange={(v) => patch({ haptics: v }, "Vibrations mises à jour")}
            />
            <SwitchRow
              Icon={<Zap className="h-4 w-4" strokeWidth={2.1} />}
              label="Mode économie 3G"
              checked={manualDataSaver || autoConstrained}
              onChange={(v) => {
                setManualDataSaver(v);
                toast({
                  kind: "success",
                  title: v
                    ? "Mode économie 3G activé"
                    : "Rafraîchissement rapide restauré",
                });
              }}
              last
            />
          </div>

          <button
            type="button"
            onClick={logout}
            disabled={loggingOut}
            className="glass-card flex w-full items-center gap-3 rounded-2xl p-3.5 text-left transition-colors active:bg-betclic-red/5 disabled:opacity-60"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-betclic-red/10 text-betclic-red">
              {loggingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
              ) : (
                <LogOut className="h-4 w-4" strokeWidth={2.1} />
              )}
            </span>
            <p className="font-display text-[11.5px] font-medium text-betclic-red">
              Se déconnecter
            </p>
          </button>
        </div>
      </div>

      <p className="mt-6 text-center text-[10px] leading-relaxed text-dim">
        18+ · Jouer comporte des risques : endettement, isolement, dépendance.
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
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}
