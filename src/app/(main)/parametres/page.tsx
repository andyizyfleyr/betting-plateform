"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  ChevronRight,
  HandCoins,
  History,
  Loader2,
  LogOut,
  PhoneCall,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Vibrate,
  Volume2,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { api, type ClientBet, type ClientUser, type ClientWalletData } from "@/lib/api";
import { useApp } from "@/components/providers";
import { AnimatedNumber } from "@/components/animated-number";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import { Toggle } from "@/components/toggle";
import { WithdrawModal } from "@/components/withdraw-modal";
import { generateIdempotencyKey } from "@/lib/odds-lock";
import { useNetworkQuality } from "@/lib/network-saver";
import { cn, eur, formatPlacedAt, initials, teamHue } from "@/lib/format";

type LedgerFilter = "all" | "deposit" | "withdrawal" | "gains" | "stakes";
type LedgerFlowFilter = "all" | "credit" | "debit";

export default function ParametresPage() {
  const { user, applyUser, setBalance, toast, openRecharge, betsVersion } = useApp();
  const { manualDataSaver, autoConstrained, setManualDataSaver } = useNetworkQuality();
  const router = useRouter();
  const [bets, setBets] = useState<ClientBet[] | null>(null);
  const [wallet, setWallet] = useState<ClientWalletData | null>(null);
  const [walletFilter, setWalletFilter] = useState<LedgerFilter>("all");
  const [walletFlow, setWalletFlow] = useState<LedgerFlowFilter>("all");
  const [showAllLedger, setShowAllLedger] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
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
    api
      .allBets()
      .then((r) => {
        if (active) setBets(r.bets);
      })
      .catch(() => undefined);
    api
      .wallet()
      .then((w) => {
        if (active) setWallet(w);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [betsVersion]);

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

  const stats = useMemo(() => {
    const all = bets ?? [];
    const won = all.filter((b) => b.status === "won");
    const settledBets = all.filter((b) => b.status === "won" || b.status === "lost");
    const gains =
      won.reduce((s, b) => s + b.potentialWin, 0) +
      all
        .filter((b) => b.status === "cashed")
        .reduce((s, b) => s + (b.cashOutAmount ?? 0), 0);
    const rate = settledBets.length ? Math.round((won.length / settledBets.length) * 100) : 0;
    return { total: all.length, wins: won.length, gains, rate };
  }, [bets]);

  const ledgerCounts = useMemo(() => {
    const entries = wallet?.entries ?? [];
    return {
      all: entries.length,
      gains: entries.filter((e) => e.type === "win" || e.type === "cashout").length,
      stakes: entries.filter((e) => e.type === "stake").length,
      deposit: entries.filter((e) => e.type === "deposit" || e.type === "adjustment").length,
      withdrawal: entries.filter((e) => e.type === "withdrawal").length,
    };
  }, [wallet]);

  const byLedgerType = useMemo(() => {
    const entries = wallet?.entries ?? [];
    if (walletFilter === "all") return entries;
    if (walletFilter === "deposit") {
      return entries.filter((e) => e.type === "deposit" || e.type === "adjustment");
    }
    if (walletFilter === "withdrawal") return entries.filter((e) => e.type === "withdrawal");
    if (walletFilter === "stakes") return entries.filter((e) => e.type === "stake");
    return entries.filter((e) => e.type === "win" || e.type === "cashout");
  }, [wallet, walletFilter]);

  const creditCount = useMemo(
    () => byLedgerType.filter((e) => e.amount > 0).length,
    [byLedgerType]
  );
  const debitCount = byLedgerType.length - creditCount;

  const filteredLedger = useMemo(() => {
    if (walletFlow === "credit") return byLedgerType.filter((e) => e.amount > 0);
    if (walletFlow === "debit") return byLedgerType.filter((e) => e.amount <= 0);
    return byLedgerType;
  }, [byLedgerType, walletFlow]);

  const visibleLedger = showAllLedger ? filteredLedger : filteredLedger.slice(0, 6);

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

  return (
    <div className="mx-auto w-full max-w-[1380px] px-4 pb-8 pt-3.5 lg:px-0 lg:py-0">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[20px] font-bold leading-tight tracking-tight text-ink lg:text-[24px]">
            Compte
          </h1>
          <p className="hidden text-[13px] text-mist lg:block">
            Profil, portefeuille et préférences
          </p>
        </div>

        {/* Mini-badge profil compact sur mobile */}
        <div className="flex min-w-0 items-center gap-2 lg:hidden">
          <div className="min-w-0 text-right">
            <p className="max-w-[140px] truncate font-display text-[13px] font-bold text-ink">
              {user?.name ?? "—"}
            </p>
            <p className="max-w-[140px] truncate text-[10.5px] text-dim">
              {user?.email ?? "Session active"}
            </p>
          </div>
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl font-display text-[12.5px] font-bold text-white"
            style={{
              background: `linear-gradient(140deg, hsl(${hue} 60% 44%), hsl(${(hue + 36) % 360} 68% 30%))`,
            }}
          >
            {initials(user?.name ?? "PU")}
          </span>
        </div>
      </div>

      {/* Découpage mobile en 2 onglets nets : Portefeuille | Réglages (Point 9) */}
      <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-2xl border border-edge bg-white p-1 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileTab("wallet")}
          className={cn(
            "flex h-9.5 items-center justify-center gap-1.5 rounded-xl font-display text-[12.5px] font-bold transition-colors",
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
            "flex h-9.5 items-center justify-center gap-1.5 rounded-xl font-display text-[12.5px] font-bold transition-colors",
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
        {/* Colonne gauche : Portefeuille, Solde et Mouvements */}
        <div className={cn(mobileTab !== "wallet" && "hidden lg:block")}>
      {/* Profil (desktop) + Solde + Dépôt / Retrait */}
      <section className="glass-card rounded-2xl p-4 lg:p-5">
        <div className="hidden items-center gap-3 pb-4 lg:flex">
          <span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl font-display text-[15px] font-bold text-white"
            style={{
              background: `linear-gradient(140deg, hsl(${hue} 60% 44%), hsl(${(hue + 36) % 360} 68% 30%))`,
            }}
          >
            {initials(user?.name ?? "PU")}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-display text-[16px] font-bold text-ink">
                {user?.name ?? "—"}
              </p>
              {user?.role === "admin" && (
                <span className="rounded-md bg-betclic-red/10 px-1.5 py-0.5 font-display text-[10px] font-bold uppercase text-betclic-red">
                  Admin
                </span>
              )}
            </div>
            <p className="truncate text-[12px] text-dim">{user?.email ?? "Session active"}</p>
          </div>
        </div>

        <div className="rounded-xl bg-elev p-3">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <p className="text-[11px] font-medium text-dim">Solde disponible</p>
              <AnimatedNumber
                value={user?.balance ?? 0}
                format={eur}
                className="mt-0.5 block font-display text-[24px] font-bold leading-none tabular-nums text-ink"
              />
              {wallet &&
                wallet.summary.withdrawable != null &&
                wallet.summary.withdrawable < (user?.balance ?? 0) && (
                  <p className="mt-1 text-[11px] font-medium text-mist">
                    Retirable :{" "}
                    <strong className="font-semibold text-win">
                      {eur(wallet.summary.withdrawable)}
                    </strong>
                    {wallet.summary.bonusRemaining != null && wallet.summary.bonusRemaining > 0 && (
                      <span className="text-dim">
                        {" "}
                        · Bonus à rejouer {eur(wallet.summary.bonusRemaining)}
                      </span>
                    )}
                  </p>
                )}
            </div>
            <div className="flex flex-col items-end gap-1">
              {wallet && wallet.summary.pendingWithdrawals > 0 && (
                <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-display text-[10px] font-bold text-amber-800">
                  {eur(wallet.summary.pendingWithdrawals)} en retrait
                </span>
              )}
              {wallet && (wallet.summary.pendingDeposits ?? 0) > 0 && (
                <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 font-display text-[10px] font-bold text-sky-800">
                  +{eur(wallet.summary.pendingDeposits ?? 0)} en dépôt
                </span>
              )}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={openRecharge}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-betclic-red font-display text-[12.5px] font-bold text-white active:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={2.6} />
              Déposer
            </button>
            <button
              type="button"
              onClick={() => setWithdrawOpen(true)}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-edge bg-white font-display text-[12.5px] font-bold text-ink active:bg-surface"
            >
              <ArrowUpRight className="h-4 w-4 text-betclic-red" strokeWidth={2.4} />
              Retirer
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 divide-x divide-edge border-t border-edge pt-3 text-center">
          <div>
            <p className="font-display text-[15px] font-bold tabular-nums text-ink">{stats.total}</p>
            <p className="text-[10px] font-medium text-dim">Paris</p>
          </div>
          <div>
            <p className="font-display text-[15px] font-bold tabular-nums text-win">{stats.wins}</p>
            <p className="text-[10px] font-medium text-dim">Gagnés</p>
          </div>
          <div>
            <p className="font-display text-[15px] font-bold tabular-nums text-ink">
              {stats.total ? `${stats.rate}%` : "—"}
            </p>
            <p className="text-[10px] font-medium text-dim">Réussite</p>
          </div>
        </div>
      </section>

      {/* Accès Admin (si administrateur) */}
      {user?.role === "admin" && (
        <button
          type="button"
          onClick={() => router.push("/admin")}
          className="glass-card mt-3 flex w-full items-center gap-3 rounded-2xl p-3.5 text-left transition-colors active:bg-elev"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-betclic-red/10 text-betclic-red">
            <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[13.5px] font-bold text-ink">Espace administrateur</p>
            <p className="text-[11.5px] text-dim">Matchs, pronostics, retraits et statistiques</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.2} />
        </button>
      )}

      {/* Portefeuille & Historique complet des transactions */}
      <div className="mt-5 flex items-center justify-between px-0.5">
        <h2 className="flex items-center gap-1.5 font-display text-[12px] font-bold uppercase tracking-wider text-mist">
          <History className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.3} />
          Portefeuille & Mouvements
        </h2>
      </div>

      <FilterDropdownRow
        sticky={false}
        filters={[
          {
            id: "ledger-type",
            placeholder: "Catégorie",
            value: walletFilter,
            defaultValue: "all",
            onChange: setWalletFilter,
            options: [
              {
                value: "all",
                label: "Tous",
                count: wallet ? ledgerCounts.all : undefined,
              },
              {
                value: "gains",
                label: "Gains",
                count: wallet ? ledgerCounts.gains : undefined,
              },
              {
                value: "stakes",
                label: "Mises",
                count: wallet ? ledgerCounts.stakes : undefined,
              },
              {
                value: "deposit",
                label: "Dépôts",
                count: wallet ? ledgerCounts.deposit : undefined,
              },
              {
                value: "withdrawal",
                label: "Retraits",
                count: wallet ? ledgerCounts.withdrawal : undefined,
              },
            ],
          },
          {
            id: "ledger-flow",
            placeholder: "Flux",
            value: walletFlow,
            defaultValue: "all",
            onChange: setWalletFlow,
            options: [
              {
                value: "all",
                label: "Tous flux",
                count: wallet ? byLedgerType.length : undefined,
              },
              {
                value: "credit",
                label: "Entrées (+)",
                pillLabel: "Entrées",
                count: wallet ? creditCount : undefined,
              },
              {
                value: "debit",
                label: "Sorties (−)",
                pillLabel: "Sorties",
                count: wallet ? debitCount : undefined,
              },
            ],
          },
        ]}
        onReset={() => {
          setWalletFilter("all");
          setWalletFlow("all");
        }}
        resultCountText={
          wallet
            ? `${filteredLedger.length} mouvement${filteredLedger.length > 1 ? "s" : ""}`
            : null
        }
      />

      <section className="glass-card rounded-2xl p-3.5">
        {visibleLedger.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-dim">
            Aucun mouvement dans cette catégorie.
          </p>
        ) : (
          <div className="divide-y divide-edge">
            {visibleLedger.map((entry) => {
              const positive = entry.amount > 0;
              const isRejectedOrCancelled =
                entry.status === "rejected" || entry.status === "cancelled";
              return (
                <div key={entry.id} className="flex items-center gap-2.5 py-2.5 first:pt-0 last:pb-0">
                  <span
                    className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-xl",
                      positive ? "bg-win/12 text-win" : "bg-elev text-ink"
                    )}
                  >
                    {positive ? (
                      <ArrowDownLeft className="h-4 w-4" strokeWidth={2.3} />
                    ) : (
                      <ArrowUpRight className="h-4 w-4" strokeWidth={2.3} />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate font-display text-[12.5px] font-semibold text-ink">
                        {entry.title}
                      </p>
                      {entry.type === "withdrawal" && (
                        <WithdrawalBadge status={entry.status} />
                      )}
                    </div>
                    <p className="truncate text-[11px] text-dim">
                      {entry.subtitle} · {formatPlacedAt(entry.createdAt)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={cn(
                        "font-display text-[13px] font-bold tabular-nums",
                        isRejectedOrCancelled
                          ? "text-dim line-through"
                          : positive
                            ? "text-win"
                            : "text-ink"
                      )}
                    >
                      {positive ? `+${eur(entry.amount)}` : eur(entry.amount)}
                    </span>

                    {entry.canCancel && entry.rawId != null && (
                      <button
                        type="button"
                        disabled={cancellingId === entry.rawId}
                        onClick={() => cancelWithdrawal(entry.rawId!)}
                        title="Annuler le retrait"
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-edge bg-elev px-2 font-display text-[10.5px] font-bold text-ink active:bg-edge disabled:opacity-50"
                      >
                        {cancellingId === entry.rawId ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <X className="h-3 w-3" strokeWidth={2.3} />
                        )}
                        Annuler
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {filteredLedger.length > 6 && (
          <button
            type="button"
            onClick={() => setShowAllLedger((s) => !s)}
            className="mt-3 w-full rounded-xl bg-elev py-2 font-display text-[11.5px] font-bold text-ink"
          >
            {showAllLedger ? "Réduire l'historique" : `Voir tout (${filteredLedger.length})`}
          </button>
        )}
      </section>
        </div>

        {/* Colonne droite : Préférences + Assistance & Session */}
        <div className={cn(mobileTab !== "settings" && "hidden lg:block", "lg:sticky lg:top-[84px]")}>
      {/* Préférences réelles */}
      <h2 className="px-0.5 font-display text-[12px] font-bold uppercase tracking-wider text-mist">
        Préférences
      </h2>
      <div className="glass-card mt-2 overflow-hidden rounded-2xl">
        <div className="border-b border-edge p-3.5">
          <div className="flex items-center gap-3">
            <IconBox>
              <HandCoins className="h-4 w-4" strokeWidth={2.1} />
            </IconBox>
            <div>
              <p className="font-display text-[13.5px] font-semibold text-ink">Format des cotes</p>
              <p className="text-[11px] text-dim">Affichage sur les matchs et prédictions</p>
            </div>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-1 rounded-xl border border-edge bg-elev p-1">
            {(
              [
                { v: "decimal", label: "Décimal (1,95)" },
                { v: "fractional", label: "Fraction (19/20)" },
              ] as const
            ).map(({ v, label }) => {
              const active = (user?.oddsFormat ?? "decimal") === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => patch({ oddsFormat: v }, "Format des cotes mis à jour")}
                  className={cn(
                    "h-8 rounded-lg font-display text-[12px] transition-colors",
                    active ? "bg-ink font-bold text-white" : "font-medium text-mist"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <SwitchRow
          Icon={<Bell className="h-4 w-4" strokeWidth={2.1} />}
          label="Notifications de paris"
          hint="Alerte quand un pari est réglé"
          checked={user?.notifications ?? true}
          onChange={(v) => patch({ notifications: v }, "Notifications mises à jour")}
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
          label="Mode économie de données (3G)"
          hint={
            autoConstrained && !manualDataSaver
              ? "Activé automatiquement sur réseau mobile lent"
              : "Espace le rafraîchissement auto pour économiser data et batterie"
          }
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

      {/* Aide & Jeu responsable + Déconnexion */}
      <h2 className="mt-5 px-0.5 font-display text-[12px] font-bold uppercase tracking-wider text-mist">
        Assistance & Session
      </h2>
      <div className="glass-card mt-2 overflow-hidden rounded-2xl">
        <a
          href="tel:0974751313"
          className="flex items-center gap-3 border-b border-edge p-3.5 transition-colors active:bg-elev"
        >
          <IconBox>
            <PhoneCall className="h-4 w-4" strokeWidth={2.1} />
          </IconBox>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[13.5px] font-semibold text-ink">
              Joueurs Info Service
            </p>
            <p className="text-[11.5px] text-dim">09 74 75 13 13 · Appel non surtaxé (7j/7)</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.2} />
        </a>

        <button
          type="button"
          onClick={logout}
          disabled={loggingOut}
          className="flex w-full items-center gap-3 p-3.5 text-left transition-colors active:bg-betclic-red/5 disabled:opacity-60"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-betclic-red/10 text-betclic-red">
            {loggingOut ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
            ) : (
              <LogOut className="h-4 w-4" strokeWidth={2.1} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[13.5px] font-semibold text-betclic-red">
              Se déconnecter
            </p>
            <p className="text-[11.5px] text-dim">Fermer votre session sur cet appareil</p>
          </div>
        </button>
      </div>
        </div>
      </div>

      <p className="mt-6 text-center text-[10.5px] leading-relaxed text-dim">
        18+ · Jouer comporte des risques : endettement, isolement, dépendance.
      </p>

      <WithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        onSuccess={reloadWallet}
      />
    </div>
  );
}

function WithdrawalBadge({ status }: { status: string }) {
  const map: Record<string, { l: string; cls: string }> = {
    pending: { l: "En attente", cls: "bg-amber-500/15 text-amber-800" },
    approved: { l: "Envoyé", cls: "bg-win/12 text-win" },
    rejected: { l: "Remboursé", cls: "bg-betclic-red/10 text-betclic-red" },
    cancelled: { l: "Annulé", cls: "bg-elev text-dim" },
  };
  const m = map[status] ?? { l: status, cls: "bg-elev text-mist" };
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 font-display text-[9.5px] font-bold", m.cls)}>
      {m.l}
    </span>
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
  hint,
  checked,
  onChange,
  last,
}: {
  Icon: ReactNode;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3 p-3.5", !last && "border-b border-edge")}>
      <IconBox>{Icon}</IconBox>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[13.5px] font-semibold text-ink">{label}</p>
        {hint && <p className="truncate text-[11.5px] text-dim">{hint}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}
