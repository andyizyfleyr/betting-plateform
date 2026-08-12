"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Clock, TrendingUp } from "lucide-react";
import { api, type ClientPrediction } from "@/lib/api";
import { PredictionBetModal } from "@/components/prediction-bet-modal";
import { useApp } from "@/components/providers";
import { cn, eur, formatOdds } from "@/lib/format";

const POLL_INTERVAL = 5_000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1_000;

type Category = "Tous" | "Sport" | "Actus" | "Crypto" | "Culture";
const CATEGORIES: Category[] = ["Tous", "Sport", "Actus", "Crypto", "Culture"];

function formatResolves(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "En cours de résolution";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `Dans ${Math.max(mins, 1)} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Dans ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Demain";
  return `Dans ${days} j`;
}

export default function PredictionsPage() {
  const [questions, setQuestions] = useState<ClientPrediction[] | null>(null);
  const [category, setCategory] = useState<Category>("Tous");
  const [target, setTarget] = useState<{
    question: ClientPrediction;
    selection: "yes" | "no";
  } | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const retryCountRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchQuestions = useCallback(async (isBackground = false) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    try {
      if (isBackground) setIsUpdating(true);
      const r = await api.predictions();
      retryCountRef.current = 0;
      setQuestions(r.questions);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current++;
        await new Promise((r) => setTimeout(r, RETRY_DELAY * retryCountRef.current));
        return fetchQuestions(isBackground);
      }
      if (!isBackground) setQuestions([]);
    } finally {
      if (isBackground) setIsUpdating(false);
    }
  }, []);

  useEffect(() => {
    fetchQuestions(false);
    const id = setInterval(() => fetchQuestions(true), POLL_INTERVAL);
    return () => {
      clearInterval(id);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchQuestions]);

  const open = useMemo(
    () => (questions ?? []).filter((q) => q.status === "open"),
    [questions]
  );

  const visibleOpen = useMemo(
    () => (category === "Tous" ? open : open.filter((q) => q.category === category)),
    [open, category]
  );

  const visibleOpenVolume = useMemo(
    () => visibleOpen.reduce((s, q) => s + q.volume, 0),
    [visibleOpen]
  );

  return (
    <div className="px-3 pb-24 pt-5">
      {/* Titre */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.24em] text-betclic-red">
            MARCHÉS DE PRÉDICTION
          </p>
          <h1 className="mt-1 font-display text-[30px] font-bold leading-none tracking-tight">
            Prédictions
          </h1>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-edge bg-white px-3 py-2">
          <TrendingUp className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.4} />
          <span className="font-display text-xl font-bold leading-none tabular-nums">
            {open.length}
          </span>
          <span className="text-[9px] font-semibold tracking-[0.18em] text-dim">OUVERTES</span>
          {isUpdating && (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-betclic-red" />
          )}
        </div>
      </div>

      {/* Filtres par catégorie */}
      <div className="mt-4 flex gap-1.5 overflow-x-auto no-scrollbar">
        {CATEGORIES.map((c) => {
          const active = category === c;
          return (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn(
                "relative shrink-0 rounded-full border px-3.5 py-1.5 font-display text-[11.5px] transition-colors",
                active
                  ? "border-betclic-red bg-betclic-red text-white"
                  : "border-edge bg-white text-mist"
              )}
            >
              {c}
            </button>
          );
        })}
      </div>

      {/* Contenu */}
      {questions === null ? (
        <div className="mt-4 flex flex-col gap-2.5">
          {[0, 1].map((i) => (
            <div key={i} className="shimmer h-[150px] rounded-[20px]" />
          ))}
        </div>
      ) : visibleOpen.length === 0 && visibleResolved.length === 0 ? (
        <div className="mt-16 flex flex-col items-center text-center">
          <div className="glass-card grid h-16 w-16 place-items-center rounded-full text-dim">
            <TrendingUp className="h-6 w-6" strokeWidth={1.8} />
          </div>
          <p className="mt-4 font-display text-[15px] font-semibold">Aucune question ici</p>
          <p className="mt-1 text-[12.5px] text-dim">
            De nouvelles prédictions arrivent régulièrement.
          </p>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={category}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="mt-5"
          >
            {visibleOpen.length > 0 && (
              <section>
                <SectionHeader
                  label="En cours"
                  count={visibleOpen.length}
                  detail={`Volume ${eur(visibleOpenVolume)}`}
                />
                <div className="mt-2.5 flex flex-col gap-2.5">
                  {visibleOpen.map((q, i) => (
                    <QuestionCard key={q.id} q={q} index={i} onSelect={(selection) => setTarget({ question: q, selection })} />
                  ))}
                </div>
              </section>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      <p className="mt-8 text-center text-[10px] leading-relaxed text-dim">
        Cotes fournies à titre indicatif · 18+ · Jouez de manière responsable.
      </p>

      <PredictionBetModal
        question={target?.question ?? null}
        selection={target?.selection ?? null}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}

function SectionHeader({
  label,
  count,
  detail,
}: {
  label: string;
  count: number;
  detail?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="h-2 w-2 rounded-full bg-betclic-red/70" />
      <h2 className="font-display text-[12px] font-bold uppercase tracking-[0.18em] text-ink">
        {label}
      </h2>
      {detail && <span className="text-[10.5px] font-medium text-dim">{detail}</span>}
      <span className="h-px flex-1 bg-elev" />
      <span className="rounded-md bg-elev px-2 py-0.5 font-display text-[10.5px] font-bold text-mist">
        {count}
      </span>
    </div>
  );
}

function QuestionCard({
  q,
  index,
  onSelect,
}: {
  q: ClientPrediction;
  index: number;
  onSelect: (selection: "yes" | "no") => void;
}) {
  const { oddsFormat } = useApp();
  const expired = new Date(q.resolvesAt).getTime() <= Date.now();

  const totalVotes = q.yesCount + q.noCount;
  const pYes = totalVotes > 0 ? Math.round((q.yesCount / totalVotes) * 100) : 50;

  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: Math.min(index * 0.06, 0.4), ease: [0.22, 1, 0.36, 1] }}
      className={cn("glass-card rounded-[20px] p-4", expired && "opacity-75")}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded-md bg-betclic-red/10 px-2 py-0.5 font-display text-[9px] font-bold tracking-[0.16em] text-betclic-red">
          {q.category.toUpperCase()}
        </span>
        {q.myBet && (
          <span className="rounded-md bg-betclic-red/10 px-2 py-0.5 font-display text-[9px] font-bold text-betclic-red">
            Votre pari : {q.myBet.selection === "yes" ? "Oui" : "Non"} ({eur(q.myBet.stake)})
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] font-semibold text-dim">
          <Clock className="h-3 w-3" strokeWidth={2.2} />
          {expired ? "Paris clos" : formatResolves(q.resolvesAt)}
        </span>
      </div>

      <h3 className="mt-2.5 font-display text-[12px] font-bold leading-snug tracking-tight">
        {q.question}
      </h3>

      <div className="mt-2">
        <div className="flex justify-between text-[10.5px] font-medium text-dim">
          <span>Oui {pYes}%</span>
          <span>Volume · {eur(q.volume)}</span>
          <span>Non {100 - pYes}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-elev flex">
          <div className="bg-betclic-red transition-all duration-500" style={{ width: `${pYes}%` }} />
          <div className="bg-mist/30 flex-1" />
        </div>
      </div>

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
    </motion.article>
  );
}

function SideButton({
  label,
  odds,
  oddsFormat,
  onClick,
  winner,
  disabled,
  selected,
}: {
  label: string;
  odds: number;
  oddsFormat: "decimal" | "fractional";
  onClick?: () => void;
  winner?: boolean;
  disabled?: boolean;
  selected?: boolean;
}) {
  return (
    <motion.button
      whileTap={onClick && !disabled ? { scale: 0.96 } : undefined}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center justify-between rounded-xl border px-3.5 py-2.5 transition-colors",
        disabled
          ? "border-edge bg-elev/50 opacity-60 cursor-not-allowed"
          : winner
            ? "border-win/50 bg-win/10"
            : winner === false
              ? "border-edge bg-elev/50 text-mist"
              : selected
                ? "border-betclic-red bg-betclic-red/10 text-betclic-red"
                : "border-edge bg-white text-ink active:border-betclic-red/50 active:bg-betclic-red/5"
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {winner && <CheckCircle2 className="h-4 w-4 shrink-0 text-win" strokeWidth={2.6} />}
        <span
          className={cn(
            "font-display text-[12.5px] font-bold",
            winner && "text-win"
          )}
        >
          {label}
        </span>
        {winner && (
          <span className="hidden whitespace-nowrap text-[9px] font-semibold uppercase tracking-wide text-win sm:inline">
            Bonne réponse
          </span>
        )}
      </span>
      <span
        className={cn(
          "font-display text-[13px] font-bold tabular-nums",
          winner ? "text-win" : winner === false ? "text-mist" : "text-betclic-red"
        )}
      >
        {formatOdds(odds, oddsFormat)}
      </span>
    </motion.button>
  );
}
