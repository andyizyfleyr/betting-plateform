"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Brain,
  CircleDollarSign,
  Eye,
  Flame,
  Gauge,
  HelpCircle,
  History,
  Layers,
  Loader2,
  LogOut,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Ticket,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { computeComboQuote } from "@/lib/combo-math";
import { cn, eur, formatOdds, initials, teamHue } from "@/lib/format";
import { AnimatedNumber } from "./animated-number";
import { PulseLogo } from "./pulse-logo";
import { useApp, useFeedMatches, type AdminTabKey } from "./providers";
import { Toggle } from "./toggle";

const USER_PRIMARY_NAV = [
  { href: "/predictions", label: "Prédictions", Icon: TrendingUp },
  { href: "/matchs", label: "Matchs", Icon: Trophy },
  { href: "/betslip", label: "Coupon de pari", Icon: Layers },
  { href: "/paris", label: "Mes paris", Icon: Ticket },
  { href: "/resultats", label: "Résultats", Icon: History },
] as const;

const USER_SECONDARY_NAV = [
  { href: "/jeux", label: "Casino & Mini-jeux", Icon: Flame },
  { href: "/accelerator", label: "Accelerator Pro", Icon: Gauge },
  { href: "/parametres", label: "Compte & Portefeuille", Icon: SlidersHorizontal },
] as const;

const ADMIN_NAV: { key: AdminTabKey; label: string; Icon: typeof Trophy }[] = [
  { key: "dashboard", label: "Synthèse", Icon: BarChart3 },
  { key: "matches", label: "Matchs", Icon: Trophy },
  { key: "forecasts", label: "Scores prévus", Icon: Eye },
  { key: "questions", label: "Pronostics", Icon: HelpCircle },
  { key: "bets", label: "Paris", Icon: Ticket },
  { key: "deposits", label: "Finance", Icon: CircleDollarSign },
  { key: "users", label: "Joueurs", Icon: Users },
  { key: "ml", label: "IA & ML", Icon: Brain },
];

