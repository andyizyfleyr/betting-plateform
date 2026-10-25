"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { DesktopBetslipSidebar } from "@/components/desktop-betslip-sidebar";
import { DesktopLeaguesSidebar } from "@/components/desktop-leagues-sidebar";
import { DesktopSidebar } from "@/components/desktop-sidebar";
import { useApp } from "@/components/providers";

export function MainShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useApp();

  const isAdminShell =
    user?.role === "admin" || pathname === "/admin" || pathname.startsWith("/admin/");

  if (isAdminShell) {
    return (
      <div className="flex min-h-dvh w-full bg-deep lg:flex-row">
        <DesktopSidebar />
        <div className="flex min-h-dvh min-w-0 flex-1 flex-col pb-[78px] lg:pb-0">
          <AppHeader />
          <main className="flex-1">{children}</main>
          <BottomNav />
        </div>
      </div>
    );
  }

  const isBetslipRoute =
    pathname === "/betslip" || pathname.startsWith("/betslip/");

  return (
    <div className="flex min-h-dvh w-full flex-col bg-deep pb-[78px] lg:pb-0">
      <AppHeader />

      {/* Disposition 3 colonnes sur desktop (Ligues | Matchs / Contenu | Betslip), 1 colonne sur mobile */}
      <div
        className={
          isBetslipRoute
            ? "mx-auto flex w-full max-w-[1480px] flex-1 flex-col lg:grid lg:grid-cols-[264px_minmax(0,1fr)] lg:items-start lg:gap-5 lg:px-5 lg:py-5 xl:grid-cols-[280px_minmax(0,1fr)]"
            : "mx-auto flex w-full max-w-[1480px] flex-1 flex-col lg:grid lg:grid-cols-[264px_minmax(0,1fr)_336px] lg:items-start lg:gap-5 lg:px-5 lg:py-5 xl:grid-cols-[280px_minmax(0,1fr)_356px]"
        }
      >
        <DesktopLeaguesSidebar />
        <main className="min-w-0 flex-1">{children}</main>
        {!isBetslipRoute && <DesktopBetslipSidebar />}
      </div>

      <BottomNav />
    </div>
  );
}
