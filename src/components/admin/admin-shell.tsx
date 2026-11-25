"use client";

/**
 * Shell admin : dérive l'onglet actif de l'URL (pathname) et rend le
 * composant correspondant. Chaque page admin a sa propre URL :
 * /admin/dashboard, /admin/matches, /admin/forecasts, /admin/ml,
 * /admin/questions, /admin/users, /admin/bets, /admin/deposits.
 * L'onglet « Réglages » est rendu par la page /admin/settings.
 */

import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Brain,
  CircleDollarSign,
  Eye,
  HelpCircle,
  SlidersHorizontal,
  Trophy,
  Ticket,
  Users,
  Loader2,
  RotateCcw,
  X,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";
import { useAdmin } from "./admin-provider";
import { useApp } from "@/components/providers";
import {
  AdminMonitoring,
} from "@/components/admin-monitoring";
import { PaymentIncidents } from "@/components/payment-incidents";
import { AdminDisputes } from "@/components/admin-disputes";
import {
  BettingLimitsForm,
  Dashboard,
  MatchesTab,
  QuestionsTab,
  UsersTab,
  BetsTab,
  DepositsTab,
  MlAdminTab,
  ScoresPrevusTab,
} from "./admin-tabs";
import { cn } from "@/lib/format";
import type { TabKey } from "./admin-shared";
import { SettingsTab } from "./settings-tab";

const NAV: { key: TabKey; label: string; href: string; Icon: typeof Trophy }[] = [
  { key: "dashboard", label: "Synthèse", href: "/admin/dashboard", Icon: BarChart3 },
  { key: "forecasts", label: "Scores prévus", href: "/admin/forecasts", Icon: Eye },
  { key: "matches", label: "Matchs", href: "/admin/matches", Icon: Trophy },
  { key: "ml", label: "IA & ML", href: "/admin/ml", Icon: Brain },
  { key: "questions", label: "Pronostics", href: "/admin/questions", Icon: HelpCircle },
  { key: "users", label: "Joueurs", href: "/admin/users", Icon: Users },
  { key: "bets", label: "Paris", href: "/admin/bets", Icon: Ticket },
  { key: "deposits", label: "Finance", href: "/admin/deposits", Icon: CircleDollarSign },
  { key: "settings", label: "Réglages", href: "/admin/settings", Icon: SlidersHorizontal },
];

function tabFromPathname(pathname: string): TabKey {
  const m = pathname.match(/^\/admin\/([a-z]+)/);
  if (m && NAV.some((n) => n.key === m[1])) return m[1] as TabKey;
  return "dashboard";
}

export function AdminShell() {
  const pathname = usePathname();
  const router = useRouter();
  const { panel, loading, busy, notice, setNotice, load, act, matchForm, setMatchForm, questionForm, setQuestionForm, balanceForm, setBalanceForm, stakeLimitForm, setStakeLimitForm, onAddMatch, onAddQuestion } =
    useAdmin();

  const tab = useMemo(() => tabFromPathname(pathname), [pathname]);

  // Synchronise l'onglet actif (adminTab) avec l'URL pour le header/sidebar.
  const { setAdminTab } = useApp();
  useEffect(() => {
    setAdminTab(tab);
  }, [tab, setAdminTab]);

  const goForecasts = () => router.push("/admin/forecasts");

  return (
    <div className="mx-auto w-full max-w-[1680px] px-2 pb-6 pt-3 lg:px-3.5 lg:py-4">
      {/* Barre d'onglets (sticky) */}
      <div className="sticky top-[48px] z-30 -mx-2 mt-2.5 border-b border-edge/70 bg-deep/95 px-2 py-1.5 backdrop-blur-md lg:hidden">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {NAV.map(({ key, label, href, Icon }) => (
            <Link
              key={key}
              href={href}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 font-display text-[10.5px] transition-colors",
                tab === key
                  ? "border-ink bg-ink font-medium text-white"
                  : "border-edge bg-white font-medium text-mist"
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
              <span>{label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* En-tête de page */}
      <div className="mt-3 flex items-center justify-between">
        <div>
          <h1 className="font-display text-[16px] font-bold leading-tight tracking-tight text-ink lg:text-[16px]">
            Administration
          </h1>
          <p className="text-[10.5px] text-mist lg:text-[11px]">
            Pilotage des matchs, pronostics et joueurs
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(false)}
          className="glass-card flex h-9 items-center gap-1.5 rounded-full px-3 text-[10.5px] font-medium text-ink hover:bg-elev/60 active:bg-elev"
        >
          <RotateCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} strokeWidth={2.3} />
          Actualiser
        </button>
      </div>

      {notice && (
        <div
          className={cn(
            "mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-medium",
            notice.kind === "ok"
              ? "border-win/30 bg-win/10 text-win"
              : "border-betclic-red/30 bg-betclic-red/8 text-betclic-red"
          )}
        >
          {notice.kind === "ok" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <X className="h-4 w-4 shrink-0" />
          )}
          <span className="flex-1">{notice.msg}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-current/70"
            aria-label="Fermer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {loading || !panel ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-dim" />
        </div>
      ) : (
        <div className="mt-3">
          {tab === "dashboard" && (
            <>
              <Dashboard stats={panel.stats} />
              <AdminMonitoring />
              <PaymentIncidents />
              <AdminDisputes />
              {panel.bettingLimits && (
                <BettingLimitsForm
                  key={JSON.stringify(panel.bettingLimits)}
                  limits={panel.bettingLimits}
                  busy={Boolean(busy.bettingLimits)}
                  act={act}
                />
              )}
            </>
          )}
          {tab === "forecasts" && (
            <ScoresPrevusTab
              matches={panel.matches}
              scenarioMode={panel.scenarioMode ?? "dynamic"}
              forecasts={panel.matchForecasts ?? {}}
              busy={busy}
              act={act}
            />
          )}
          {tab === "ml" && <MlAdminTab ml={panel.ml} busy={busy} act={act} />}
          {tab === "matches" && (
            <MatchesTab
              matches={panel.matches}
              forecasts={panel.matchForecasts ?? {}}
              realSettlementMode={panel.realSettlementMode ?? "auto"}
              onOpenForecasts={goForecasts}
              onReload={() => load(false)}
              busy={busy}
              act={act}
              form={matchForm}
              setForm={setMatchForm}
              onAdd={onAddMatch}
            />
          )}
          {tab === "questions" && (
            <QuestionsTab
              questions={panel.questions}
              busy={busy}
              act={act}
              form={questionForm}
              setForm={setQuestionForm}
              onAdd={onAddQuestion}
            />
          )}
          {tab === "users" && (
            <UsersTab
              users={panel.users}
              balanceForm={balanceForm}
              setBalanceForm={setBalanceForm}
              stakeLimitForm={stakeLimitForm}
              setStakeLimitForm={setStakeLimitForm}
              busy={busy}
              act={act}
            />
          )}
          {tab === "bets" && (
            <BetsTab
              bets={panel.bets}
              predBets={panel.predictionBets}
              comboBets={panel.comboBets ?? []}
            />
          )}
          {tab === "deposits" && (
            <DepositsTab
              deposits={panel.deposits}
              withdrawals={panel.withdrawals ?? []}
              busy={busy}
              act={act}
            />
          )}
          {tab === "settings" && <SettingsTab />}
        </div>
      )}
    </div>
  );
}
