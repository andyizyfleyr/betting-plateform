"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, ShieldCheck, Zap } from "lucide-react";
import { useApp } from "./providers";
import { AnimatedNumber } from "./animated-number";
import { cn, eur } from "@/lib/format";

export function AppHeader() {
  const pathname = usePathname();
  const { balance, user, openRecharge } = useApp();
  const isAdminActive = pathname === "/admin" || pathname.startsWith("/admin/");

  return (
    <header className="pt-safe sticky top-0 z-40 border-b border-edge bg-white/95 backdrop-blur-md">
      <div className="flex h-[52px] items-center justify-between px-4">
        <Link href="/predictions" className="flex items-center gap-2 active:opacity-80">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-betclic-red text-white">
            <Zap className="h-4 w-4 fill-white" strokeWidth={2.2} />
          </span>
          <span className="font-display text-[17px] font-bold tracking-tight text-ink">
            PULSE
          </span>
        </Link>

        <div className="flex items-center gap-2">
          {user?.role === "admin" && (
            <Link
              href="/admin"
              aria-label="Espace administrateur"
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-semibold transition-colors",
                isAdminActive
                  ? "border-betclic-red bg-betclic-red text-white"
                  : "border-edge bg-elev text-ink active:bg-edge/60"
              )}
            >
              <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2.2} />
              <span className="hidden xs:inline">Admin</span>
            </Link>
          )}

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
    </header>
  );
}
