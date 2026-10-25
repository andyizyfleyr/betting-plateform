"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SlidersHorizontal, Ticket, TrendingUp, Trophy } from "lucide-react";
import { useApp } from "./providers";
import { cn } from "@/lib/format";

const ITEMS = [
  { href: "/predictions", label: "Prédictions", Icon: TrendingUp },
  { href: "/matchs", label: "Matchs", Icon: Trophy },
  { href: "/paris", label: "Mes paris", Icon: Ticket },
  { href: "/parametres", label: "Compte", Icon: SlidersHorizontal },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const { pendingCount } = useApp();

  return (
    <nav className="sticky bottom-0 z-40 w-full border-t border-edge bg-white/98 backdrop-blur-md">
      <div
        className="pb-safe grid grid-cols-4"
        style={{
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        {ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className="relative flex min-h-[56px] flex-col items-center justify-center gap-1 py-2 transition-colors active:bg-elev/60"
            >
              {active && (
                <span className="absolute inset-x-0 top-0 mx-auto h-[2.5px] w-8 rounded-b-full bg-betclic-red" />
              )}
              <span className="relative">
                <Icon
                  className={cn(
                    "h-[20px] w-[20px] transition-colors",
                    active ? "text-betclic-red" : "text-dim"
                  )}
                  strokeWidth={active ? 2.4 : 1.9}
                />
                {href === "/paris" && pendingCount > 0 && (
                  <span className="absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-betclic-red px-1 font-display text-[9.5px] font-bold leading-none text-white">
                    {pendingCount > 99 ? "99+" : pendingCount}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "font-display text-[10.5px] leading-none",
                  active ? "font-bold text-betclic-red" : "font-medium text-dim"
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
