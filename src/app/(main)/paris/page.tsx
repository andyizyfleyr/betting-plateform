"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus, TicketX } from "lucide-react";
import { api, type ClientBet } from "@/lib/api";
import { BetTicket } from "@/components/bet-ticket";
import { ShareTicketModal } from "@/components/share-ticket-modal";
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
  const { betsVersion, user, openRecharge } = useApp();
  const [tab, setTab] = useState<Tab>("ongoing");
  const [kindFilter, setKindFilter] = useState<"all" | "sport" | "prediction" | "combo">("all");
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

  const finishedGroups = useMemo(() => {
    const map = new Map<string, ClientBet[]>();
    for (const b of finished) {
      const key = dayLabel(b.placedAt);
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return [...map.entries()];
  }, [finished]);

  return (
    <div className="px-4 pb-8 pt-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
            Mes paris
          </h1>
          <p className="text-[12px] text-mist">Tickets en cours et historique</p>
        </div>
      </div>

      {/* Résumé portefeuille clair (sans fausse carte bancaire) */}
      <section className="glass-card mt-3 rounded-2xl p-3.5">
        <div className="flex items-center justify-between gap-2">
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
            className="flex h-9 items-center gap-1.5 rounded-xl bg-betclic-red px-3.5 font-display text-[12.5px] font-bold text-white active:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
            Recharger
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 divide-x divide-edge border-t border-edge pt-2.5 text-center">
          <div className="px-1">
            <p className="text-[10px] font-medium text-dim">En jeu</p>
            <p className="mt-0.5 font-display text-[13px] font-bold tabular-nums text-ink">
              {eur(staked)}
            </p>
          </div>
          <div className="px-1">
            <p className="text-[10px] font-medium text-dim">Gain potentiel</p>
            <p className="mt-0.5 font-display text-[13px] font-bold tabular-nums text-win">
              {eur(potential)}
            </p>
          </div>
          <div className="px-1">
            <p className="text-[10px] font-medium text-dim">Réussite</p>
            <p className="mt-0.5 font-display text-[13px] font-bold tabular-nums text-ink">
              {settled ? `${winRate}%` : "—"}
            </p>
          </div>
        </div>
      </section>

      {/* Onglets En cours / Terminés + filtre type */}
      <div className="sticky top-[52px] z-30 -mx-4 mt-3 border-b border-edge/70 bg-deep/95 px-4 py-2 backdrop-blur-md">
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-edge bg-white p-1">
          {(
            [
              { key: "ongoing", label: `En cours (${ongoing.length})` },
              { key: "finished", label: `Terminés (${finished.length})` },
            ] as const
          ).map(({ key, label }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "h-9 rounded-lg font-display text-[12px] transition-colors",
                  active ? "bg-ink font-bold text-white" : "font-medium text-mist"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
          {(
            [
              { key: "all", label: "Tous" },
              { key: "combo", label: "Combinés" },
              { key: "sport", label: "Sport" },
              { key: "prediction", label: "Prédictions" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setKindFilter(key)}
              className={cn(
                "h-7 shrink-0 rounded-full border px-3 text-[11.5px] font-medium transition-colors",
                kindFilter === key
                  ? "border-betclic-red bg-betclic-red font-semibold text-white"
                  : "border-edge bg-white text-mist"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Liste des tickets */}
      {bets === null ? (
        <div className="mt-3 flex flex-col gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="shimmer h-[168px] rounded-2xl" />
          ))}
        </div>
      ) : (tab === "ongoing" ? ongoing : finished).length === 0 ? (
        <div className="mt-12 flex flex-col items-center text-center">
          <div className="glass-card grid h-14 w-14 place-items-center rounded-full text-dim">
            <TicketX className="h-6 w-6" strokeWidth={1.8} />
          </div>
          <p className="mt-3 font-display text-[15.5px] font-bold text-ink">
            {tab === "ongoing" ? "Aucun pari en cours" : "Aucun pari terminé"}
          </p>
          <p className="mt-1 max-w-[240px] text-[12.5px] text-dim">
            {tab === "ongoing"
              ? "Choisissez une prédiction ou un match pour placer une mise."
              : "Vos paris réglés s'afficheront dans cet onglet."}
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
        <div className="mt-3">
          {tab === "ongoing" ? (
            <div className="flex flex-col gap-2.5">
              {ongoing.map((b) => (
                <BetTicket key={`${b.kind}-${b.id}`} bet={b} onShare={setSharingBet} />
              ))}
            </div>
          ) : (
            finishedGroups.map(([label, group]) => (
              <div key={label} className="mb-4 last:mb-0">
                <p className="mb-2 px-0.5 text-[11.5px] font-semibold capitalize text-mist">
                  {label}
                  <span className="ml-1.5 text-dim">({group.length})</span>
                </p>
                <div className="flex flex-col gap-2.5">
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
