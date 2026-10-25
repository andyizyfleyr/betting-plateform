"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Layers, Loader2, LogOut, Plus, ShieldCheck, Ticket, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { computeComboQuote } from "@/lib/combo-math";
import { eur, formatOdds } from "@/lib/format";
import { AnimatedNumber } from "./animated-number";
import { useApp, type AdminTabKey } from "./providers";

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

function resolveDesktopRouteMeta(pathname: string): { title: string; subtitle: string } {
  if (pathname.startsWith("/matchs")) {
    return { title: "Matchs & Direct", subtitle: "Cotes fixes 1xBet · Matchs réels et virtuels" };
  }
  if (pathname.startsWith("/predictions")) {
    return { title: "Prédictions", subtitle: "Questions à choix multiples et Oui / Non à cotes fixes" };
  }
  if (pathname.startsWith("/betslip")) {
    return { title: "Coupon de pari", subtitle: "Validation de pari simple ou combiné jusqu'à +20 % de bonus" };
  }
  if (pathname.startsWith("/paris")) {
    return { title: "Mes paris", subtitle: "Suivi en direct, vente de coupon et historique complet" };
  }
  if (pathname.startsWith("/resultats")) {
    return { title: "Résultats & Archives", subtitle: "Scores officiels, mi-temps, buteurs et statistiques" };
  }
  if (pathname.startsWith("/jeux")) {
    return { title: "Casino & Mini-jeux", subtitle: "Sessions instantanées reliées à votre solde" };
  }
  if (pathname.startsWith("/accelerator")) {
    return { title: "Accelerator Pro", subtitle: "Maintenez l'accélérateur et encaissez avant le crash" };
  }
  if (pathname.startsWith("/parametres")) {
    return { title: "Compte & Portefeuille", subtitle: "Dépôts, retraits, mouvements et préférences" };
  }
  return { title: "PULSE", subtitle: "Plateforme de paris sportifs et prédictions" };
}

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    balance,
    user,
    oddsFormat,
    applyUser,
    clearCombo,
    openRecharge,
    openCombo,
    comboLegs,
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
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-betclic-red text-white">
              <Zap className="h-4 w-4 fill-white" strokeWidth={2.2} />
            </span>
            <span className="font-display text-[17px] font-bold tracking-tight text-ink">
              PULSE
            </span>
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

  const routeMeta = resolveDesktopRouteMeta(pathname);
  const slipCount = comboLegs.length;
  const comboQuote =
    slipCount > 0
      ? computeComboQuote(
          comboLegs.map((l) => l.odds),
          10
        )
      : null;

  return (
    <header className="pt-safe sticky top-0 z-30 border-b border-edge bg-white/95 backdrop-blur-md">
      {/* Barre mobile (< lg) */}
      <div className="flex h-[52px] items-center justify-between px-4 lg:hidden">
        <Link href="/predictions" className="flex items-center gap-2 active:opacity-80">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-betclic-red text-white">
            <Zap className="h-4 w-4 fill-white" strokeWidth={2.2} />
          </span>
          <span className="font-display text-[17px] font-bold tracking-tight text-ink">
            PULSE
          </span>
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

      {/* Barre desktop (lg+) */}
      <div className="hidden h-[60px] items-center justify-between gap-4 px-8 lg:flex">
        <div className="min-w-0">
          <p className="truncate font-display text-[16px] font-bold tracking-tight text-ink">
            {routeMeta.title}
          </p>
          <p className="truncate text-[11.5px] text-mist">{routeMeta.subtitle}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {pendingCount > 0 && (
            <Link
              href="/paris"
              className="inline-flex h-9 items-center gap-2 rounded-full border border-edge bg-white px-3.5 font-display text-[12px] font-semibold text-ink transition-colors hover:bg-elev"
            >
              <Ticket className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.2} />
              <span>En cours</span>
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-ink px-1.5 text-[10.5px] font-bold text-white">
                {pendingCount}
              </span>
            </Link>
          )}

          {slipCount > 0 ? (
            <button
              type="button"
              onClick={openCombo}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-ink px-3.5 font-display text-[12px] font-bold text-white transition-opacity hover:opacity-95"
            >
              <Layers className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.3} />
              <span>Coupon ({slipCount})</span>
              {comboQuote && (
                <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] tabular-nums">
                  {formatOdds(comboQuote.totalOdds, oddsFormat)}
                </span>
              )}
            </button>
          ) : (
            <Link
              href="/betslip"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-edge bg-white px-3.5 font-display text-[12px] font-semibold text-mist transition-colors hover:bg-elev hover:text-ink"
            >
              <Layers className="h-3.5 w-3.5 text-dim" strokeWidth={2.1} />
              <span>Coupon</span>
            </Link>
          )}

          {user ? (
            <button
              type="button"
              onClick={openRecharge}
              aria-label="Solde et rechargement"
              className="flex h-9.5 items-center gap-2.5 rounded-full border border-edge bg-elev pl-3.5 pr-1.5 transition-colors hover:bg-edge/60"
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
          ) : (
            <Link
              href="/auth"
              className="flex h-9.5 items-center rounded-full bg-betclic-red px-4 font-display text-[12.5px] font-bold text-white transition-opacity hover:opacity-95"
            >
              Connexion
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
