"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { SlidersHorizontal, Ticket, TrendingUp, Trophy } from "lucide-react";
import { useApp } from "./providers";
import { cn } from "@/lib/format";

const ITEMS = [
  { href: "/matchs", label: "Matchs", Icon: Trophy },
  { href: "/predictions", label: "Prédictions", Icon: TrendingUp },
  { href: "/paris", label: "Mes paris", Icon: Ticket },
  { href: "/parametres", label: "Réglages", Icon: SlidersHorizontal },
];

/** Barre attachée — indicateur betclic-red animé sur l'onglet actif. */
export function BottomNav() {
  const pathname = usePathname();
  const { pendingCount } = useApp();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[27.5rem]">
      <div className="relative flex border-t border-edge bg-white/95 pb-safe backdrop-blur-2xl">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="relative flex flex-1 flex-col items-center gap-1 pb-2.5 pt-3"
            >
              {active && (
                <motion.span
                  layoutId="nav-line"
                  transition={{ type: "spring", stiffness: 520, damping: 36 }}
                  className="absolute inset-x-0 top-0 mx-auto h-[3px] w-12 rounded-b-full bg-betclic-red shadow-[0_4px_14px_rgba(225,0,20,0.55)]"
                />
              )}
              <span className="relative">
                <Icon
                  className={cn(
                    "h-[19px] w-[19px] transition-colors duration-200",
                    active ? "text-betclic-red" : "text-mist"
                  )}
                  strokeWidth={active ? 2.4 : 2}
                />
                {href === "/paris" && pendingCount > 0 && (
                  <span className="absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-md bg-betclic-red px-1 font-display text-[9px] font-bold text-white">
                    {pendingCount}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "font-display text-[10px] tracking-wide transition-colors duration-200",
                  active ? "font-bold text-betclic-red" : "font-medium text-mist"
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
