"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Clock, ListChecks, RefreshCw, Search, TrendingUp, X } from "lucide-react";
import { api, type ClientPrediction, type PredictionOptionClient } from "@/lib/api";
import { PredictionBetModal } from "@/components/prediction-bet-modal";
import { FilterDropdownRow } from "@/components/filter-dropdown-row";
import { PullToRefresh } from "@/components/pull-to-refresh";
import type { ComboSelection } from "@/components/combo-slip";
import {
  OddsTrendCorner,
  oddsTrendTextClass,
  useOddsTrend,
} from "@/components/odds-trend-corner";
import { useApp } from "@/components/providers";
import { getAdaptiveIntervalMs, useNetworkQuality } from "@/lib/network-saver";
import { useLongPressOdds } from "@/lib/use-long-press-odds";
import { cn, eur, formatOdds, formatPlacedAt } from "@/lib/format";

const POLL_INTERVAL = 20_000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1_000;

type Category = "Tous" | "Sport" | "Actus" | "Crypto" | "Culture";
const CATEGORIES: Category[] = ["Tous", "Sport", "Actus", "Crypto", "Culture"];

type FormatFilter = "all" | "multi" | "binary";
type StatusTab = "open" | "resolved";

function isMultiChoiceQuestion(q: ClientPrediction): boolean {
  return Array.isArray(q.options) && q.options.length >= 2;
}

function formatResolves(iso: string, nowMs: number) {
  const diff = new Date(iso).getTime() - nowMs;
  if (diff <= 0) return "Clôturé";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Demain";
  return `${days} j`;
}

