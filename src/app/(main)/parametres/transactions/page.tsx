"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Plus,
} from "lucide-react";
import { api, type ClientWalletData } from "@/lib/api";
import { getCachedWallet } from "@/lib/client-entity-cache";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import {
  InfiniteScrollSentinel,
  useInfiniteBatch,
} from "@/components/infinite-scroll-loader";
import { useApp } from "@/components/providers";
import { cn, eur, formatPlacedAt } from "@/lib/format";

type TxKindFilter = "all" | "credits" | "debits" | "withdrawals" | "deposits";

export default function TransactionsPage() {
  const router = useRouter();
  const { user, betsVersion } = useApp();
  const [wallet, setWallet] = useState<ClientWalletData | null>(() =>
    getCachedWallet()
  );
  const [kindFilter, setKindFilter] = useState<TxKindFilter>("all");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const w = await api.wallet();
      setWallet(w);
    } catch {
      /* silencieux */
    }
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, betsVersion]);

  const filteredTx = useMemo(() => {
    const list = [...(wallet?.entries ?? [])].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
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
  const visibleTx = useMemo(
    () => filteredTx.slice(0, batch.visibleCount),
    [filteredTx, batch.visibleCount]
  );

  if (!user) {
    return (
      <div className="mx-auto max-w-xl px-3 pt-4 pb-6">
        <div className="glass-card rounded-xl p-4 text-center">
          <p className="font-display text-[14.5px] font-bold text-ink">
            Connectez-vous pour consulter vos mouvements
          </p>
          <div className="mt-3 flex justify-center">
            <Link
              href="/auth?mode=login"
              className="btn-red rounded-xl px-4 py-2 text-[12px]"
            >
              Connexion
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-3 pb-6 pt-2.5 lg:px-0 lg:py-0">
      {/* En-tête compact en ligne */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
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
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-ink ring-1 ring-edge active:scale-95 lg:h-9 lg:w-9"
          >
            <ArrowLeft className="h-3.5 w-3.5 lg:h-4 lg:w-4" strokeWidth={2.3} />
          </button>
          <div className="min-w-0">
            <h1 className="truncate font-display text-[14.5px] font-extrabold leading-tight text-ink lg:text-[18px]">
              Mouvements
            </h1>
            <p className="truncate text-[10px] leading-tight text-dim lg:text-[11px]">
              Du plus récent au plus ancien
            </p>
          </div>
        </div>

        <Link
          href="/parametres/depot"
          className="inline-flex h-7.5 shrink-0 items-center gap-1 rounded-full bg-win px-2.5 font-display text-[10.5px] font-bold text-white shadow-2xs"
        >
          <Plus className="h-3 w-3" strokeWidth={2.6} />
          Déposer
        </Link>
      </div>

      <div className="mt-1">
        <FilterDropdownRow
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
        />

        {wallet === null ? (
          <div className="space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-[50px] rounded-xl" />
            ))}
          </div>
        ) : visibleTx.length === 0 ? (
          <div className="glass-card rounded-xl p-4 text-center">
            <p className="font-display text-[13.5px] font-bold text-ink">
              Aucun mouvement dans cette catégorie
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              {visibleTx.map((t) => {
                const positive = t.amount >= 0;
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
                        <p className="truncate font-display text-[12px] font-bold leading-tight text-ink lg:text-[13px]">
                          {t.title}
                        </p>
                        <p className="truncate text-[10px] leading-tight tabular-nums text-dim lg:text-[11px]">
                          {t.subtitle} · {formatPlacedAt(t.createdAt)}
                        </p>
                      </div>
                    </div>

                    <span
                      className={cn(
                        "shrink-0 font-display text-[12.5px] font-extrabold tabular-nums lg:text-[13.5px]",
                        positive ? "text-win" : "text-betclic-red"
                      )}
                    >
                      {positive ? `+${eur(t.amount)}` : eur(t.amount)}
                    </span>
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
  );
}
