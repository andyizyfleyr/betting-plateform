"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, LogOut, Plus, ShieldCheck, User } from "lucide-react";
import { api } from "@/lib/api";
import { cn, eur, initials } from "@/lib/format";
import { AnimatedNumber } from "./animated-number";
import { PulseLogo } from "./pulse-logo";
import { useApp, useFeedMatches, type AdminTabKey } from "./providers";

const ADMIN_TAB_TITLES: Record<AdminTabKey, string> = {
  dashboard: "Synthèse globale",
  matches: "Pilotage des matchs réels & virtuels",
  forecasts: "Scores prévus du simulateur",
  questions: "Gestion des pronostics",
  bets: "Suivi des coupons & paris",
  deposits: "Trésorerie · Dépôts & Retraits",
  users: "Comptes joueurs",
  ml: "Intelligence artificielle & Modèles",
};

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    authReady,
    balance,
    user,
    applyUser,
    clearCombo,
    openRecharge,
    sportStatusFilter,
    setSportStatusFilter,
    setSportLeagueFilter,
    pendingCount,
    adminTab,
    toast,
  } = useApp();
  const [loggingOut, setLoggingOut] = useState(false);

  const isAdminShell =
    user?.role === "admin" || pathname === "/admin" || pathname.startsWith("/admin/");

  const handleAdminLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api.auth.logout();
      clearCombo();
      applyUser(null);
      router.replace("/auth");
    } catch {
      toast({ kind: "error", title: "Impossible de se déconnecter" });
    } finally {
      setLoggingOut(false);
    }
  };

  if (isAdminShell) {
    return (
      <header className="pt-safe sticky top-0 z-30 border-b border-edge bg-white/95 backdrop-blur-md">
        {/* Barre mobile (< lg) */}
        <div className="flex h-[52px] items-center justify-between px-4 lg:hidden">
          <Link href="/admin" className="flex items-center gap-2 active:opacity-80">
            <PulseLogo size="sm" variant="light" />
            <span className="inline-flex items-center gap-1 rounded-full bg-betclic-red/10 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wide text-betclic-red">
              <ShieldCheck className="h-3 w-3" strokeWidth={2.4} />
              Admin
            </span>
          </Link>

          <div className="flex items-center gap-2">
            {user?.name && (
              <span className="max-w-[110px] truncate text-[12px] font-semibold text-mist">
                {user.name}
              </span>
            )}
            <button
              type="button"
              onClick={handleAdminLogout}
              disabled={loggingOut}
              aria-label="Se déconnecter"
              className="flex h-8.5 items-center gap-1.5 rounded-full border border-edge bg-elev px-3 font-display text-[12px] font-semibold text-ink transition-colors active:bg-edge/70 disabled:opacity-60"
            >
              {loggingOut ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-dim" strokeWidth={2.3} />
              ) : (
                <LogOut className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.2} />
              )}
              <span>Déconnexion</span>
            </button>
          </div>
        </div>

        {/* Barre desktop (lg+) */}
        <div className="hidden h-[60px] items-center justify-between px-8 lg:flex">
          <div className="min-w-0">
            <p className="truncate font-display text-[16px] font-bold tracking-tight text-ink">
              {ADMIN_TAB_TITLES[adminTab] ?? "Administration"}
            </p>
            <p className="truncate text-[11.5px] text-mist">
              Synchronisation temps réel · Espace strictement réservé à l&apos;administrateur
            </p>
          </div>

          <div className="flex items-center gap-3">
            {user?.name && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-elev px-3 py-1 text-[12px] font-semibold text-ink">
                <ShieldCheck className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.3} />
                {user.name}
              </span>
            )}
            <button
              type="button"
              onClick={handleAdminLogout}
              disabled={loggingOut}
              className="flex h-9 items-center gap-1.5 rounded-full border border-edge bg-white px-3.5 font-display text-[12px] font-semibold text-ink transition-colors hover:bg-elev disabled:opacity-60"
            >
              {loggingOut ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-dim" strokeWidth={2.3} />
              ) : (
                <LogOut className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.2} />
              )}
              <span>Déconnexion</span>
            </button>
          </div>
        </div>
      </header>
    );
  }

  const isOnMatchs = pathname === "/matchs" || pathname.startsWith("/matchs/");
  const isSportActive = isOnMatchs && sportStatusFilter !== "live";
  const isLiveActive = isOnMatchs && sportStatusFilter === "live";
  const isPredictionsActive =
    pathname === "/predictions" || pathname.startsWith("/predictions/");
  const isParisActive = pathname === "/paris" || pathname.startsWith("/paris/");
  const isResultatsActive =
    pathname === "/resultats" || pathname.startsWith("/resultats/");
  const isJeuxActive =
    pathname === "/jeux" ||
    pathname.startsWith("/jeux/") ||
    pathname === "/accelerator" ||
    pathname.startsWith("/accelerator/");
  const isCompteActive =
    pathname === "/parametres" || pathname.startsWith("/parametres/");

  return (
    <header className="pt-safe sticky top-0 z-30 border-b border-edge bg-white/95 backdrop-blur-md lg:border-b-0 lg:bg-betclic-red lg:shadow-xs lg:backdrop-blur-none">
      {/* Barre mobile (< lg) : Logo -> /matchs + Solde */}
      <div className="flex h-[52px] items-center justify-between px-4 lg:hidden">
        <Link
          href="/matchs"
          onClick={() => {
            setSportStatusFilter("all");
            setSportLeagueFilter("all");
          }}
          className="flex items-center gap-2 active:opacity-80"
        >
          <PulseLogo size="sm" variant="light" />
        </Link>

        <div className="flex items-center gap-2">
          {user ? (
            <button
              type="button"
              onClick={openRecharge}
              aria-label="Solde et rechargement"
              className="flex h-9 items-center gap-2 rounded-full border border-edge bg-elev pl-3 pr-1.5 transition-transform active:scale-[0.98]"
            >
              <AnimatedNumber
                value={balance}
                format={eur}
                className="font-display text-[13px] font-bold tabular-nums text-ink"
              />
              <span className="grid h-6 w-6 place-items-center rounded-full bg-betclic-red text-white">
                <Plus className="h-3.5 w-3.5" strokeWidth={2.8} />
              </span>
            </button>
          ) : !authReady ? (
            <div
              aria-hidden="true"
              className="flex h-9 w-[108px] items-center justify-between rounded-full border border-edge bg-elev pl-3 pr-1.5"
            >
              <span className="h-3 w-14 animate-pulse rounded-full bg-ink/15" />
              <span className="grid h-6 w-6 place-items-center rounded-full bg-betclic-red text-white">
                <Plus className="h-3.5 w-3.5" strokeWidth={2.8} />
              </span>
            </div>
          ) : (
            <Link
              href="/auth"
              className="flex h-9 items-center rounded-full bg-betclic-red px-3.5 font-display text-[12.5px] font-bold text-white active:opacity-90"
            >
              Connexion
            </Link>
          )}
        </div>
      </div>

      {/* Barre de navigation supérieure desktop pleine largeur (lg+) */}
      <div className="mx-auto hidden h-[58px] w-full max-w-[1480px] items-center justify-between gap-6 px-5 lg:flex">
        {/* Marque Pulse Bet + Navigation horizontale */}
        <div className="flex min-w-0 items-center gap-7">
          <Link
            href="/matchs"
            onClick={() => {
              setSportStatusFilter("all");
              setSportLeagueFilter("all");
            }}
            className="flex shrink-0 items-center gap-2 text-white transition-opacity hover:opacity-90"
          >
            <PulseLogo size="lg" variant="onRed" />
          </Link>

          <nav aria-label="Navigation principale" className="flex items-center gap-1.5">
            <Link
              href="/matchs"
              onClick={() => setSportStatusFilter("all")}
              className={cn(
                "relative inline-flex h-9 items-center rounded-full px-3.5 font-display text-[13.5px] font-bold transition-colors",
                isSportActive
                  ? "bg-white/18 text-white"
                  : "text-white/88 hover:bg-white/10 hover:text-white"
              )}
            >
              Sport
            </Link>

            <Link
              href="/matchs"
              onClick={() => {
                setSportStatusFilter("live");
                setSportLeagueFilter("all");
              }}
              className={cn(
                "relative inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 font-display text-[13.5px] font-bold transition-colors",
                isLiveActive
                  ? "bg-white/18 text-white"
                  : "text-white/88 hover:bg-white/10 hover:text-white"
              )}
            >
              <span>Live</span>
              <DesktopLiveCountBadge />
            </Link>

            <Link
              href="/predictions"
              className={cn(
                "relative inline-flex h-9 items-center rounded-full px-3.5 font-display text-[13.5px] font-bold transition-colors",
                isPredictionsActive
                  ? "bg-white/18 text-white"
                  : "text-white/88 hover:bg-white/10 hover:text-white"
              )}
            >
              Prédictions
            </Link>

            <Link
              href="/paris"
              className={cn(
                "relative inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 font-display text-[13.5px] font-bold transition-colors",
                isParisActive
                  ? "bg-white/18 text-white"
                  : "text-white/88 hover:bg-white/10 hover:text-white"
              )}
            >
              <span>Mes paris</span>
              {pendingCount > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-ink px-1.5 font-display text-[10.5px] font-extrabold tabular-nums text-white">
                  {pendingCount}
                </span>
              )}
            </Link>

            <Link
              href="/resultats"
              className={cn(
                "relative inline-flex h-9 items-center rounded-full px-3.5 font-display text-[13.5px] font-bold transition-colors",
                isResultatsActive
                  ? "bg-white/18 text-white"
                  : "text-white/88 hover:bg-white/10 hover:text-white"
              )}
            >
              Résultats
            </Link>

            <Link
              href="/jeux"
              className={cn(
                "relative inline-flex h-9 items-center rounded-full px-3.5 font-display text-[13.5px] font-bold transition-colors",
                isJeuxActive
                  ? "bg-white/18 text-white"
                  : "text-white/88 hover:bg-white/10 hover:text-white"
              )}
            >
              Mini-jeux
            </Link>
          </nav>
        </div>

        {/* Actions utilisateur à droite */}
        <div className="flex shrink-0 items-center gap-2.5">
          {user ? (
            <>
              <button
                type="button"
                onClick={openRecharge}
                aria-label="Solde et dépôt"
                className="flex h-9.5 items-center gap-2.5 rounded-full bg-white pl-3.5 pr-1.5 text-ink shadow-xs transition-transform hover:scale-[1.01] active:scale-[0.99]"
              >
                <AnimatedNumber
                  value={balance}
                  format={eur}
                  className="font-display text-[13.5px] font-bold tabular-nums text-ink"
                />
                <span className="inline-flex h-7 items-center gap-1 rounded-full bg-betclic-red px-2.5 font-display text-[11px] font-bold text-white">
                  <Plus className="h-3 w-3" strokeWidth={2.8} />
                  Dépôt
                </span>
              </button>

              <Link
                href="/parametres"
                className={cn(
                  "inline-flex h-9.5 items-center gap-2 rounded-full border px-3 font-display text-[12.5px] font-bold text-white transition-colors",
                  isCompteActive
                    ? "border-white bg-white/20"
                    : "border-white/40 bg-white/10 hover:bg-white/18"
                )}
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-white/20 font-display text-[10.5px] font-extrabold text-white">
                  {user.name ? initials(user.name) : <User className="h-3.5 w-3.5" />}
                </span>
                <span className="max-w-[110px] truncate">{user.name || "Compte"}</span>
              </Link>
            </>
          ) : !authReady ? (
            <div className="flex items-center gap-2.5" aria-hidden="true">
              <div className="flex h-9.5 w-[170px] items-center justify-between rounded-full bg-white pl-3.5 pr-1.5 shadow-xs">
                <span className="h-3.5 w-16 animate-pulse rounded-full bg-ink/15" />
                <span className="inline-flex h-7 items-center gap-1 rounded-full bg-betclic-red px-2.5 font-display text-[11px] font-bold text-white">
                  <Plus className="h-3 w-3" strokeWidth={2.8} />
                  Dépôt
                </span>
              </div>
              <div className="inline-flex h-9.5 w-[112px] items-center gap-2 rounded-full border border-white/40 bg-white/10 px-3">
                <span className="h-6 w-6 animate-pulse rounded-full bg-white/25" />
                <span className="h-3 w-12 animate-pulse rounded-full bg-white/25" />
              </div>
            </div>
          ) : (
            <>
              <Link
                href="/auth?mode=register"
                className="inline-flex h-9 items-center rounded-full bg-white px-4 font-display text-[13px] font-bold text-ink shadow-xs transition-opacity hover:opacity-95"
              >
                Inscription
              </Link>
              <Link
                href="/auth"
                className="inline-flex h-9 items-center rounded-full border border-white/55 bg-white/10 px-4 font-display text-[13px] font-bold text-white transition-colors hover:bg-white/18"
              >
                Connexion
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function DesktopLiveCountBadge() {
  const feedMatches = useFeedMatches();
  const liveMatchesCount = useMemo(
    () => (feedMatches ?? []).filter((m) => m.status === "live").length,
    [feedMatches]
  );
  if (liveMatchesCount <= 0) return null;
  return (
    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-ink px-1.5 font-display text-[10.5px] font-extrabold tabular-nums text-white">
      {liveMatchesCount}
    </span>
  );
}