export function DesktopSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    user,
    balance,
    oddsFormat,
    applyUser,
    clearCombo,
    openRecharge,
    comboLegs,
    comboQuickMode,
    setComboQuickMode,
    pendingCount,
    adminTab,
    setAdminTab,
    adminPendingFinance,
    toast,
  } = useApp();
  const feedMatches = useFeedMatches();

  const [loggingOut, setLoggingOut] = useState(false);

  const isAdminMode =
    user?.role === "admin" || pathname === "/admin" || pathname.startsWith("/admin/");

  const handleLogout = async () => {
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

  if (isAdminMode) {
    return (
      <aside className="sticky top-0 z-40 hidden h-dvh w-[264px] shrink-0 flex-col border-r border-edge bg-white select-none lg:flex">
        {/* En-tête marque Admin */}
        <div className="flex h-[60px] items-center justify-between border-b border-edge px-5">
          <Link href="/admin" className="flex items-center gap-2.5">
            <PulseLogo size="sm" variant="light" subtitle="Console opérateur" />
            <span className="inline-flex items-center gap-1 rounded-full bg-betclic-red/10 px-2 py-0.5 font-display text-[9.5px] font-bold uppercase tracking-wide text-betclic-red">
              <ShieldCheck className="h-2.5 w-2.5" strokeWidth={2.5} />
              Admin
            </span>
          </Link>
        </div>

        {/* Navigation verticale d'administration (strictement isolée de l'espace joueur) */}
        <div className="no-scrollbar flex-1 overflow-y-auto px-3.5 py-4">
          <p className="px-2.5 font-display text-[10.5px] font-bold uppercase tracking-wider text-dim">
            Pilotage plateforme
          </p>
          <nav className="mt-2 flex flex-col gap-1" aria-label="Navigation administration">
            {ADMIN_NAV.map(({ key, label, Icon }) => {
              const active = pathname.startsWith("/admin") && adminTab === key;
              const badge = key === "deposits" ? adminPendingFinance : 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setAdminTab(key);
                    if (!pathname.startsWith("/admin")) {
                      router.push("/admin");
                    }
                  }}
                  className={cn(
                    "group flex h-10 w-full items-center justify-between rounded-xl px-3 text-left transition-colors",
                    active
                      ? "bg-betclic-red text-white shadow-[0_2px_8px_rgba(225,0,20,0.22)]"
                      : "text-mist hover:bg-elev hover:text-ink"
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon
                      className={cn(
                        "h-[17px] w-[17px] shrink-0 transition-colors",
                        active ? "text-white" : "text-dim group-hover:text-ink"
                      )}
                      strokeWidth={active ? 2.35 : 2}
                    />
                    <span
                      className={cn(
                        "font-display text-[13px]",
                        active ? "font-bold" : "font-semibold"
                      )}
                    >
                      {label}
                    </span>
                  </span>
                  {badge > 0 && (
                    <span
                      className={cn(
                        "grid h-5 min-w-5 place-items-center rounded-full px-1.5 font-display text-[10.5px] font-bold leading-none",
                        active ? "bg-white text-betclic-red" : "bg-betclic-red text-white"
                      )}
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Pied de barre latérale Admin */}
        <div className="border-t border-edge p-3.5 space-y-2.5">
          {user && (
            <div className="flex items-center gap-2.5 rounded-xl bg-elev/70 px-3 py-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink font-display text-[11.5px] font-bold text-white">
                {initials(user.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[12.5px] font-bold text-ink">
                  {user.name}
                </p>
                <p className="truncate text-[10.5px] text-dim">{user.email}</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex h-9.5 w-full items-center justify-center gap-2 rounded-xl border border-edge bg-white font-display text-[12.5px] font-semibold text-ink transition-colors hover:bg-elev disabled:opacity-60"
          >
            {loggingOut ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-dim" />
            ) : (
              <LogOut className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.2} />
            )}
            <span>Déconnexion</span>
          </button>
        </div>
      </aside>
    );
  }

  const slipCount = comboLegs.length;
  const liveMatchesCount = (feedMatches ?? []).filter((m) => m.status === "live").length;
  const comboQuote =
    slipCount > 0
      ? computeComboQuote(
          comboLegs.map((l) => l.odds),
          10
        )
      : null;
  const userHue = teamHue(user?.name ?? "Pulse");

  return (
    <aside className="sticky top-0 z-40 hidden h-dvh w-[264px] shrink-0 flex-col border-r border-edge bg-white select-none lg:flex">
      {/* En-tête marque */}
      <div className="flex h-[60px] items-center justify-between border-b border-edge px-5">
        <Link href="/predictions" className="flex items-center gap-2.5">
          <PulseLogo size="sm" variant="light" subtitle="Paris & Prédictions" />
        </Link>
      </div>

      {/* Bloc Portefeuille rapide */}
      <div className="border-b border-edge/80 p-3.5">
        {user ? (
          <div className="rounded-2xl border border-edge bg-elev/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-dim">
                <Wallet className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.2} />
                Solde disponible
              </span>
              <Link
                href="/parametres"
                className="font-display text-[10.5px] font-bold text-mist hover:text-ink"
              >
                Portefeuille →
              </Link>
            </div>
            <AnimatedNumber
              value={balance}
              format={eur}
              className="mt-1 block font-display text-[20px] font-bold leading-tight tabular-nums text-ink"
            />
            <button
              type="button"
              onClick={openRecharge}
              className="mt-2.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-betclic-red font-display text-[12px] font-bold text-white shadow-2xs transition-opacity hover:opacity-95 active:scale-[0.99]"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
              Déposer des fonds
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-edge bg-elev/60 p-3">
            <p className="font-display text-[12.5px] font-bold text-ink">
              Rejoignez PULSE
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-mist">
              250,00 € crédités dès l&apos;inscription pour vos paris et prédictions.
            </p>
            <Link
              href="/auth"
              className="mt-2.5 flex h-9 w-full items-center justify-center rounded-xl bg-betclic-red font-display text-[12px] font-bold text-white transition-opacity hover:opacity-95"
            >
              Connexion / Inscription
            </Link>
          </div>
        )}
      </div>

      {/* Navigation principale & secondaire */}
      <div className="no-scrollbar flex-1 overflow-y-auto px-3.5 py-3.5 space-y-5">
        <div>
          <p className="px-2.5 font-display text-[10.5px] font-bold uppercase tracking-wider text-dim">
            Paris &amp; Direct
          </p>
          <nav className="mt-1.5 flex flex-col gap-1" aria-label="Navigation principale">
            {USER_PRIMARY_NAV.map(({ href, label, Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              const badgeCount =
                href === "/betslip"
                  ? slipCount
                  : href === "/paris"
                    ? pendingCount
                    : 0;
              const showLiveDot = href === "/matchs" && liveMatchesCount > 0;

              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex h-10 items-center justify-between rounded-xl px-3 transition-colors",
                    active
                      ? "bg-betclic-red text-white shadow-[0_2px_8px_rgba(225,0,20,0.22)]"
                      : "text-mist hover:bg-elev hover:text-ink"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Icon
                      className={cn(
                        "h-[17px] w-[17px] shrink-0 transition-colors",
                        active ? "text-white" : "text-dim group-hover:text-ink"
                      )}
                      strokeWidth={active ? 2.35 : 2}
                    />
                    <span
                      className={cn(
                        "truncate font-display text-[13px]",
                        active ? "font-bold" : "font-semibold"
                      )}
                    >
                      {label}
                    </span>
                  </span>

                  {href === "/betslip" && comboQuote ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <span
                        className={cn(
                          "rounded-md px-1.5 py-0.5 font-display text-[10px] font-bold tabular-nums",
                          active ? "bg-white/20 text-white" : "bg-elev text-ink"
                        )}
                      >
                        {formatOdds(comboQuote.totalOdds, oddsFormat)}
                      </span>
                      <span
                        className={cn(
                          "grid h-5 min-w-5 place-items-center rounded-full px-1 font-display text-[10px] font-bold leading-none",
                          active ? "bg-white text-betclic-red" : "bg-betclic-red text-white"
                        )}
                      >
                        {slipCount}
                      </span>
                    </span>
                  ) : badgeCount > 0 ? (
                    <span
                      className={cn(
                        "grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 font-display text-[10.5px] font-bold leading-none",
                        active ? "bg-white text-betclic-red" : "bg-ink text-white"
                      )}
                    >
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  ) : showLiveDot ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-display text-[10px] font-bold",
                        active
                          ? "bg-white/20 text-white"
                          : "bg-betclic-red/12 text-betclic-red"
                      )}
                    >
                      <span
                        className={cn(
                          "live-dot h-1.5 w-1.5 rounded-full",
                          active ? "bg-white" : "bg-betclic-red"
                        )}
                      />
                      {liveMatchesCount}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>

        <div>
          <p className="px-2.5 font-display text-[10.5px] font-bold uppercase tracking-wider text-dim">
            Mini-jeux &amp; Compte
          </p>
          <nav className="mt-1.5 flex flex-col gap-1" aria-label="Navigation secondaire">
            {USER_SECONDARY_NAV.map(({ href, label, Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex h-10 items-center justify-between rounded-xl px-3 transition-colors",
                    active
                      ? "bg-betclic-red text-white shadow-[0_2px_8px_rgba(225,0,20,0.22)]"
                      : "text-mist hover:bg-elev hover:text-ink"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Icon
                      className={cn(
                        "h-[17px] w-[17px] shrink-0 transition-colors",
                        active ? "text-white" : "text-dim group-hover:text-ink"
                      )}
                      strokeWidth={active ? 2.35 : 2}
                    />
                    <span
                      className={cn(
                        "truncate font-display text-[13px]",
                        active ? "font-bold" : "font-semibold"
                      )}
                    >
                      {label}
                    </span>
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Pied de barre latérale : Mode combiné 1-clic + profil */}
      <div className="border-t border-edge p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-2 rounded-xl border border-edge bg-elev/50 px-3 py-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1 font-display text-[11.5px] font-bold text-ink">
              <Zap className="h-3 w-3 text-betclic-red" strokeWidth={2.5} />
              Combiné 1-clic
            </p>
            <p className="truncate text-[10px] text-dim">
              Clic direct sur une cote = coupon
            </p>
          </div>
          <Toggle checked={comboQuickMode} onChange={setComboQuickMode} />
        </div>

        {user && (
          <Link
            href="/parametres"
            className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-elev"
          >
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl font-display text-[11.5px] font-bold text-white"
              style={{
                background: `linear-gradient(140deg, hsl(${userHue} 60% 44%), hsl(${(userHue + 36) % 360} 68% 30%))`,
              }}
            >
              {initials(user.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[12.5px] font-bold text-ink">
                {user.name}
              </p>
              <p className="truncate text-[10.5px] text-dim">
                Cotes {oddsFormat === "fractional" ? "fractionnaires" : "décimales"}
              </p>
            </div>
          </Link>
        )}
      </div>
    </aside>
  );
}
