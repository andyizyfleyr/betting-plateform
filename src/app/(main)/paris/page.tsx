"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, History, Plus, Search, TicketX, X } from "lucide-react";
import { api, type ClientBet } from "@/lib/api";
import { BetTicket } from "@/components/bet-ticket";
import { ShareTicketModal } from "@/components/share-ticket-modal";
import { AnimatedNumber } from "@/components/animated-number";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import { useApp } from "@/components/providers";
import { eur } from "@/lib/format";

type Tab = "ongoing" | "finished";
type OutcomeFilter = "all" | "won" | "lost" | "cashed" | "void";

const POLL_INTERVAL = 5_000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1_000;

function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sod = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((sod(now) - sod(d)) / 86_400_000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Hier";
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

function settledOrPlacedIso(b: ClientBet): string {
  return b.status !== "pending" && b.settledAt ? b.settledAt : b.placedAt;
}

export default function ParisPage() {
  const { betsVersion, user, openRecharge } = useApp();
  const [tabChoice, setTabChoice] = useState<Tab | null>(null);
  const [kindFilter, setKindFilter] = useState<"all" | "sport" | "prediction" | "combo">("all");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [query, setQuery] = useState("");
  const [bets, setBets] = useState<ClientBet[] | null>(null);
  const [sharingBet, setSharingBet] = useState<ClientBet | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(isBackground = false) {
      if (isBackground && typeof document !== "undefined" && document.hidden) return;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const r = await api.allBets();
          if (cancelled) return;
          setBets(r.bets);
          return;
        } catch {
          if (cancelled) return;
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY * (attempt + 1)));
            continue;
          }
          if (!isBackground && !cancelled) setBets([]);
        }
      }
    }

    void load(false);
    const id = setInterval(() => void load(true), POLL_INTERVAL);
    const onVisible = () => {
      if (!document.hidden) void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [betsVersion]);

  const allBets = useMemo(() => bets ?? [], [bets]);

  // Si aucun pari n'est en cours mais qu'il existe des paris terminés,
  // on bascule automatiquement sur « Terminés » par défaut.
  const hasAnyOngoing = useMemo(
    () => allBets.some((b) => b.status === "pending"),
    [allBets]
  );
  const hasAnyFinished = useMemo(
    () => allBets.some((b) => b.status !== "pending"),
    [allBets]
  );
  const smartDefaultTab: Tab = !hasAnyOngoing && hasAnyFinished ? "finished" : "ongoing";
  const tab: Tab = tabChoice ?? smartDefaultTab;

  const staked = useMemo(
    () => allBets.filter((b) => b.status === "pending").reduce((s, b) => s + b.stake, 0),
    [allBets]
  );
  const potential = useMemo(
    () => allBets.filter((b) => b.status === "pending").reduce((s, b) => s + b.potentialWin, 0),
    [allBets]
  );
  const { settled, winRate } = useMemo(() => {
    const fin = allBets.filter((b) => b.status === "won" || b.status === "lost");
    const w = fin.filter((b) => b.status === "won").length;
    return {
      settled: fin.length,
      winRate: fin.length ? Math.round((w / fin.length) * 100) : 0,
    };
  }, [allBets]);

  const searchedBets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allBets;
    return allBets.filter(
      (b) =>
        b.homeTeam.toLowerCase().includes(q) ||
        b.awayTeam.toLowerCase().includes(q) ||
        b.league.toLowerCase().includes(q) ||
        b.selectionLabel.toLowerCase().includes(q) ||
        (b.question ?? "").toLowerCase().includes(q) ||
        (b.legs ?? []).some(
          (l) =>
            l.title.toLowerCase().includes(q) ||
            l.selectionLabel.toLowerCase().includes(q)
        )
    );
  }, [allBets, query]);

  const ongoingAll = useMemo(
    () =>
      searchedBets
        .filter((b) => b.status === "pending")
        .sort(
          (a, b) =>
            new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime() || b.id - a.id
        ),
    [searchedBets]
  );
  const finishedAll = useMemo(
    () =>
      searchedBets
        .filter((b) => b.status !== "pending")
        .sort(
          (a, b) =>
            new Date(settledOrPlacedIso(b)).getTime() -
              new Date(settledOrPlacedIso(a)).getTime() ||
            new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime() ||
            b.id - a.id
        ),
    [searchedBets]
  );

  const baseByStatus = tab === "ongoing" ? ongoingAll : finishedAll;

  const kindCounts = useMemo(() => {
    return {
      all: baseByStatus.length,
      combo: baseByStatus.filter((b) => b.kind === "combo").length,
      sport: baseByStatus.filter((b) => b.kind === "sport").length,
      prediction: baseByStatus.filter((b) => b.kind === "prediction").length,
    };
  }, [baseByStatus]);

  const byKind = useMemo(
    () => (kindFilter === "all" ? baseByStatus : baseByStatus.filter((b) => b.kind === kindFilter)),
    [baseByStatus, kindFilter]
  );

  const finishedForOutcomeCounts = useMemo(
    () => (kindFilter === "all" ? finishedAll : finishedAll.filter((b) => b.kind === kindFilter)),
    [finishedAll, kindFilter]
  );

  const outcomeCounts = useMemo(
    () => ({
      all: byKind.length,
      won: finishedForOutcomeCounts.filter((b) => b.status === "won").length,
      lost: finishedForOutcomeCounts.filter((b) => b.status === "lost").length,
      cashed: finishedForOutcomeCounts.filter((b) => b.status === "cashed").length,
      void: finishedForOutcomeCounts.filter((b) => b.status === "void").length,
    }),
    [byKind.length, finishedForOutcomeCounts]
  );

  const visibleBets = useMemo(() => {
    if (outcomeFilter === "all") return byKind;
    return byKind.filter((b) => b.status === outcomeFilter);
  }, [byKind, outcomeFilter]);

  const finishedGroups = useMemo(() => {
    const map = new Map<string, ClientBet[]>();
    for (const b of visibleBets) {
      const key = dayLabel(settledOrPlacedIso(b));
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return [...map.entries()];
  }, [visibleBets]);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-8 pt-4 lg:px-8 lg:py-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink lg:text-[25px]">
            Mes paris
          </h1>
          <p className="text-[12px] text-mist lg:text-[13px]">
            Coupons en cours et historique des paris
          </p>
        </div>

        <Link
          href="/resultats"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-elev px-2.5 font-display text-[11.5px] font-bold text-ink active:scale-95"
        >
          <History className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.2} />
          Résultats
        </Link>
      </div>

      {/* Résumé portefeuille clair + Recherche côte à côte sur grand écran */}
      <div className="mt-3 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-end lg:gap-4">
        <section className="glass-card rounded-2xl p-3.5 lg:flex lg:items-center lg:justify-between lg:gap-6 lg:px-5 lg:py-4">
          <div className="flex items-center justify-between gap-4 lg:shrink-0">
            <div>
              <p className="text-[11px] font-medium text-dim">Solde disponible</p>
              <AnimatedNumber
                value={user?.balance ?? 0}
                format={eur}
                className="mt-0.5 block font-display text-[24px] font-bold leading-none tabular-nums text-ink"
              />
            </div>
            <button
              type="button"
              onClick={openRecharge}
              className="flex h-9 items-center gap-1.5 rounded-xl bg-betclic-red px-3.5 font-display text-[12.5px] font-bold text-white active:opacity-90 lg:hidden"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
              Recharger
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 divide-x divide-edge border-t border-edge pt-2.5 text-center lg:mt-0 lg:flex-1 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <div className="px-1">
              <p className="text-[10px] font-medium text-dim">En jeu</p>
              <p className="mt-0.5 font-display text-[13px] font-bold tabular-nums text-ink lg:text-[15px]">
                {eur(staked)}
              </p>
            </div>
            <div className="px-1">
              <p className="text-[10px] font-medium text-dim">Gain potentiel</p>
              <p className="mt-0.5 font-display text-[13px] font-bold tabular-nums text-win lg:text-[15px]">
                {eur(potential)}
              </p>
            </div>
            <div className="px-1">
              <p className="text-[10px] font-medium text-dim">Réussite</p>
              <p className="mt-0.5 font-display text-[13px] font-bold tabular-nums text-ink lg:text-[15px]">
                {settled ? `${winRate}%` : "—"}
              </p>
            </div>
          </div>
        </section>

        {/* Barre de recherche */}
        <div className="mt-3 flex h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3 lg:mt-0 lg:h-[68px] lg:rounded-2xl lg:px-4">
          <Search className="h-4 w-4 shrink-0 text-dim" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un match, un coupon, un combiné…"
            className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-dim"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Effacer la recherche"
              className="text-dim active:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Rangée unique collante de 3 pastilles dropdown */}
      <FilterDropdownRow
        filters={[
          {
            id: "status",
            placeholder: "Statut",
            value: tab,
            defaultValue: smartDefaultTab,
            onChange: (next) => {
              setTabChoice(next === smartDefaultTab ? null : next);
              if (next === "ongoing") setOutcomeFilter("all");
            },
            options: [
              {
                value: "ongoing",
                label: "En cours",
                count: bets !== null ? ongoingAll.length : undefined,
              },
              {
                value: "finished",
                label: "Terminés",
                count: bets !== null ? finishedAll.length : undefined,
              },
            ],
          },
          {
            id: "kind",
            placeholder: "Type",
            value: kindFilter,
            defaultValue: "all",
            onChange: setKindFilter,
            options: [
              {
                value: "all",
                label: "Tous types",
                count: bets !== null ? kindCounts.all : undefined,
              },
              {
                value: "combo",
                label: "Combinés",
                count: bets !== null ? kindCounts.combo : undefined,
              },
              {
                value: "sport",
                label: "Sport",
                count: bets !== null ? kindCounts.sport : undefined,
              },
              {
                value: "prediction",
                label: "Prédictions",
                count: bets !== null ? kindCounts.prediction : undefined,
              },
            ],
          },
          {
            id: "outcome",
            placeholder: "Résultat",
            value: outcomeFilter,
            defaultValue: "all",
            onChange: (next) => {
              setOutcomeFilter(next);
              if (next !== "all" && tab === "ongoing") {
                setTabChoice("finished");
              }
            },
            options: [
              {
                value: "all",
                label: "Tous résultats",
                count: bets !== null ? outcomeCounts.all : undefined,
              },
              {
                value: "won",
                label: "Gagnés",
                count: bets !== null ? outcomeCounts.won : undefined,
              },
              {
                value: "lost",
                label: "Perdus",
                count: bets !== null ? outcomeCounts.lost : undefined,
              },
              {
                value: "cashed",
                label: "Vendus",
                count: bets !== null ? outcomeCounts.cashed : undefined,
              },
              {
                value: "void",
                label: "Remboursés",
                count: bets !== null ? outcomeCounts.void : undefined,
              },
            ],
          },
        ]}
        onReset={() => {
          setTabChoice(null);
          setKindFilter("all");
          setOutcomeFilter("all");
        }}
        resultCountText={
          bets !== null
            ? tab === "ongoing"
              ? `${visibleBets.length} pari${visibleBets.length > 1 ? "s" : ""} en cours`
              : `${visibleBets.length} pari${visibleBets.length > 1 ? "s" : ""} terminé${visibleBets.length > 1 ? "s" : ""}`
            : null
        }
      />

      {/* Liste des tickets */}
      {bets === null ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="shimmer h-[168px] rounded-2xl" />
          ))}
        </div>
      ) : visibleBets.length === 0 ? (
        <div className="mt-10 flex flex-col items-center text-center">
          <div className="glass-card grid h-14 w-14 place-items-center rounded-full text-dim">
            <TicketX className="h-6 w-6" strokeWidth={1.8} />
          </div>
          <p className="mt-3 font-display text-[15.5px] font-bold text-ink">
            {tab === "ongoing" ? "Aucun pari en cours" : "Aucun pari terminé"}
          </p>
          <p className="mt-1 max-w-[240px] text-[12.5px] text-dim">
            {tab === "ongoing"
              ? "Choisissez une prédiction ou un match pour placer une mise."
              : "Modifiez vos filtres ou consultez vos coupons en cours."}
          </p>
          {tab === "ongoing" && (
            <div className="mt-4 flex gap-2">
              <Link
                href="/predictions"
                className="flex h-10 items-center gap-1.5 rounded-full bg-betclic-red px-4 font-display text-[12.5px] font-bold text-white active:opacity-90"
              >
                Prédictions
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
              </Link>
              <Link
                href="/matchs"
                className="flex h-10 items-center rounded-full border border-edge bg-white px-4 font-display text-[12.5px] font-semibold text-ink active:bg-elev"
              >
                Matchs
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div>
          {tab === "ongoing" ? (
            <div className="grid grid-cols-1 items-start gap-2.5 xl:grid-cols-2 xl:gap-3.5">
              {visibleBets.map((b) => (
                <BetTicket key={`${b.kind}-${b.id}`} bet={b} onShare={setSharingBet} />
              ))}
            </div>
          ) : (
            finishedGroups.map(([label, group]) => (
              <div key={label} className="mb-5 last:mb-0">
                <p className="mb-2 px-0.5 text-[11.5px] font-semibold capitalize text-mist">
                  {label}
                  <span className="ml-1.5 text-dim">({group.length})</span>
                </p>
                <div className="grid grid-cols-1 items-start gap-2.5 xl:grid-cols-2 xl:gap-3.5">
                  {group.map((b) => (
                    <BetTicket key={`${b.kind}-${b.id}`} bet={b} onShare={setSharingBet} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <ShareTicketModal bet={sharingBet} onClose={() => setSharingBet(null)} />
    </div>
  );
}
