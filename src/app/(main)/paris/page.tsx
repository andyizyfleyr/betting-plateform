"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Nfc, TicketX, RefreshCw } from "lucide-react";
import { api, type ClientBet } from "@/lib/api";
import { BetTicket } from "@/components/bet-ticket";
import { AnimatedNumber } from "@/components/animated-number";
import { useApp } from "@/components/providers";
import { cn, eur } from "@/lib/format";

type Tab = "ongoing" | "finished";

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

export default function ParisPage() {
  const { betsVersion, pendingCount, user, toast } = useApp();
  const [tab, setTab] = useState<Tab>("ongoing");
  const [kindFilter, setKindFilter] = useState<"all" | "sport" | "prediction">("all");
  const [bets, setBets] = useState<ClientBet[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const prevStatus = useRef<Map<number, string> | null>(null);
  const retryCountRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (isBackground = false) => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();

      try {
        if (!isBackground) setIsLoading(true);
        else setIsUpdating(true);

        const r = await api.allBets();
        retryCountRef.current = 0;
        const prev = prevStatus.current;
        if (prev) {
          for (const b of r.bets) {
            if (prev.get(b.id) !== "pending" || b.status === "pending") continue;
            if (b.status === "won")
              toast({
                kind: "success",
                title: "Pari gagné !",
                description: `+${eur(b.potentialWin)} crédités sur votre solde`,
              });
            else if (b.status === "lost")
              toast({
                kind: "info",
                title: "Pari perdu",
                description:
                  b.kind === "prediction"
                    ? `${b.question} · ${b.selectionLabel}`
                    : `${b.homeTeam} – ${b.awayTeam} · ${b.selectionLabel}`,
              });
          }
        }
        prevStatus.current = new Map(r.bets.map((b) => [b.id, b.status]));
        setBets(r.bets);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;

        if (retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current++;
          await new Promise(r => setTimeout(r, RETRY_DELAY * retryCountRef.current));
          return load(isBackground);
        }

        if (!isBackground) setBets([]);
      } finally {
        if (!isBackground) setIsLoading(false);
        else setIsUpdating(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    load();
  }, [load, betsVersion]);

  useEffect(() => {
    const id = setInterval(() => load(true), POLL_INTERVAL);
    return () => {
      clearInterval(id);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [load]);

  const filtered = useMemo(() => {
    const all = bets ?? [];
    if (kindFilter === "all") return all;
    return all.filter((b) => b.kind === kindFilter);
  }, [bets, kindFilter]);

  const ongoing = useMemo(() => filtered.filter((b) => b.status === "pending"), [filtered]);
  const finished = useMemo(() => filtered.filter((b) => b.status !== "pending"), [filtered]);

  const staked = ongoing.reduce((s, b) => s + b.stake, 0);
  const potential = ongoing.reduce((s, b) => s + b.potentialWin, 0);
  const wins = finished.filter((b) => b.status === "won").length;
  const settled = finished.filter((b) => b.status === "won" || b.status === "lost").length;
  const winRate = settled ? Math.round((wins / settled) * 100) : 0;

  const perf = useMemo(() => {
    const asc = [...finished].sort(
      (a, b) => new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime()
    );
    let cum = 0;
    return asc.map((b) => {
      if (b.status === "won") cum += b.potentialWin - b.stake;
      else if (b.status === "lost") cum -= b.stake;
      else cum += (b.cashOutAmount ?? b.stake) - b.stake;
      return cum;
    });
  }, [finished]);

  const finishedGroups = useMemo(() => {
    const map = new Map<string, ClientBet[]>();
    for (const b of finished) {
      const key = dayLabel(b.placedAt);
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return [...map.entries()];
  }, [finished]);

  return (
    <div className="px-3 pb-24 pt-5">
      {/* Titre */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.24em] text-betclic-red">PORTEFEUILLE</p>
          <h1 className="mt-1 font-display text-[30px] font-bold leading-none tracking-tight">
            Mes paris
          </h1>
        </div>
        {pendingCount > 0 && (
          <span className="rounded-lg bg-betclic-red px-2.5 py-1.5 font-display text-[11px] font-bold text-white flex items-center gap-1.5">
            {pendingCount} en cours
            {isUpdating && (
              <RefreshCw className="h-3 w-3 animate-spin" strokeWidth={2.5} />
            )}
          </span>
        )}
      </div>

      {/* Carte bankroll */}
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="relative mt-4 overflow-hidden rounded-[22px] border border-betclic-red/20 bg-[linear-gradient(135deg,#fef2f2,#fff5f5_55%,#f5f5f5)] p-4"
      >
        <div aria-hidden className="bg-texture pointer-events-none absolute inset-0" />
        <div
          aria-hidden
          className="breathe pointer-events-none absolute -right-12 -top-14 h-44 w-44 rounded-full"
          style={{ background: "radial-gradient(closest-side, rgba(225,0,20,0.14), transparent)" }}
        />
        <div className="relative flex items-center justify-between">
          <Nfc className="h-5 w-5 rotate-90 text-mist" strokeWidth={1.8} />
          <p className="font-display text-[9px] font-bold tracking-[0.3em] text-mist">PULSE PAY</p>
        </div>
        <div className="relative mt-4 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-semibold tracking-[0.26em] text-mist">SOLDE DISPONIBLE</p>
            <AnimatedNumber
              value={user?.balance ?? 0}
              format={eur}
              className="mt-1 block font-display text-[34px] font-bold leading-none tabular-nums tracking-tight"
            />
          </div>
          {perf.length >= 2 && (
            <div className="w-[104px] shrink-0">
              <Sparkline values={[0, ...perf]} up={perf[perf.length - 1] >= 0} />
              <p
                className={cn(
                  "mt-1 text-right font-display text-[11px] font-bold tabular-nums",
                  perf[perf.length - 1] >= 0 ? "text-betclic-red" : "text-betclic-red"
                )}
              >
                {perf[perf.length - 1] >= 0 ? "+" : "−"}{eur(Math.abs(perf[perf.length - 1]))}
              </p>
            </div>
          )}
        </div>
        <p className="relative mt-3 font-display text-[11px] tracking-[0.3em] text-dim">
          •••• •••• •••• 5067
        </p>
      </motion.section>

      {/* Statistiques */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.08 }}
        className="mt-2.5 grid grid-cols-3 gap-2"
      >
        <MiniStat label="Engagé" value={eur(staked)} />
        <MiniStat label="À gagner" value={eur(potential)} accent />
        <MiniStat label="Réussite" value={settled ? `${winRate}%` : "—"} />
      </motion.div>

      {/* Filtres type de pari */}
      <div className="mt-4 flex gap-1.5 overflow-x-auto no-scrollbar">
        {[
          { key: "all", label: "Tous" },
          { key: "sport", label: "Sport" },
          { key: "prediction", label: "Pronostics" },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setKindFilter(key as "all" | "sport" | "prediction")}
            className={cn(
              "rounded-full border px-3.5 py-1.5 font-display text-[11.5px] transition-colors",
              kindFilter === key
                ? "border-betclic-red bg-betclic-red text-white"
                : "border-edge bg-white text-mist"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Onglets soulignés */}
      <div className="mt-5 flex border-b border-edge">
        {(
          [
            { key: "ongoing", label: `En cours${pendingCount ? ` · ${pendingCount}` : ""}` },
            { key: "finished", label: "Terminés" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="relative flex-1 pb-2.5 text-center transition-colors"
            style={{ WebkitTapHighlightColor: "transparent" }}
          >
            <span
              className={cn(
                "font-display text-[13px]",
                tab === key ? "font-bold text-ink" : "font-medium text-mist"
              )}
            >
              {label}
            </span>
            {tab === key && (
              <motion.span
                layoutId="tab-underline"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
                className="absolute inset-x-10 -bottom-px h-[2.5px] rounded-full bg-betclic-red shadow-[0_4px_14px_rgba(225,0,20,0.5)]"
              />
            )}
          </button>
        ))}
      </div>

      {/* Liste */}
      {bets === null ? (
        <div className="mt-4 flex flex-col gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="shimmer h-[220px] rounded-[20px]" />
          ))}
        </div>
      ) : (tab === "ongoing" ? ongoing : finished).length === 0 ? (
        <AnimatePresence mode="wait">
          <motion.div
            key={`empty-${tab}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-14 flex flex-col items-center text-center"
          >
            <div className="glass-card grid h-20 w-20 place-items-center rounded-full text-dim">
              <TicketX className="h-8 w-8" strokeWidth={1.6} />
            </div>
            <p className="mt-5 font-display text-lg font-bold">
              {tab === "ongoing" ? "Aucun pari en cours" : "Aucun pari terminé"}
            </p>
             <p className="mt-1.5 max-w-[230px] text-[13px] leading-relaxed text-dim">
               {tab === "ongoing"
                 ? "Explorez les prédictions et placez votre premier pari."
                 : "Vos tickets gagnés et perdus apparaîtront ici."}
             </p>
             <Link
               href="/predictions"
               className="mt-6 flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,#E10014,#FB6962)] px-5 py-3 font-display text-[13px] font-bold text-white shadow-[0_10px_30px_-10px_rgba(225,0,20,0.55)] transition-transform active:scale-95"
             >
               Explorer les prédictions
               <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
             </Link>
          </motion.div>
        </AnimatePresence>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="mt-4"
          >
            {tab === "ongoing" ? (
              <div className="flex flex-col gap-3">
                {ongoing.map((b, i) => (
                  <BetTicket key={b.id} bet={b} index={i} />
                ))}
              </div>
            ) : (
              finishedGroups.map(([label, group]) => (
                <div key={label} className="mb-5">
                  <p className="mb-2.5 px-1 text-[11px] font-semibold capitalize tracking-wide text-mist">
                    {label}
                    <span className="ml-2 font-display text-[10px] font-bold text-dim">
                      {group.length}
                    </span>
                  </p>
                  <div className="flex flex-col gap-3">
                    {group.map((b, i) => (
                      <BetTicket key={b.id} bet={b} index={i} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </motion.div>
        </AnimatePresence>
      )}

      <p className="mt-8 text-center text-[10px] leading-relaxed text-dim">
        Cash-out disponible sur les paris en direct · 18+ · Jeu responsable.
      </p>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="glass-card rounded-2xl px-3 py-2.5 text-center">
      <p
        className={cn(
          "truncate font-display text-[13px] font-bold tabular-nums",
          accent ? "text-betclic-red" : "text-ink"
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[8.5px] font-semibold tracking-[0.2em] text-dim">
        {label.toUpperCase()}
      </p>
    </div>
  );
}

/** Courbe de performance avec remplissage dégradé. */
function Sparkline({ values, up }: { values: number[]; up: boolean }) {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;
  const coords = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 29 - ((v - min) / range) * 26;
    return [x, y] as const;
  });
  const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const color = up ? "var(--color-betclic-red)" : "var(--color-live)";
  const gid = up ? "spark-up" : "spark-down";
  const stop = up ? "225,0,20" : "255,77,94";

  return (
    <svg viewBox="0 0 100 32" className="h-9 w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`rgba(${stop},0.3)`} />
          <stop offset="100%" stopColor={`rgba(${stop},0)`} />
        </linearGradient>
      </defs>
      <polygon points={`0,32 ${line} 100,32`} fill={`url(#${gid})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
