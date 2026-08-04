"use client";

import Link from "next/link";
import { Gamepad2, Gauge, Ticket, Zap } from "lucide-react";
import { useApp } from "./providers";
import { AnimatedNumber } from "./animated-number";
import { eur } from "@/lib/format";

export function AppHeader() {
  const { balance, pendingCount } = useApp();

  return (
    <header className="sticky top-0 z-40 bg-ink/80 backdrop-blur-xl">
      <div className="flex h-12 items-center justify-between px-3.5">
        <Link href="/matchs" className="group flex items-center gap-2">
          <span className="relative grid h-7 w-7 rotate-45 place-items-center rounded-[7px] bg-lime shadow-[0_6px_20px_-4px_rgba(201,247,58,0.55)] transition-transform duration-300 group-active:scale-90 group-active:rotate-[135deg]">
            <Zap className="h-3.5 w-3.5 -rotate-45 fill-ink text-ink transition-transform duration-300 group-active:-rotate-[135deg]" strokeWidth={2.4} />
          </span>
          <span className="font-display text-[17px] font-bold tracking-tight text-white">
            PULSE
            <span className="ml-1 align-middle font-display text-[8px] font-bold tracking-[0.3em] text-lime">
              V5
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-1.5">
          <Link
            href="/tap"
            className="glass-pill grid h-8 w-8 place-items-center rounded-lg transition-transform active:scale-90"
            aria-label="Jeu Tap Win"
          >
            <Gamepad2 className="h-4 w-4 text-mist" strokeWidth={2} />
          </Link>

          <Link
            href="/accelerator"
            className="glass-pill grid h-8 w-8 place-items-center rounded-lg transition-transform active:scale-90"
            aria-label="Jeu Accelerator Pro"
          >
            <Gauge className="h-4 w-4 text-mist" strokeWidth={2} />
          </Link>

          <Link
            href="/paris"
            className="glass-pill relative grid h-8 w-8 place-items-center rounded-lg transition-transform active:scale-90"
            aria-label="Mes paris"
          >
            <Ticket className="h-4 w-4 text-mist" strokeWidth={2} />
            {pendingCount > 0 && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-md bg-lime px-1 font-display text-[9.5px] font-bold text-ink">
                {pendingCount}
              </span>
            )}
          </Link>

          <Link
            href="/parametres"
            className="glass-pill flex h-8 items-center gap-2 rounded-lg px-2.5 transition-transform active:scale-95"
            aria-label="Solde et réglages"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-lime shadow-[0_0_8px_rgba(201,247,58,0.9)]" />
            <AnimatedNumber
              value={balance}
              format={eur}
              className="font-display text-[12.5px] font-bold tabular-nums tracking-tight text-white"
            />
          </Link>
        </div>
      </div>
      <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
    </header>
  );
}
