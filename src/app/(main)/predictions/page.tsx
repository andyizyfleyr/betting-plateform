"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, ChevronDown, Clock, ListChecks, Search, TrendingUp, X } from "lucide-react";
import { api, type ClientPrediction, type PredictionOptionClient } from "@/lib/api";
import { PredictionBetModal } from "@/components/prediction-bet-modal";
import { useApp } from "@/components/providers";
import { cn, eur, formatOdds, formatPlacedAt } from "@/lib/format";

const POLL_INTERVAL = 5_000;
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
  const { comboQuickMode, toggleComboLeg, toast } = useApp();
  const [questions, setQuestions] = useState<ClientPrediction[] | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [statusTab, setStatusTab] = useState<StatusTab>("open");
  const [category, setCategory] = useState<Category>("Tous");
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<{
    question: ClientPrediction;
    selection: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchQuestions(isBackground = false) {
      if (isBackground && typeof document !== "undefined" && document.hidden) return;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const r = await api.predictions();
          if (cancelled) return;
          setQuestions(r.questions);
          setNowMs(Date.now());
          return;
        } catch {
          if (cancelled) return;
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY * (attempt + 1)));
            continue;
          }
          if (!isBackground && !cancelled) setQuestions([]);
        }
      }
    }

    void fetchQuestions(false);
    const id = setInterval(() => void fetchQuestions(true), POLL_INTERVAL);
    const onVisible = () => {
      if (!document.hidden) void fetchQuestions(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const openList = useMemo(
    () => (questions ?? []).filter((q) => q.status === "open"),
    [questions]
  );

  const resolvedList = useMemo(
    () =>
      (questions ?? [])
        .filter((q) => q.status === "resolved")
        .sort(
          (a, b) =>
            new Date(b.resolvedAt ?? b.resolvesAt).getTime() -
            new Date(a.resolvedAt ?? a.resolvesAt).getTime()
        ),
    [questions]
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

    const qTrim = query.trim().toLowerCase();
    const searched = qTrim
      ? byFormat.filter(
          (q) =>
            q.question.toLowerCase().includes(qTrim) ||
            q.category.toLowerCase().includes(qTrim) ||
            (q.options ?? []).some((o) => o.label.toLowerCase().includes(qTrim))
        )
      : byFormat;

    if (statusTab === "resolved") return searched;

    if (formatFilter === "all") {
      return [...searched].sort((a, b) => {
        const am = isMultiChoiceQuestion(a) ? 0 : 1;
        const bm = isMultiChoiceQuestion(b) ? 0 : 1;
        if (am !== bm) return am - bm;
        return new Date(a.resolvesAt).getTime() - new Date(b.resolvesAt).getTime();
      });
    }
    return searched;
  }, [categoryFiltered, formatFilter, query, statusTab]);

  const handleSelectOutcome = (
    q: ClientPrediction,
    selection: string,
    selectionLabel: string,
    odds: number
  ) => {
    if (comboQuickMode) {
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

  return (
    <div className="px-4 pb-8 pt-4">
      {/* En-tête compact + Recherche */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
            Prédictions
          </h1>
          <p className="text-[12px] text-mist">Choix multiples & Oui / Non à cotes fixes</p>
        </div>

        <button
          type="button"
          onClick={() => {
            setSearchOpen((s) => {
              if (s) setQuery("");
              return !s;
            });
          }}
          aria-label="Rechercher une prédiction"
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-colors active:scale-95",
            searchOpen ? "border-ink bg-ink text-white" : "border-edge bg-white text-mist"
          )}
        >
          {searchOpen ? <X className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
        </button>
      </div>

      {searchOpen && (
        <div className="mt-2.5 flex h-10 items-center gap-2 rounded-xl border border-edge bg-white px-3">
          <Search className="h-4 w-4 shrink-0 text-dim" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une question ou un candidat…"
            autoFocus
            className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-dim"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="text-dim">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Barre collante : Ouvertes / Résolues + Catégories + Formats */}
      <div className="sticky top-[52px] z-30 -mx-4 mt-3 border-b border-edge/70 bg-deep/95 px-4 py-2 backdrop-blur-md">
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-edge bg-white p-1">
          {(
            [
              { key: "open" as const, label: `Ouvertes (${openList.length})` },
              { key: "resolved" as const, label: `Résolues (${resolvedList.length})` },
            ] as const
          ).map(({ key, label }) => {
            const active = statusTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setStatusTab(key)}
                className={cn(
                  "h-8 rounded-lg font-display text-[11.5px] transition-colors",
                  active ? "bg-ink font-bold text-white" : "font-medium text-mist"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
          {CATEGORIES.map((c) => {
            const active = category === c;
            const n = counts[c];
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={cn(
                  "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 font-display text-[11.5px] transition-colors active:scale-95",
                  active
                    ? "border-betclic-red bg-betclic-red font-bold text-white"
                    : "border-edge bg-white font-medium text-mist"
                )}
              >
                <span>{c}</span>
                {questions !== null && n > 0 && (
                  <span
                    className={cn(
                      "text-[10px] tabular-nums",
                      active ? "text-white/80" : "text-dim"
                    )}
                  >
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {statusTab === "open" && (
          <div className="no-scrollbar mt-1.5 flex gap-1.5 overflow-x-auto">
            {(
              [
                { key: "all", label: "Tous formats", count: categoryFiltered.length },
                { key: "multi", label: "Choix multiples", count: multiCount },
                { key: "binary", label: "Oui / Non", count: binaryCount },
              ] as const
            ).map(({ key, label, count }) => {
              const active = formatFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFormatFilter(key)}
                  className={cn(
                    "flex h-6.5 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] transition-colors active:scale-95",
                    active
                      ? "border-ink bg-ink font-semibold text-white"
                      : "border-edge bg-white font-medium text-mist"
                  )}
                >
                  <span>{label}</span>
                  {questions !== null && (
                    <span
                      className={cn(
                        "text-[9.5px] tabular-nums",
                        active ? "text-white/80" : "text-dim"
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Liste des questions */}
      {questions === null ? (
        <div className="mt-3 flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="shimmer h-[168px] rounded-2xl" />
          ))}
        </div>
      ) : visibleQuestions.length === 0 ? (
        <div className="mt-14 flex flex-col items-center text-center">
          <div className="glass-card grid h-14 w-14 place-items-center rounded-full text-dim">
            <TrendingUp className="h-5 w-5" strokeWidth={1.9} />
          </div>
          <p className="mt-3 font-display text-[15px] font-semibold text-ink">
            {statusTab === "resolved"
              ? "Aucune prédiction résolue dans ce filtre"
              : "Aucune prédiction disponible"}
          </p>
          <p className="mt-1 text-[12.5px] text-dim">
            Essayez une autre catégorie ou effacez la recherche.
          </p>
        </div>
      ) : statusTab === "resolved" ? (
        <div className="mt-3 flex flex-col gap-2.5">
          {visibleQuestions.map((q) => (
            <ResolvedQuestionCard key={q.id} q={q} />
          ))}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2.5">
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

  const hasBetBeyondFold = useMemo(() => {
    if (!q.myBet || sortedOptions.length <= 4) return false;
    const idx = sortedOptions.findIndex((o) => o.key === q.myBet?.selection);
    return idx >= 4;
  }, [q.myBet, sortedOptions]);

  const [expanded, setExpanded] = useState(false);
  const showAll = expanded || hasBetBeyondFold || sortedOptions.length <= 4;
  const displayed = showAll ? sortedOptions : sortedOptions.slice(0, 4);

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
          return (
            <button
              key={opt.key}
              type="button"
              disabled={expired}
              onClick={expired ? undefined : () => onSelect(opt.key, opt.label, opt.odds)}
              className={cn(
                "relative flex min-h-[44px] w-full items-center justify-between gap-2 overflow-hidden rounded-xl border px-3 py-2 text-left transition-all active:scale-[0.99]",
                inCombo
                  ? "border-ink bg-ink text-white ring-2 ring-betclic-red/35"
                  : selected
                    ? "border-betclic-red bg-betclic-red/[0.06]"
                    : "border-edge bg-elev/55 active:bg-elev",
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
                    "min-w-[52px] rounded-lg px-2.5 py-1 text-center font-display text-[13px] font-bold tabular-nums",
                    selected || inCombo
                      ? "bg-betclic-red text-white"
                      : "bg-white text-betclic-red shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-edge"
                  )}
                >
                  {formatOdds(opt.odds, oddsFormat)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {sortedOptions.length > 4 && !hasBetBeyondFold && (
        <button
          type="button"
          onClick={() => setExpanded((s) => !s)}
          className="mt-2 flex h-8 w-full items-center justify-center gap-1 rounded-xl bg-elev/70 font-display text-[11.5px] font-semibold text-mist active:bg-elev"
        >
          <span>
            {expanded
              ? "Masquer les autres choix"
              : `Voir les ${sortedOptions.length} choix (+${sortedOptions.length - 4})`}
          </span>
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
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
        />
        <SideButton
          label="Non"
          odds={q.oddsNo}
          oddsFormat={oddsFormat}
          onClick={expired ? undefined : () => onSelect("no")}
          disabled={expired}
          selected={q.myBet?.selection === "no"}
          inCombo={isInCombo(comboUid, "yesno", "no")}
        />
      </div>
    </article>
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
}: {
  label: string;
  odds: number;
  oddsFormat: "decimal" | "fractional";
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
  inCombo?: boolean;
}) {
  const active = selected || inCombo;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-11 items-center justify-between rounded-xl border px-3 transition-colors active:scale-[0.98]",
        selected
          ? "border-betclic-red bg-betclic-red text-white"
          : inCombo
            ? "border-ink bg-ink text-white ring-2 ring-betclic-red/35"
            : "border-edge bg-elev text-ink active:bg-edge/60",
        disabled && "cursor-not-allowed"
      )}
    >
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
          "font-display text-[14px] font-bold tabular-nums",
          active ? "text-white" : "text-betclic-red"
        )}
      >
        {formatOdds(odds, oddsFormat)}
      </span>
    </button>
  );
}