export default function PredictionsPage() {
  const { user, betsVersion, comboQuickMode, toggleComboLeg, toast } = useApp();
  const { isOffline, isConstrained } = useNetworkQuality();
  const pollIntervalMs = getAdaptiveIntervalMs(POLL_INTERVAL, isConstrained);

  const [catalogQuestions, setCatalogQuestions] = useState<ClientPrediction[] | null>(null);
  const [myBetsMap, setMyBetsMap] = useState<
    Record<number, NonNullable<ClientPrediction["myBet"]>>
  >({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [statusTab, setStatusTab] = useState<StatusTab>("open");
  const [category, setCategory] = useState<Category>("Tous");
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
  const [query, setQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [target, setTarget] = useState<{
    question: ClientPrediction;
    selection: string;
  } | null>(null);

  const handlePullRefresh = useCallback(async () => {
    try {
      const [catRes, mineRes] = await Promise.all([
        api.predictionsCatalog(),
        user ? api.myPredictionBets().catch(() => null) : Promise.resolve(null),
      ]);
      setCatalogQuestions(catRes.questions);
      if (mineRes) setMyBetsMap(mineRes.myBets);
      setLoadError(null);
      setNowMs(Date.now());
    } catch {
      /* conserve la liste en cours si le réseau mobile coupe */
    }
  }, [user]);

  // 1) Catalogue public mutualisé au CDN Edge (aucun cookie, partagé entre tous les visiteurs)
  useEffect(() => {
    let cancelled = false;

    async function fetchCatalog(isBackground = false) {
      if (isBackground && typeof document !== "undefined" && document.hidden) return;
      if (isBackground && typeof navigator !== "undefined" && navigator.onLine === false) {
        return;
      }
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const r = await api.predictionsCatalog();
          if (cancelled) return;
          setCatalogQuestions(r.questions);
          setLoadError(null);
          setNowMs(Date.now());
          return;
        } catch (err) {
          if (cancelled) return;
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY * (attempt + 1)));
            continue;
          }
          if (!isBackground && !cancelled) {
            setLoadError(
              err instanceof Error
                ? err.message
                : "Impossible de charger les prédictions pour le moment."
            );
            setCatalogQuestions((prev) => prev ?? []);
          }
        }
      }
    }

    void fetchCatalog(false);
    const id = setInterval(() => void fetchCatalog(true), pollIntervalMs);
    const onVisible = () => {
      if (!document.hidden) void fetchCatalog(true);
    };
    const onOnline = () => void fetchCatalog(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [reloadNonce, pollIntervalMs, isOffline]);

  // 2) Calque privé joueur (~100 octets, zéro polling périodique : chargé au montage et sur action `betsVersion`)
  useEffect(() => {
    if (!user) return;
    let active = true;
    api
      .myPredictionBets()
      .then((res) => {
        if (active) setMyBetsMap(res.myBets);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user, betsVersion, reloadNonce]);

  const questions = useMemo(() => {
    if (!catalogQuestions) return null;
    return catalogQuestions.map((q) => ({
      ...q,
      myBet: myBetsMap[q.id] ?? null,
    }));
  }, [catalogQuestions, myBetsMap]);

  const searchedQuestions = useMemo(() => {
    const all = questions ?? [];
    const qTrim = query.trim().toLowerCase();
    if (!qTrim) return all;
    return all.filter(
      (q) =>
        q.question.toLowerCase().includes(qTrim) ||
        q.category.toLowerCase().includes(qTrim) ||
        (q.options ?? []).some((o) => o.label.toLowerCase().includes(qTrim))
    );
  }, [questions, query]);

  const openList = useMemo(
    () => searchedQuestions.filter((q) => q.status === "open"),
    [searchedQuestions]
  );

  const resolvedList = useMemo(
    () =>
      searchedQuestions
        .filter((q) => q.status === "resolved")
        .sort(
          (a, b) =>
            new Date(b.resolvedAt ?? b.resolvesAt).getTime() -
            new Date(a.resolvedAt ?? a.resolvesAt).getTime()
        ),
    [searchedQuestions]
  );

  const baseByStatus = statusTab === "open" ? openList : resolvedList;

  const counts = useMemo(() => {
    const map: Record<Category, number> = {
      Tous: baseByStatus.length,
      Sport: 0,
      Actus: 0,
      Crypto: 0,
      Culture: 0,
    };
    for (const q of baseByStatus) {
      if (q.category in map) map[q.category as Category] += 1;
    }
    return map;
  }, [baseByStatus]);

  const categoryFiltered = useMemo(
    () => (category === "Tous" ? baseByStatus : baseByStatus.filter((q) => q.category === category)),
    [baseByStatus, category]
  );

  const multiCount = useMemo(
    () => categoryFiltered.filter(isMultiChoiceQuestion).length,
    [categoryFiltered]
  );
  const binaryCount = categoryFiltered.length - multiCount;

  const visibleQuestions = useMemo(() => {
    const byFormat =
      formatFilter === "multi"
        ? categoryFiltered.filter(isMultiChoiceQuestion)
        : formatFilter === "binary"
          ? categoryFiltered.filter((q) => !isMultiChoiceQuestion(q))
          : categoryFiltered;

    if (statusTab === "resolved") return byFormat;

    if (formatFilter === "all") {
      return [...byFormat].sort((a, b) => {
        const am = isMultiChoiceQuestion(a) ? 0 : 1;
        const bm = isMultiChoiceQuestion(b) ? 0 : 1;
        if (am !== bm) return am - bm;
        return new Date(a.resolvesAt).getTime() - new Date(b.resolvesAt).getTime();
      });
    }
    return byFormat;
  }, [categoryFiltered, formatFilter, statusTab]);

  const handleSelectOutcome = (
    q: ClientPrediction,
    selection: string,
    selectionLabel: string,
    odds: number
  ) => {
    const isDesktop =
      typeof window !== "undefined" && window.innerWidth >= 1024;
    if (comboQuickMode || isDesktop) {
      const res = toggleComboLeg({
        uid: `pred-${q.id}`,
        kind: "prediction",
        questionId: q.id,
        title: q.question,
        league: q.category,
        market: isMultiChoiceQuestion(q) ? "multichoice" : "yesno",
        selection,
        selectionLabel,
        odds,
      });
      if (res === "full") {
        toast({ kind: "error", title: "Combiné complet (8 sélections max)" });
      }
      return;
    }
    setTarget({ question: q, selection });
  };

  const toggleMobileSearch = () => {
    if (mobileSearchOpen) {
      setQuery("");
      setMobileSearchOpen(false);
    } else {
      setMobileSearchOpen(true);
      window.setTimeout(() => searchInputRef.current?.focus(), 30);
    }
  };

  return (
    <PullToRefresh onRefresh={handlePullRefresh} haptics={user?.haptics}>
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-8 pt-3.5 lg:px-0 lg:py-0">
      {/* En-tête compact + Loupe dépliable sur mobile / Recherche en ligne sur desktop */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[20px] font-bold leading-tight tracking-tight text-ink lg:text-[25px]">
            Prédictions
          </h1>
          <p className="hidden text-[13px] text-mist lg:block">
            Choix multiples & Oui / Non à cotes fixes
          </p>
        </div>

        <button
          type="button"
          onClick={toggleMobileSearch}
          aria-label={mobileSearchOpen ? "Fermer la recherche" : "Rechercher une prédiction"}
          className={cn(
            "grid h-8.5 w-8.5 shrink-0 place-items-center rounded-full transition-colors active:scale-95 lg:hidden",
            mobileSearchOpen || query
              ? "bg-betclic-red text-white"
              : "bg-elev text-ink"
          )}
        >
          {mobileSearchOpen ? (
            <X className="h-4 w-4" strokeWidth={2.3} />
          ) : (
            <Search className="h-4 w-4" strokeWidth={2.2} />
          )}
        </button>

        {/* Barre de recherche desktop */}
        <div className="hidden h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3 lg:flex lg:w-[360px] xl:w-[400px]">
          <Search className="h-4 w-4 shrink-0 text-dim" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une question ou un candidat…"
            className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-dim"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Effacer la recherche"
              className="text-dim hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Barre de recherche mobile dépliable au clic sur la loupe */}
      {(mobileSearchOpen || query) && (
        <div className="mt-2.5 flex h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3 lg:hidden">
          <Search className="h-4 w-4 shrink-0 text-dim" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une question ou un candidat…"
            className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-dim"
          />
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setMobileSearchOpen(false);
            }}
            aria-label="Fermer la recherche"
            className="text-dim active:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Rangée unique collante de 3 pastilles dropdown */}
      <FilterDropdownRow
        filters={[
          {
            id: "status",
            placeholder: "Statut",
            value: statusTab,
            defaultValue: "open",
            onChange: setStatusTab,
            options: [
              {
                value: "open",
                label: "Ouvertes",
                count: questions !== null ? openList.length : undefined,
              },
              {
                value: "resolved",
                label: "Résolues",
                count: questions !== null ? resolvedList.length : undefined,
              },
            ],
          },
          {
            id: "category",
            placeholder: "Catégorie",
            value: category,
            defaultValue: "Tous",
            onChange: setCategory,
            options: CATEGORIES.map((c) => ({
              value: c,
              label: c,
              count: questions !== null ? counts[c] : undefined,
            })),
          },
          {
            id: "format",
            placeholder: "Format",
            value: formatFilter,
            defaultValue: "all",
            onChange: setFormatFilter,
            options: [
              {
                value: "all",
                label: "Tous formats",
                count: questions !== null ? categoryFiltered.length : undefined,
              },
              {
                value: "multi",
                label: "Choix multiples",
                count: questions !== null ? multiCount : undefined,
              },
              {
                value: "binary",
                label: "Oui / Non",
                count: questions !== null ? binaryCount : undefined,
              },
            ],
          },
        ]}
        onReset={() => {
          setStatusTab("open");
          setCategory("Tous");
          setFormatFilter("all");
        }}
        resultCountText={
          questions !== null
            ? `${visibleQuestions.length} prédiction${visibleQuestions.length > 1 ? "s" : ""}`
            : null
        }
      />

      {/* Liste des questions */}
      {questions === null ? (
        <div className="grid grid-cols-1 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="shimmer h-[168px] rounded-2xl" />
          ))}
        </div>
      ) : loadError && (questions?.length ?? 0) === 0 ? (
        <div className="mt-8 flex flex-col items-center rounded-2xl border border-amber-500/30 bg-white p-5 text-center shadow-xs">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-amber-500/12 text-amber-600">
            <AlertTriangle className="h-5 w-5" strokeWidth={2.1} />
          </div>
          <p className="mt-3 font-display text-[15px] font-bold text-ink">
            Connexion au serveur interrompue
          </p>
          <p className="mt-1 max-w-[330px] text-[12.5px] leading-relaxed text-mist">
            {loadError}
          </p>
          <button
            type="button"
            onClick={() => {
              setCatalogQuestions(null);
              setLoadError(null);
              setReloadNonce((n) => n + 1);
            }}
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-betclic-red px-4 font-display text-[12.5px] font-bold text-white shadow-xs active:scale-95"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.3} />
            Réessayer
          </button>
        </div>
      ) : visibleQuestions.length === 0 ? (
        <div className="mt-12 flex flex-col items-center text-center">
          <div className="glass-card grid h-14 w-14 place-items-center rounded-full text-dim">
            <TrendingUp className="h-5 w-5" strokeWidth={1.9} />
          </div>
          <p className="mt-3 font-display text-[15px] font-semibold text-ink">
            {statusTab === "resolved"
              ? "Aucune prédiction résolue dans ce filtre"
              : "Aucune prédiction disponible"}
          </p>
          <p className="mt-1 text-[12.5px] text-dim">
            Modifiez ou réinitialisez les filtres pour élargir les résultats.
          </p>
        </div>
      ) : statusTab === "resolved" ? (
        <div className="grid grid-cols-1 items-start gap-3">
          {visibleQuestions.map((q) => (
            <ResolvedQuestionCard key={q.id} q={q} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3">
          {visibleQuestions.map((q) =>
            isMultiChoiceQuestion(q) && q.options ? (
              <MultiChoiceQuestionCard
                key={q.id}
                q={q}
                options={q.options}
                nowMs={nowMs}
                onSelect={(selection, label, odds) =>
                  handleSelectOutcome(q, selection, label, odds)
                }
              />
            ) : (
              <BinaryQuestionCard
                key={q.id}
                q={q}
                nowMs={nowMs}
                onSelect={(selection) =>
                  handleSelectOutcome(
                    q,
                    selection,
                    selection === "yes" ? "Oui" : "Non",
                    selection === "yes" ? q.oddsYes : q.oddsNo
                  )
                }
              />
            )
          )}
        </div>
      )}

      <PredictionBetModal
        question={target?.question ?? null}
        selection={target?.selection ?? null}
        onClose={() => setTarget(null)}
      />
    </div>
    </PullToRefresh>
  );
}

function ResolvedQuestionCard({ q }: { q: ClientPrediction }) {
  const { oddsFormat } = useApp();
  const winner = useMemo(() => {
    if (Array.isArray(q.options) && q.options.length >= 2) {
      const opt = q.options.find((o) => o.key === q.resolution);
      return { label: opt?.label ?? q.resolution ?? "Résolu", odds: opt?.odds ?? null };
    }
    return {
      label: q.resolution === "yes" ? "Oui" : "Non",
      odds: q.resolution === "yes" ? q.oddsYes : q.oddsNo,
    };
  }, [q]);

  return (
    <article className="glass-card rounded-2xl p-3.5">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="rounded-md bg-elev px-2 py-0.5 font-display text-[10px] font-bold uppercase text-ink">
          {q.category}
        </span>
        <span className="text-dim">
          {q.resolvedAt ? `Résolu · ${formatPlacedAt(q.resolvedAt)}` : "Résolu"}
        </span>
      </div>
      <h2 className="mt-2 font-display text-[15px] font-bold leading-snug text-ink">
        {q.question}
      </h2>
      <div className="mt-2.5 flex items-center justify-between rounded-xl border border-win/25 bg-win/10 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 font-display text-[12.5px] font-bold text-win">
          <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2.4} />
          Issue gagnante : {winner.label}
        </span>
        {winner.odds != null && (
          <span className="font-display text-[12.5px] font-bold tabular-nums text-win">
            {formatOdds(winner.odds, oddsFormat)}
          </span>
        )}
      </div>
    </article>
  );
}

function MultiChoiceQuestionCard({
  q,
  options,
  nowMs,
  onSelect,
}: {
  q: ClientPrediction;
  options: PredictionOptionClient[];
  nowMs: number;
  onSelect: (selection: string, label: string, odds: number) => void;
}) {
  const { oddsFormat, isInCombo } = useApp();
  const expired = new Date(q.resolvesAt).getTime() <= nowMs;
  const comboUid = `pred-${q.id}`;

  const sortedOptions = useMemo(
    () => [...options].sort((a, b) => a.odds - b.odds),
    [options]
  );

  const [expanded, setExpanded] = useState(false);
  const hasMoreOptions = sortedOptions.length > 2;
  const displayed = expanded || !hasMoreOptions ? sortedOptions : sortedOptions.slice(0, 2);

  const probs = useMemo(() => {
    const weights = sortedOptions.map((o) => (o.odds > 0 ? 1 / o.odds : 0));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    const map = new Map<string, number>();
    sortedOptions.forEach((o, i) => {
      map.set(o.key, Math.round((weights[i] / sum) * 100));
    });
    return map;
  }, [sortedOptions]);

  const myBetLabel = useMemo(() => {
    if (!q.myBet) return null;
    if (q.myBet.selectionLabel) return q.myBet.selectionLabel;
    return sortedOptions.find((o) => o.key === q.myBet?.selection)?.label ?? q.myBet.selection;
  }, [q.myBet, sortedOptions]);

  return (
    <article className={cn("glass-card rounded-2xl p-3.5", expired && "opacity-70")}>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 rounded-md bg-elev px-2 py-0.5 font-display text-[10px] font-bold uppercase text-ink">
            {q.category}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-betclic-red/10 px-2 py-0.5 font-display text-[10px] font-bold text-betclic-red">
            <ListChecks className="h-3 w-3" strokeWidth={2.3} />
            {sortedOptions.length} choix
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-1 font-medium text-dim">
          <Clock className="h-3 w-3" strokeWidth={2.2} />
          {expired ? "Clos" : formatResolves(q.resolvesAt, nowMs)}
        </span>
      </div>

      <h2 className="mt-2 font-display text-[15.5px] font-bold leading-snug text-ink">
        {q.question}
      </h2>

      {q.myBet && myBetLabel && (
        <p className="mt-2 rounded-lg bg-betclic-red/8 px-2.5 py-1 text-[11px] font-semibold text-betclic-red">
          Votre mise : {myBetLabel} · {eur(q.myBet.stake)}
        </p>
      )}

      <div className="mt-2.5 flex flex-col gap-1.5">
        {displayed.map((opt) => {
          const pct = probs.get(opt.key) ?? 0;
          const selected = q.myBet?.selection === opt.key;
          const inCombo = isInCombo(comboUid, "multichoice", opt.key);
          const comboSel: ComboSelection = {
            uid: comboUid,
            kind: "prediction",
            questionId: q.id,
            title: q.question,
            league: q.category,
            market: "multichoice",
            selection: opt.key,
            selectionLabel: opt.label,
            odds: opt.odds,
          };
          return (
            <MultiOptionButton
              key={opt.key}
              opt={opt}
              pct={pct}
              expired={expired}
              selected={selected}
              inCombo={inCombo}
              oddsFormat={oddsFormat}
              comboSelection={comboSel}
              onSelect={() => onSelect(opt.key, opt.label, opt.odds)}
            />
          );
        })}
      </div>

      {hasMoreOptions && (
        <button
          type="button"
          onClick={() => setExpanded((s) => !s)}
          className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-elev/80 font-display text-[12.5px] font-semibold text-ink transition-colors hover:bg-elev active:scale-[0.99]"
        >
          <span>
            {expanded
              ? "Voir moins"
              : `Voir tout (${sortedOptions.length} choix)`}
          </span>
          <ChevronDown
            className={cn("h-4 w-4 text-mist transition-transform duration-150", expanded && "rotate-180")}
            strokeWidth={2.3}
          />
        </button>
      )}
    </article>
  );
}

function BinaryQuestionCard({
  q,
  nowMs,
  onSelect,
}: {
  q: ClientPrediction;
  nowMs: number;
  onSelect: (selection: "yes" | "no") => void;
}) {
  const { oddsFormat, isInCombo } = useApp();
  const expired = new Date(q.resolvesAt).getTime() <= nowMs;
  const comboUid = `pred-${q.id}`;

  const pYes = Math.round(((1 / q.oddsYes) / (1 / q.oddsYes + 1 / q.oddsNo)) * 100);

  return (
    <article className={cn("glass-card rounded-2xl p-3.5", expired && "opacity-70")}>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-md bg-elev px-2 py-0.5 font-display text-[10px] font-bold uppercase text-ink">
            {q.category}
          </span>
          <span className="truncate text-dim">Oui / Non · Cote fixe</span>
        </div>
        <span className="flex shrink-0 items-center gap-1 font-medium text-dim">
          <Clock className="h-3 w-3" strokeWidth={2.2} />
          {expired ? "Clos" : formatResolves(q.resolvesAt, nowMs)}
        </span>
      </div>

      <h2 className="mt-2 font-display text-[15px] font-semibold leading-snug text-ink">
        {q.question}
      </h2>

      <div className="mt-2.5">
        <div className="flex justify-between text-[11px] font-medium text-mist">
          <span>Oui · {pYes}%</span>
          <span>Non · {100 - pYes}%</span>
        </div>
        <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-elev">
          <div
            className="bg-betclic-red transition-all duration-300"
            style={{ width: `${pYes}%` }}
          />
        </div>
      </div>

      {q.myBet && (
        <p className="mt-2.5 rounded-lg bg-betclic-red/8 px-2.5 py-1 text-[11px] font-semibold text-betclic-red">
          Votre mise : {q.myBet.selection === "yes" ? "Oui" : "Non"} · {eur(q.myBet.stake)}
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <SideButton
          label="Oui"
          odds={q.oddsYes}
          oddsFormat={oddsFormat}
          onClick={expired ? undefined : () => onSelect("yes")}
          disabled={expired}
          selected={q.myBet?.selection === "yes"}
          inCombo={isInCombo(comboUid, "yesno", "yes")}
          comboSelection={{
            uid: comboUid,
            kind: "prediction",
            questionId: q.id,
            title: q.question,
            league: q.category,
            market: "yesno",
            selection: "yes",
            selectionLabel: "Oui",
            odds: q.oddsYes,
          }}
        />
        <SideButton
          label="Non"
          odds={q.oddsNo}
          oddsFormat={oddsFormat}
          onClick={expired ? undefined : () => onSelect("no")}
          disabled={expired}
          selected={q.myBet?.selection === "no"}
          inCombo={isInCombo(comboUid, "yesno", "no")}
          comboSelection={{
            uid: comboUid,
            kind: "prediction",
            questionId: q.id,
            title: q.question,
            league: q.category,
            market: "yesno",
            selection: "no",
            selectionLabel: "Non",
            odds: q.oddsNo,
          }}
        />
      </div>
    </article>
  );
}

function MultiOptionButton({
  opt,
  pct,
  expired,
  selected,
  inCombo,
  oddsFormat,
  comboSelection,
  onSelect,
}: {
  opt: PredictionOptionClient;
  pct: number;
  expired: boolean;
  selected: boolean;
  inCombo: boolean;
  oddsFormat: "decimal" | "fractional";
  comboSelection: ComboSelection;
  onSelect: () => void;
}) {
  const trend = useOddsTrend(opt.odds);
  const { pressing, handlers, style } = useLongPressOdds({
    disabled: expired,
    comboSelection,
    onTap: () => onSelect(),
  });

  return (
    <button
      type="button"
      disabled={expired}
      {...handlers}
      style={style}
      className={cn(
        "relative flex min-h-[44px] w-full items-center justify-between gap-2 overflow-hidden rounded-xl border px-3 py-2 text-left transition-all active:scale-[0.99]",
        inCombo
          ? "border-ink bg-ink text-white ring-2 ring-betclic-red/35"
          : selected
            ? "border-betclic-red bg-betclic-red/[0.06]"
            : "border-edge bg-elev/55 active:bg-elev",
        pressing && !expired && "scale-[0.98] ring-2 ring-betclic-red/50",
        expired && "cursor-not-allowed"
      )}
    >
      {!inCombo && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 transition-all duration-300",
            selected ? "bg-betclic-red/12" : "bg-ink/[0.045]"
          )}
          style={{ width: `${Math.max(pct, 4)}%` }}
        />
      )}

      <span className="relative z-10 flex min-w-0 items-center gap-1.5">
        {(selected || inCombo) && (
          <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-betclic-red text-white">
            <Check className="h-2.5 w-2.5" strokeWidth={3} />
          </span>
        )}
        <span
          className={cn(
            "truncate font-display text-[13.5px] font-semibold",
            inCombo ? "text-white" : "text-ink"
          )}
        >
          {opt.label}
        </span>
      </span>

      <span className="relative z-10 flex shrink-0 items-center gap-2">
        <span
          className={cn(
            "text-[11px] font-semibold tabular-nums",
            inCombo ? "text-white/75" : "text-dim"
          )}
        >
          {pct}%
        </span>
        <span
          className={cn(
            "relative min-w-[52px] rounded-lg px-2.5 py-1 text-center font-display text-[13px] font-bold tabular-nums transition-colors duration-200",
            selected || inCombo
              ? cn("bg-betclic-red", oddsTrendTextClass(trend, true))
              : cn(
                  "bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-edge",
                  oddsTrendTextClass(trend)
                )
          )}
        >
          {!expired && <OddsTrendCorner trend={trend} inverted={selected || inCombo} />}
          {formatOdds(opt.odds, oddsFormat)}
        </span>
      </span>
    </button>
  );
}

function SideButton({
  label,
  odds,
  oddsFormat,
  onClick,
  disabled,
  selected,
  inCombo,
  comboSelection,
}: {
  label: string;
  odds: number;
  oddsFormat: "decimal" | "fractional";
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
  inCombo?: boolean;
  comboSelection: ComboSelection;
}) {
  const active = selected || inCombo;
  const trend = useOddsTrend(odds);
  const { pressing, handlers, style } = useLongPressOdds({
    disabled: Boolean(disabled),
    comboSelection,
    onTap: () => onClick?.(),
  });

  return (
    <button
      type="button"
      disabled={disabled}
      {...handlers}
      style={style}
      className={cn(
        "relative flex h-11 items-center justify-between rounded-xl border px-3 transition-all active:scale-[0.98]",
        selected
          ? "border-betclic-red bg-betclic-red text-white"
          : inCombo
            ? "border-ink bg-ink text-white ring-2 ring-betclic-red/35"
            : "border-edge bg-elev text-ink active:bg-edge/60",
        pressing && !disabled && "scale-[0.96] ring-2 ring-betclic-red/50",
        disabled && "cursor-not-allowed"
      )}
    >
      {!disabled && <OddsTrendCorner trend={trend} inverted={active} />}
      <span
        className={cn(
          "text-[12.5px] font-semibold",
          active ? "text-white" : "text-mist"
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "font-display text-[14px] font-bold tabular-nums transition-colors duration-200",
          oddsTrendTextClass(trend, active)
        )}
      >
        {formatOdds(odds, oddsFormat)}
      </span>
    </button>
  );
}
