"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { DesktopBetslipSidebar } from "@/components/desktop-betslip-sidebar";
import { DesktopLeaguesSidebar } from "@/components/desktop-leagues-sidebar";
import { DesktopSidebar } from "@/components/desktop-sidebar";
import { RouteWarmup } from "@/components/route-warmup";
import { useApp } from "@/components/providers";
import { cn } from "@/lib/format";

export function MainShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useApp();

  const isAdminShell =
    user?.role === "admin" || pathname === "/admin" || pathname.startsWith("/admin/");

  if (isAdminShell) {
    return (
      <div className="flex min-h-dvh w-full bg-deep lg:flex-row">
        <DesktopSidebar />
        <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
          <AppHeader />
          <main className="flex-1">{children}</main>
        </div>
      </div>
    );
  }

  const isBetslipRoute =
    pathname === "/betslip" || pathname.startsWith("/betslip/");
  const isFullscreenGame =
    pathname === "/tap" ||
    pathname.startsWith("/tap/") ||
    pathname === "/accelerator" ||
    pathname.startsWith("/accelerator/");

  return (
    <div className="flex min-h-dvh w-full flex-col bg-deep">
      <RouteWarmup />
      <AppHeader />

      {/* Disposition 3 colonnes sur desktop (Ligues | Matchs / Contenu | Betslip), 1 colonne sur mobile */}
      <div
        className={cn(
          "mx-auto flex w-full max-w-[1480px] flex-1 flex-col lg:grid lg:items-start lg:gap-5 lg:px-5 lg:py-5",
          isBetslipRoute
            ? "lg:grid-cols-[264px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]"
            : "lg:grid-cols-[264px_minmax(0,1fr)_336px] xl:grid-cols-[280px_minmax(0,1fr)_356px]"
        )}
      >
        <DesktopLeaguesSidebar />
        <main
          className={cn(
            "min-w-0 flex-1",
            !isFullscreenGame &&
              "pb-[calc(68px+env(safe-area-inset-bottom,0px))] lg:pb-0"
          )}
        >
          {children}
        </main>
        {!isBetslipRoute && <DesktopBetslipSidebar />}
      </div>
    </div>
  );
}
