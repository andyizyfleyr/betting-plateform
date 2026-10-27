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
import {
  api,
  type ClientBet,
  type ClientPrediction,
} from "@/lib/api";
import {
  getAllCachedBets,
  getCachedPrediction,
} from "@/lib/client-entity-cache";
import { getAdaptiveIntervalMs, useNetworkQuality } from "@/lib/network-saver";
import { BetTicket } from "@/components/bet-ticket";
import { PredictionBetModal } from "@/components/prediction-bet-modal";
import { useApp } from "@/components/providers";
import { ShareTicketModal } from "@/components/share-ticket-modal";
import { cn, eur, formatKickoff, formatOdds } from "@/lib/format";

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
    user,
    betsVersion,
  } = useApp();
  const { isOffline, isConstrained } = useNetworkQuality();
  const pollIntervalMs = getAdaptiveIntervalMs(POLL_MS, isConstrained);

  const [prevId, setPrevId] = useState(questionId);
  const [question, setQuestion] = useState<ClientPrediction | null | undefined>(() =>
    invalidId ? null : (getCachedPrediction(questionId) ?? undefined)
  );
  const [activeSelection, setActiveSelection] = useState<string | null>(null);
  const [myQuestionBets, setMyQuestionBets] = useState<ClientBet[]>(() =>
    invalidId
      ? []
      : getAllCachedBets().filter(
          (b) =>
            (b.kind === "prediction" && b.questionId === questionId) ||
            (b.kind === "combo" &&
              b.legs?.some(
                (l) => l.kind === "prediction" && l.questionId === questionId
              ))
        )
  );
  const [shareBet, setShareBet] = useState<ClientBet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  if (questionId !== prevId) {
    setPrevId(questionId);
    setQuestion(invalidId ? null : (getCachedPrediction(questionId) ?? undefined));
    setActiveSelection(null);
    setMyQuestionBets(
      invalidId
        ? []
        : getAllCachedBets().filter(
            (b) =>
              (b.kind === "prediction" && b.questionId === questionId) ||
              (b.kind === "combo" &&
                b.legs?.some(
                  (l) => l.kind === "prediction" && l.questionId === questionId
                ))
          )
    );
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

  useEffect(() => {
    if (!user || invalidId) return;
    let cancelled = false;
    api
      .allBets()
      .then((r) => {
        if (cancelled) return;
        setMyQuestionBets(
          r.bets.filter(
            (b) =>
              (b.kind === "prediction" && b.questionId === questionId) ||
              (b.kind === "combo" &&
                b.legs?.some(
                  (l) => l.kind === "prediction" && l.questionId === questionId
                ))
          )
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, invalidId, questionId, betsVersion]);

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
    <div className="pb-8">
      {/* En-tête collant */}
      <div className="sticky top-[52px] z-30 border-b border-edge bg-white/95 px-3.5 py-2.5 backdrop-blur lg:top-0 lg:rounded-t-2xl lg:px-5">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
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
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-elev text-ink transition-colors hover:bg-edge active:scale-95"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2.3} />
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <TrendingUp
                  className="h-3.5 w-3.5 shrink-0 text-betclic-red"
                  strokeWidth={2.3}
                />
                <h1 className="truncate font-display text-[14.5px] font-extrabold text-ink">
                  {question?.category ?? "Prédiction"}
                </h1>
              </div>
              {question && (
                <p className="truncate text-[11px] text-dim">
                  {sortedOptions.length} issues · Cotes fixes garanties
                </p>
              )}
            </div>
          </div>

          {question && (
            <span
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 font-display text-[10.5px] font-bold",
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
      </div>

      <div className="px-3.5 pt-3.5 lg:px-0 lg:pt-4">
        {question === undefined ? (
          <div className="space-y-3">
            <div className="skeleton h-[140px] rounded-2xl" />
            <div className="skeleton h-[220px] rounded-2xl" />
          </div>
        ) : question === null ? (
          <div className="glass-card rounded-2xl p-6 text-center">
            <AlertTriangle className="mx-auto h-6 w-6 text-betclic-red" />
            <p className="mt-2 font-display text-[16px] font-bold text-ink">
              Prédiction introuvable
            </p>
            <p className="mt-1 text-[12.5px] text-mist">
              {loadError ?? "Ce marché n'est plus disponible."}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => void fetchPrediction()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-elev px-4 py-2 font-display text-[12px] font-bold text-ink"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Réessayer
              </button>
              <Link
                href="/predictions"
                className="btn-red rounded-xl px-4 py-2 text-[12px]"
              >
                Toutes les prédictions
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Carte principale de la question */}
            <section className="glass-card overflow-hidden rounded-2xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-mist">
                <span className="rounded-md bg-betclic-red/10 px-2 py-0.5 font-display text-[10.5px] font-bold uppercase tracking-wide text-betclic-red">
                  {question.category}
                </span>
                <span className="inline-flex items-center gap-1 tabular-nums text-dim">
                  <Clock className="h-3.5 w-3.5" />
                  {question.status === "resolved" && question.resolvedAt
                    ? `Résolu · ${formatKickoff(question.resolvedAt)}`
                    : `Clôture · ${formatKickoff(question.resolvesAt)}`}
                </span>
              </div>

              <h2 className="mt-3 font-display text-[18px] font-extrabold leading-snug text-ink">
                {question.question}
              </h2>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11.5px] text-mist">
                <span>
                  Volume engagé :{" "}
                  <strong className="font-display text-ink">
                    {eur(question.volume)}
                  </strong>
                </span>
                <span className="text-dim">·</span>
                <span>
                  Participants :{" "}
                  <strong className="font-display text-ink">
                    {question.yesCount + question.noCount}
                  </strong>
                </span>
              </div>
            </section>

            {/* Toutes les issues disponibles (cotes fixes) */}
            <section className="glass-card overflow-hidden rounded-2xl p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-[13px] font-extrabold uppercase tracking-wider text-mist">
                  Toutes les issues ({sortedOptions.length})
                </h3>
                {comboPick && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-0.5 font-display text-[10px] font-bold text-white">
                    <Layers className="h-3 w-3 text-betclic-red" />
                    Au Betslip
                  </span>
                )}
              </div>

              <div className="mt-3 space-y-2.5">
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
                        "relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-xl border px-3.5 py-3 text-left transition-all active:scale-[0.99]",
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

                      <div className="relative min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "font-display text-[13.5px] font-bold leading-snug",
                              inCombo ? "text-white" : "text-ink"
                            )}
                          >
                            {opt.label}
                          </span>
                          {isWinner && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-win px-2 py-0.5 font-display text-[9.5px] font-bold text-white">
                              <Check className="h-2.5 w-2.5" strokeWidth={3} />
                              Gagnant
                            </span>
                          )}
                        </div>
                        <span
                          className={cn(
                            "mt-0.5 block text-[11px] font-medium tabular-nums",
                            inCombo ? "text-white/75" : "text-dim"
                          )}
                        >
                          Tendance marché : {opt.sharePct}%
                        </span>
                      </div>

                      <div className="relative shrink-0">
                        {locked && !isWinner ? (
                          <Lock className="h-4 w-4 text-dim" />
                        ) : (
                          <span
                            className={cn(
                              "inline-flex min-w-[58px] justify-center rounded-lg px-2.5 py-1.5 font-display text-[13.5px] font-extrabold tabular-nums",
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

            {/* Vos paris sur cette prédiction */}
            {myQuestionBets.length > 0 && (
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-[14px] font-extrabold text-ink">
                    Vos paris sur cette question ({myQuestionBets.length})
                  </h3>
                  <Link
                    href="/paris"
                    className="font-display text-[12px] font-bold text-betclic-red"
                  >
                    Mes paris
                  </Link>
                </div>
                <div className="space-y-2.5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
                  {myQuestionBets.map((b) => (
                    <BetTicket
                      key={`${b.kind}-${b.id}`}
                      bet={b}
                      onShare={(ticket) => setShareBet(ticket)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      <PredictionBetModal
        question={question ?? null}
        selection={activeSelection}
        onClose={() => setActiveSelection(null)}
      />

      <ShareTicketModal bet={shareBet} onClose={() => setShareBet(null)} />
    </div>
  );
}
