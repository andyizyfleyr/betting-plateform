"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Clock, ListChecks, TrendingUp } from "lucide-react";
import { api, type ClientPrediction, type PredictionOptionClient } from "@/lib/api";
import { PredictionBetModal } from "@/components/prediction-bet-modal";
import { useApp } from "@/components/providers";
import { cn, eur, formatOdds } from "@/lib/format";

const POLL_INTERVAL = 5_000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1_000;

type Category = "Tous" | "Sport" | "Actus" | "Crypto" | "Culture";
const CATEGORIES: Category[] = ["Tous", "Sport", "Actus", "Crypto", "Culture"];

type FormatFilter = "all" | "multi" | "binary";

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
  const [questions, setQuestions] = useState<ClientPrediction[] | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [category, setCategory] = useState<Category>("Tous");
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
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

  const open = useMemo(
    () => (questions ?? []).filter((q) => q.status === "open"),
    [questions]
  );

  const counts = useMemo(() => {
    const map: Record<Category, number> = {
      Tous: open.length,
      Sport: 0,
      Actus: 0,
      Crypto: 0,
      Culture: 0,
    };
    for (const q of open) {
      if (q.category in map) map[q.category as Category] += 1;
    }
    return map;
  }, [open]);

  const categoryFiltered = useMemo(
    () => (category === "Tous" ? open : open.filter((q) => q.category === category)),
    [open, category]
  );

  const multiCount = useMemo(
    () => categoryFiltered.filter(isMultiChoiceQuestion).length,
    [categoryFiltered]
  );
  const binaryCount = categoryFiltered.length - multiCount;

  const visibleOpen = useMemo(() => {
    const base =
      formatFilter === "multi"
        ? categoryFiltered.filter(isMultiChoiceQuestion)
        : formatFilter === "binary"
          ? categoryFiltered.filter((q) => !isMultiChoiceQuestion(q))
          : categoryFiltered;

    // En vue « Tous », on met en avant les marchés phares à choix multiples en tête,
    // puis les questions triées par échéance croissante.
    if (formatFilter === "all") {
      return [...base].sort((a, b) => {
        const am = isMultiChoiceQuestion(a) ? 0 : 1;
        const bm = isMultiChoiceQuestion(b) ? 0 : 1;
        if (am !== bm) return am - bm;
        return new Date(a.resolvesAt).getTime() - new Date(b.resolvesAt).getTime();
      });
    }
    return base;
  }, [categoryFiltered, formatFilter]);

  return (
    <div className="px-4 pb-8 pt-4">
      {/* En-tête compact */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
            Prédictions
          </h1>
          <p className="text-[12px] text-mist">Choix multiples & Oui / Non à cotes fixes</p>
        </div>
        {questions !== null && (
          <span className="rounded-full border border-edge bg-white px-2.5 py-1 font-display text-[11.5px] font-bold tabular-nums text-mist">
            {open.length} ouvertes
          </span>
        )}
      </div>

      {/* Barre de catégories + format collante */}
      <div className="sticky top-[52px] z-30 -mx-4 mt-3 border-b border-edge/70 bg-deep/95 px-4 py-2 backdrop-blur-md">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {CATEGORIES.map((c) => {
            const active = category === c;
            const n = counts[c];
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 font-display text-[12px] transition-colors active:scale-95",
                  active
                    ? "border-ink bg-ink font-bold text-white"
                    : "border-edge bg-white font-medium text-mist"
                )}
              >
                <span>{c}</span>
                {questions !== null && n > 0 && (
                  <span
                    className={cn(
                      "text-[10.5px] tabular-nums",
                      active ? "text-white/75" : "text-dim"
                    )}
                  >
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Sélecteur de format : Tous / Choix multiples / Oui-Non */}
        <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
          {(
            [
              { key: "all", label: "Tous les formats", count: categoryFiltered.length },
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
                  "flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11.5px] transition-colors active:scale-95",
                  active
                    ? "border-betclic-red bg-betclic-red font-semibold text-white"
                    : "border-edge bg-white font-medium text-mist"
                )}
              >
                <span>{label}</span>
                {questions !== null && (
                  <span
                    className={cn(
                      "text-[10px] tabular-nums",
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
      </div>

      {/* Liste des questions */}
      {questions === null ? (
        <div className="mt-3 flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="shimmer h-[168px] rounded-2xl" />
          ))}
        </div>
      ) : visibleOpen.length === 0 ? (
        <div className="mt-14 flex flex-col items-center text-center">
          <div className="glass-card grid h-14 w-14 place-items-center rounded-full text-dim">
            <TrendingUp className="h-5 w-5" strokeWidth={1.9} />
          </div>
          <p className="mt-3 font-display text-[15px] font-semibold text-ink">
            Aucune prédiction disponible
          </p>
          <p className="mt-1 text-[12.5px] text-dim">
            Essayez un autre filtre ou revenez bientôt.
          </p>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2.5">
          {visibleOpen.map((q) =>
            isMultiChoiceQuestion(q) && q.options ? (
              <MultiChoiceQuestionCard
                key={q.id}
                q={q}
                options={q.options}
                nowMs={nowMs}
                onSelect={(selection) => setTarget({ question: q, selection })}
              />
            ) : (
              <BinaryQuestionCard
                key={q.id}
                q={q}
                nowMs={nowMs}
                onSelect={(selection) => setTarget({ question: q, selection })}
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

function MultiChoiceQuestionCard({
  q,
  options,
  nowMs,
  onSelect,
}: {
  q: ClientPrediction;
  options: PredictionOptionClient[];
  nowMs: number;
  onSelect: (selection: string) => void;
}) {
  const { oddsFormat } = useApp();
  const expired = new Date(q.resolvesAt).getTime() <= nowMs;

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
      {/* Métadonnées */}
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

      {/* Question */}
      <h2 className="mt-2 font-display text-[15.5px] font-bold leading-snug text-ink">
        {q.question}
      </h2>

      {/* Mise existante éventuelle */}
      {q.myBet && myBetLabel && (
        <p className="mt-2 rounded-lg bg-betclic-red/8 px-2.5 py-1 text-[11px] font-semibold text-betclic-red">
          Votre mise : {myBetLabel} · {eur(q.myBet.stake)}
        </p>
      )}

      {/* Liste des candidats avec jauge de probabilité et cote fixe */}
      <div className="mt-2.5 flex flex-col gap-1.5">
        {displayed.map((opt) => {
          const pct = probs.get(opt.key) ?? 0;
          const selected = q.myBet?.selection === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              disabled={expired}
              onClick={expired ? undefined : () => onSelect(opt.key)}
              className={cn(
                "relative flex min-h-[44px] w-full items-center justify-between gap-2 overflow-hidden rounded-xl border px-3 py-2 text-left transition-all active:scale-[0.99]",
                selected
                  ? "border-betclic-red bg-betclic-red/[0.06]"
                  : "border-edge bg-elev/55 active:bg-elev",
                expired && "cursor-not-allowed"
              )}
            >
              {/* Barre de probabilité implicite en arrière-plan */}
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute inset-y-0 left-0 transition-all duration-300",
                  selected ? "bg-betclic-red/12" : "bg-ink/[0.045]"
                )}
                style={{ width: `${Math.max(pct, 4)}%` }}
              />

              <span className="relative z-10 flex min-w-0 items-center gap-1.5">
                {selected && (
                  <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-betclic-red text-white">
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  </span>
                )}
                <span className="truncate font-display text-[13.5px] font-semibold text-ink">
                  {opt.label}
                </span>
              </span>

              <span className="relative z-10 flex shrink-0 items-center gap-2">
                <span className="text-[11px] font-semibold tabular-nums text-dim">{pct}%</span>
                <span
                  className={cn(
                    "min-w-[52px] rounded-lg px-2.5 py-1 text-center font-display text-[13px] font-bold tabular-nums",
                    selected
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

      {/* Bouton Afficher tous les candidats si > 4 */}
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
  const { oddsFormat } = useApp();
  const expired = new Date(q.resolvesAt).getTime() <= nowMs;

  const pYes = Math.round(((1 / q.oddsYes) / (1 / q.oddsYes + 1 / q.oddsNo)) * 100);

  return (
    <article
      className={cn(
        "glass-card rounded-2xl p-3.5",
        expired && "opacity-70"
      )}
    >
      {/* Métadonnées */}
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

      {/* Question lisible */}
      <h2 className="mt-2 font-display text-[15px] font-semibold leading-snug text-ink">
        {q.question}
      </h2>

      {/* Tendance Oui / Non */}
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

      {/* Mise existante éventuelle */}
      {q.myBet && (
        <p className="mt-2.5 rounded-lg bg-betclic-red/8 px-2.5 py-1 text-[11px] font-semibold text-betclic-red">
          Votre mise : {q.myBet.selection === "yes" ? "Oui" : "Non"} · {eur(q.myBet.stake)}
        </p>
      )}

      {/* Boutons Oui / Non */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <SideButton
          label="Oui"
          odds={q.oddsYes}
          oddsFormat={oddsFormat}
          onClick={expired ? undefined : () => onSelect("yes")}
          disabled={expired}
          selected={q.myBet?.selection === "yes"}
        />
        <SideButton
          label="Non"
          odds={q.oddsNo}
          oddsFormat={oddsFormat}
          onClick={expired ? undefined : () => onSelect("no")}
          disabled={expired}
          selected={q.myBet?.selection === "no"}
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
}: {
  label: string;
  odds: number;
  oddsFormat: "decimal" | "fractional";
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-11 items-center justify-between rounded-xl border px-3 transition-colors active:scale-[0.98]",
        selected
          ? "border-betclic-red bg-betclic-red text-white"
          : "border-edge bg-elev text-ink active:bg-edge/60",
        disabled && "cursor-not-allowed"
      )}
    >
      <span
        className={cn(
          "text-[12.5px] font-semibold",
          selected ? "text-white" : "text-mist"
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "font-display text-[14px] font-bold tabular-nums",
          selected ? "text-white" : "text-betclic-red"
        )}
      >
        {formatOdds(odds, oddsFormat)}
      </span>
    </button>
  );
}
