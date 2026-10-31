"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Loader2,
  X,
} from "lucide-react";
import { api, type ClientWalletData } from "@/lib/api";
import { getCachedWallet } from "@/lib/client-entity-cache";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import { PullToRefresh } from "@/components/pull-to-refresh";
import {
  PulseFlashLoader,
  triggerRouteLoader,
} from "@/components/pulse-flash-loader";
import {
  InfiniteScrollSentinel,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { useApp } from "@/components/providers";
import { generateIdempotencyKey } from "@/lib/odds-lock";
import { cn, eur, formatPlacedAt } from "@/lib/format";

type TxKindFilter = "all" | "credits" | "debits" | "withdrawals" | "deposits" | "stakes" | "wins";

export default function TransactionsPage() {
  const router = useRouter();
  const { authReady, user, setBalance, toast, betsVersion } = useApp();
  const [wallet, setWallet] = useState<ClientWalletData | null>(() =>
    getCachedWallet()
  );
  const [kindFilter, setKindFilter] = useState<TxKindFilter>("all");
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const cancelSlotRef = useRef<Map<number, string>>(new Map());
  const cancelInFlightRef = useRef(false);

  const load = useCallback(
    async (forceRefresh = false) => {
      if (!user && authReady) return;
      try {
        const w = await api.wallet({ forceRefresh });
        setWallet(w);
        if (typeof w.balance === "number") setBalance(w.balance);
      } catch {
        /* silencieux */
      }
    },
    [authReady, setBalance, user]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(false);
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void load(false);
    }, 6_000);
    const onVisible = () => {
      if (!document.hidden) void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, betsVersion, user?.balance]);

  const handlePullRefresh = useCallback(async () => {
    await load(true);
  }, [load]);

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
      void load();
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

  const filteredTx = useMemo(() => {
    const list = [...(wallet?.entries ?? [])].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    if (kindFilter === "stakes") return list.filter((t) => t.type === "stake");
    if (kindFilter === "wins") return list.filter((t) => t.type === "win");
    if (kindFilter === "credits") return list.filter((t) => t.amount > 0);
    if (kindFilter === "debits") return list.filter((t) => t.amount < 0);
    if (kindFilter === "withdrawals") {
      return list.filter((t) => t.type === "withdrawal");
    }
    if (kindFilter === "deposits") {
      return list.filter((t) => t.type === "deposit");
    }
    return list;
  }, [wallet, kindFilter]);

  const batch = useInfiniteBatch(filteredTx.length, kindFilter);
  const mobileTx = useMemo(() => [...filteredTx].sort((a, b) => Number(isPendingPayment(b)) - Number(isPendingPayment(a))), [filteredTx]);
  const visibleMobileTx = mobileTx.slice(0, batch.visibleCount);
  const visibleTx = useMemo(
    () => filteredTx.slice(0, batch.visibleCount),
    [filteredTx, batch.visibleCount]
  );

  if (!authReady && !user) {
    return <PulseFlashLoader />;
  }

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-2 pt-3 pb-6 lg:px-0">
        <div className="glass-card rounded-xl p-4 text-center">
          <p className="font-display text-[12px] font-medium text-ink">
            Connectez-vous pour consulter vos mouvements
          </p>
          <div className="mt-3 flex justify-center">
            <Link
              href="/auth?mode=login"
              className="btn-red rounded-xl px-4 py-2 text-[10.5px]"
            >
              Connexion
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (user && wallet === null) {
    return <PulseFlashLoader />;
  }

  return (
    <PullToRefresh onRefresh={handlePullRefresh}>
    <div className="mx-auto w-full max-w-[1600px] px-2 pb-6 pt-2 lg:px-0 lg:py-0">
      {/* En-tête compact en ligne */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined" && window.history.length > 1) {
              router.back();
            } else {
              triggerRouteLoader("/parametres");
              router.push("/parametres");
            }
          }}
          aria-label="Retour au compte"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-ink ring-1 ring-edge active:scale-95 lg:h-9 lg:w-9"
        >
          <ArrowLeft className="h-3.5 w-3.5 lg:h-4 lg:w-4" strokeWidth={2.3} />
        </button>
        <div><h1 className="truncate font-display text-[12px] font-bold leading-tight text-ink lg:text-[13.5px]">Mouvements</h1>
          <p className="mt-0.5 text-[10px] text-mist lg:hidden">{wallet?.entries.length ?? 0} mouvement{(wallet?.entries.length ?? 0) > 1 ? "s" : ""} chargé{(wallet?.entries.length ?? 0) > 1 ? "s" : ""}</p>
        </div>
      </div>

      <div className="mt-1">
        <div className="no-scrollbar -mx-2 flex gap-1.5 overflow-x-auto px-2 py-2 lg:hidden" aria-label="Filtrer les mouvements">
          {([ ["all", "Tout"], ["deposits", "Dépôts"], ["withdrawals", "Retraits"], ["stakes", "Mises"], ["wins", "Gains"] ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={kindFilter === value} onClick={() => setKindFilter(value)} className={cn("h-9 shrink-0 rounded-full border px-3 text-[10.5px] transition-colors", kindFilter === value ? "border-betclic-red bg-betclic-red text-white" : "border-edge bg-white text-ink")}>{label}</button>)}
        </div>
        <div className="hidden lg:block"><FilterDropdownRow
          filters={[
            {
              id: "kind",
              placeholder: "Mouvement",
              value: kindFilter,
              defaultValue: "all",
              onChange: (v) => setKindFilter(v as TxKindFilter),
              options: [
                { value: "all", label: "Tous les mouvements" },
                { value: "credits", label: "Crédits & gains (+)" },
                { value: "debits", label: "Mises & débits (-)" },
                { value: "deposits", label: "Dépôts" },
                { value: "withdrawals", label: "Retraits" },
              ],
            },
          ]}
          onReset={kindFilter !== "all" ? () => setKindFilter("all") : () => {}}
          resultCountText={
            wallet
              ? `${filteredTx.length} ${
                  filteredTx.length > 1 ? "mouvements" : "mouvement"
                }`
              : null
          }
        /></div>

        {wallet === null ? (
          <div className="space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-[50px] rounded-xl" />
            ))}
          </div>
        ) : visibleTx.length === 0 ? (
          <div className="glass-card rounded-xl p-4 text-center">
            <p className="font-display text-[11.5px] font-medium text-ink">
              Aucun mouvement dans cette catégorie
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-1.5 lg:hidden">
              {visibleMobileTx.map((t, index) => {
                const group = movementGroup(t);
                const showGroup = index === 0 || movementGroup(visibleMobileTx[index - 1]) !== group;
                const positive = t.amount >= 0;
                const canCancel = t.type === "withdrawal" && t.canCancel && t.rawId != null;
                return <div key={t.id}>
                  {showGroup && <h2 className="mb-1.5 mt-3 px-0.5 text-[9.5px] font-bold uppercase tracking-wide text-mist">{group}</h2>}
                  <div className="glass-card flex items-center gap-2.5 rounded-xl px-2.5 py-2.5">
                    <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", positive ? "bg-win/12 text-win" : "bg-betclic-red/12 text-betclic-red")}>{positive ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium text-ink">{t.title}</p><p className="truncate text-[10px] text-mist">{t.subtitle} · {formatPlacedAt(t.createdAt)}</p></div>
                    <div className="flex shrink-0 flex-col items-end gap-1"><span className={cn("text-[11px] font-medium tabular-nums", positive ? "text-win" : "text-betclic-red")}>{positive ? `+${eur(t.amount)}` : eur(t.amount)}</span>
                      {canCancel ? <button type="button" disabled={cancellingId === t.rawId} onClick={() => t.rawId != null && cancelWithdrawal(t.rawId)} className="inline-flex h-6 items-center gap-1 rounded-lg border border-edge bg-white px-2 text-[10px] text-ink disabled:opacity-50">{cancellingId === t.rawId ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3 text-betclic-red" />}Annuler</button> : isPendingPayment(t) ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] text-amber-800">En attente</span> : null}
                    </div>
                  </div>
                </div>;
              })}
            </div>
            <div className="hidden space-y-1.5 lg:block">
              {visibleTx.map((t) => {
                const positive = t.amount >= 0;
                const canCancel = Boolean(
                  t.type === "withdrawal" && t.canCancel && t.rawId != null
                );

                return (
                  <div
                    key={t.id}
                    className="glass-card flex items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 lg:rounded-2xl lg:px-3.5 lg:py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={cn(
                          "grid h-7 w-7 shrink-0 place-items-center rounded-full lg:h-8.5 lg:w-8.5",
                          positive
                            ? "bg-win/12 text-win"
                            : "bg-betclic-red/12 text-betclic-red"
                        )}
                      >
                        {positive ? (
                          <ArrowDownLeft className="h-3.5 w-3.5" strokeWidth={2.4} />
                        ) : (
                          <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.4} />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-display text-[10.5px] font-medium leading-tight text-ink lg:text-[11px]">
                          {t.title}
                        </p>
                        <p className="truncate text-[9.5px] leading-tight tabular-nums text-dim lg:text-[10px]">
                          {t.subtitle} · {formatPlacedAt(t.createdAt)}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {canCancel && (
                        <button
                          type="button"
                          disabled={cancellingId === t.rawId}
                          onClick={() =>
                            t.rawId != null && cancelWithdrawal(t.rawId)
                          }
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-edge bg-elev px-2 font-display text-[10px] font-medium text-ink active:scale-95 disabled:opacity-50"
                        >
                          {cancellingId === t.rawId ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <X className="h-3 w-3 text-betclic-red" strokeWidth={2.4} />
                          )}
                          Annuler
                        </button>
                      )}

                      <span
                        className={cn(
                          "font-display text-[11px] font-medium tabular-nums lg:text-[11.5px]",
                          positive ? "text-win" : "text-betclic-red"
                        )}
                      >
                        {positive ? `+${eur(t.amount)}` : eur(t.amount)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <InfiniteScrollSentinel
              hasMore={batch.hasMore}
              isLoadingMore={batch.isLoadingMore}
              onLoadMore={batch.loadMore}
            />
          </>
        )}
      </div>
    </div>
    </PullToRefresh>
  );
}

function isPendingPayment(t: { type: string; status: string }) {
  return (t.type === "deposit" || t.type === "withdrawal") && t.status === "pending";
}

function movementGroup(t: { type: string; status: string; createdAt: string }) {
  if (isPendingPayment(t)) return "En attente";
  const date = new Date(t.createdAt);
  if (!Number.isFinite(date.getTime())) return "Date inconnue";
  if (Date.now() - date.getTime() < 24 * 60 * 60 * 1000) return "Récents";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
