"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock,
  Layers,
  Lock,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { api, type ClientPrediction } from "@/lib/api";
import { getCachedPrediction } from "@/lib/client-entity-cache";
import { getAdaptiveIntervalMs, useNetworkQuality } from "@/lib/network-saver";
import { PredictionBetModal } from "@/components/prediction-bet-modal";
import { useApp } from "@/components/providers";
import { cn, formatKickoff, formatOdds } from "@/lib/format";

const POLL_MS = 10_000;

export default function PredictionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const questionId = Number(params?.id);
  const invalidId = !Number.isInteger(questionId) || questionId <= 0;

  const {
    oddsFormat,
    comboLegs,
    comboQuickMode,
    toggleComboLeg,
    toast,
  } = useApp();
  const { isOffline, isConstrained } = useNetworkQuality();
  const pollIntervalMs = getAdaptiveIntervalMs(POLL_MS, isConstrained);

  const [prevId, setPrevId] = useState(questionId);
  const [question, setQuestion] = useState<ClientPrediction | null | undefined>(() =>
    invalidId ? null : (getCachedPrediction(questionId) ?? undefined)
  );
  const [activeSelection, setActiveSelection] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  if (questionId !== prevId) {
    setPrevId(questionId);
    setQuestion(invalidId ? null : (getCachedPrediction(questionId) ?? undefined));
    setActiveSelection(null);
  }

  const fetchPrediction = useCallback(async () => {
    if (invalidId || isOffline) return;
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const cat = await api.predictionsCatalog();
      const found = cat.questions.find((q) => q.id === questionId) ?? null;
      setQuestion(found);
      setLoadError(null);
    } catch (e) {
      setQuestion((prev) => (prev === undefined ? null : prev));
      setLoadError(
        e instanceof Error
          ? e.message
          : "Impossible de charger ce marché."
      );
    }
  }, [invalidId, isOffline, questionId]);

  const isOpen = question?.status === "open";

  useEffect(() => {
    if (invalidId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPrediction();
    if (question && !isOpen) return;
    const id = setInterval(() => void fetchPrediction(), pollIntervalMs);
    return () => clearInterval(id);
  }, [invalidId, fetchPrediction, question, isOpen, pollIntervalMs]);

  const sortedOptions = useMemo(() => {
    if (!question) return [];
    const base =
      question.options && question.options.length >= 2
        ? [...question.options].sort((a, b) => a.odds - b.odds)
        : [
            { key: "yes", label: "Oui", odds: question.oddsYes },
            { key: "no", label: "Non", odds: question.oddsNo },
          ];
    const weights = base.map((o) => (o.odds > 0 ? 1 / o.odds : 0));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    return base.map((o, i) => ({
      ...o,
      sharePct: Math.round((weights[i] / sum) * 100),
    }));
  }, [question]);

  const comboPick = useMemo(
    () =>
      comboLegs.find((l) => l.uid === `pred-${questionId}`)?.selection ?? null,
    [comboLegs, questionId]
  );

  const pickOption = (optKey: string, optLabel: string, optOdds: number) => {
    if (!question || question.status !== "open") return;
    if (comboQuickMode) {
      const res = toggleComboLeg({
        uid: `pred-${question.id}`,
        kind: "prediction",
        questionId: question.id,
        title: question.question,
        league: question.category,
        market: "prediction",
        selection: optKey,
        selectionLabel: optLabel,
        odds: optOdds,
        startsAt: question.resolvesAt,
      });
      if (res === "full") {
        toast({
          kind: "error",
          title: "Betslip complet (8 sélections max)",
        });
      }
      return;
    }
    setActiveSelection(optKey);
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] px-3 pb-6 pt-2.5 lg:px-0 lg:py-0">
      {/* En-tête compact en ligne */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) {
                router.back();
              } else {
                router.push("/predictions");
              }
            }}
            aria-label="Retour aux prédictions"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-ink ring-1 ring-edge active:scale-95 lg:h-9 lg:w-9"
          >
            <ArrowLeft className="h-3.5 w-3.5 lg:h-4 lg:w-4" strokeWidth={2.3} />
          </button>

          <div className="flex min-w-0 items-center gap-1.5">
            <TrendingUp
              className="h-3.5 w-3.5 shrink-0 text-betclic-red"
              strokeWidth={2.3}
            />
            <h1 className="truncate font-display text-[14px] font-extrabold text-ink lg:text-[18px]">
              {question?.category ?? "Prédiction"}
            </h1>
          </div>
        </div>

        {question && (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 font-display text-[10px] font-bold",
              question.status === "open"
                ? "bg-win/12 text-win"
                : question.status === "resolved"
                  ? "bg-ink text-white"
                  : "bg-elev text-mist"
            )}
          >
            {question.status === "open"
              ? "Ouvert"
              : question.status === "resolved"
                ? "Résolu"
                : "Clôturé"}
          </span>
        )}
      </div>

      <div className="mt-2.5 lg:mt-4">
        {question === undefined ? (
          <div className="space-y-2.5">
            <div className="skeleton h-[94px] rounded-xl" />
            <div className="skeleton h-[150px] rounded-xl" />
          </div>
        ) : question === null ? (
          <div className="glass-card rounded-xl p-4 text-center">
            <AlertTriangle className="mx-auto h-5 w-5 text-betclic-red" />
            <p className="mt-1.5 font-display text-[14.5px] font-bold text-ink">
              Prédiction introuvable
            </p>
            <p className="mt-0.5 text-[11.5px] text-mist">
              {loadError ?? "Ce marché n'est plus disponible."}
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => void fetchPrediction()}
                className="inline-flex items-center gap-1 rounded-lg bg-elev px-3 py-1.5 font-display text-[11.5px] font-bold text-ink"
              >
                <RefreshCw className="h-3 w-3" />
                Réessayer
              </button>
              <Link
                href="/predictions"
                className="btn-red rounded-lg px-3.5 py-1.5 text-[11.5px]"
              >
                Prédictions
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 lg:space-y-4">
            {/* Carte compacte de la question */}
            <section className="glass-card overflow-hidden rounded-xl p-3 lg:rounded-2xl lg:p-4">
              <div className="flex items-center justify-end text-[10px] font-semibold tabular-nums text-dim lg:text-[11px]">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {question.status === "resolved" && question.resolvedAt
                    ? `Résolu · ${formatKickoff(question.resolvedAt)}`
                    : `Clôture · ${formatKickoff(question.resolvesAt)}`}
                </span>
              </div>

              <h2 className="mt-1 font-display text-[14.5px] font-extrabold leading-snug text-ink lg:text-[17.5px]">
                {question.question}
              </h2>
            </section>

            {/* Issues compactes en une seule ligne chacune */}
            <section className="glass-card overflow-hidden rounded-xl p-3 lg:rounded-2xl lg:p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-[11px] font-extrabold uppercase tracking-wider text-mist">
                  Issues ({sortedOptions.length})
                </h3>
                {comboPick && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2 py-0.5 font-display text-[9.5px] font-bold text-white">
                    <Layers className="h-2.5 w-2.5 text-betclic-red" />
                    Betslip
                  </span>
                )}
              </div>

              <div className="mt-2 space-y-1.5">
                {sortedOptions.map((opt) => {
                  const locked = question.status !== "open";
                  const isWinner =
                    question.status === "resolved" &&
                    question.resolution === opt.key;
                  const inCombo = comboPick === opt.key;

                  return (
                    <button
                      key={opt.key}
                      type="button"
                      disabled={locked}
                      onClick={() => pickOption(opt.key, opt.label, opt.odds)}
                      className={cn(
                        "relative flex min-h-[40px] w-full items-center justify-between gap-2 overflow-hidden rounded-lg border px-2.5 py-1.5 text-left transition-all active:scale-[0.99] lg:min-h-[46px] lg:rounded-xl lg:px-3.5 lg:py-2",
                        isWinner
                          ? "border-win/55 bg-win/10"
                          : inCombo
                            ? "border-ink bg-ink text-white ring-2 ring-betclic-red/35"
                            : "border-edge bg-elev/50 hover:border-betclic-red/40",
                        locked && !isWinner && "cursor-not-allowed opacity-75"
                      )}
                    >
                      <div
                        className={cn(
                          "pointer-events-none absolute inset-y-0 left-0",
                          isWinner
                            ? "bg-win/18"
                            : inCombo
                              ? "bg-white/10"
                              : "bg-betclic-red/[0.06]"
                        )}
                        style={{
                          width: `${Math.max(3, Math.min(100, opt.sharePct))}%`,
                        }}
                      />

                      <div className="relative flex min-w-0 flex-1 items-center gap-1.5">
                        <span
                          className={cn(
                            "truncate font-display text-[12px] font-bold leading-snug lg:text-[13.5px]",
                            inCombo ? "text-white" : "text-ink"
                          )}
                        >
                          {opt.label}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 text-[10.5px] font-semibold tabular-nums",
                            inCombo ? "text-white/75" : "text-dim"
                          )}
                        >
                          {opt.sharePct}%
                        </span>
                        {isWinner && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-win px-1.5 py-0.5 font-display text-[9px] font-bold text-white">
                            <Check className="h-2.5 w-2.5" strokeWidth={3} />
                            Gagnant
                          </span>
                        )}
                      </div>

                      <div className="relative shrink-0">
                        {locked && !isWinner ? (
                          <Lock className="h-3.5 w-3.5 text-dim" />
                        ) : (
                          <span
                            className={cn(
                              "inline-flex min-w-[48px] justify-center rounded-md px-2 py-1 font-display text-[12px] font-extrabold tabular-nums lg:min-w-[54px] lg:rounded-lg lg:text-[13px]",
                              inCombo
                                ? "bg-betclic-red text-white"
                                : "bg-white text-ink shadow-2xs"
                            )}
                          >
                            {formatOdds(opt.odds, oddsFormat)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>

      <PredictionBetModal
        question={question ?? null}
        selection={activeSelection}
        onClose={() => setActiveSelection(null)}
      />
    </div>
  );
}
