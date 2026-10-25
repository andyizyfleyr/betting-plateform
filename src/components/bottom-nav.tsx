"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layers, SlidersHorizontal, Ticket, TrendingUp, Trophy } from "lucide-react";
import { useApp } from "./providers";
import { cn } from "@/lib/format";

const ITEMS = [
  { href: "/predictions", label: "Prédictions", Icon: TrendingUp },
  { href: "/matchs", label: "Matchs", Icon: Trophy },
  { href: "/betslip", label: "Betslip", Icon: Layers },
  { href: "/paris", label: "Mes paris", Icon: Ticket },
  { href: "/parametres", label: "Compte", Icon: SlidersHorizontal },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const { pendingCount, comboLegs, user, closeMarkets, closeBet, closeCombo } =
    useApp();
  const slipCount = comboLegs.length;

  if (
    user?.role === "admin" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/tap" ||
    pathname.startsWith("/tap/") ||
    pathname === "/accelerator" ||
    pathname.startsWith("/accelerator/")
  ) {
    return null;
  }

  return (
    <nav
      aria-label="Navigation principale mobile"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[480px] border-t border-edge bg-white/98 shadow-[0_-2px_10px_rgba(17,24,39,0.05)] backdrop-blur-md select-none sm:border-x lg:hidden"
    >
      <div
        className="pb-safe grid grid-cols-5"
        style={{
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        {ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const badgeCount =
            href === "/betslip"
              ? slipCount
              : href === "/paris"
                ? pendingCount
                : 0;

          return (
            <Link
              key={href}
              href={href}
              onClick={() => {
                closeMarkets();
                closeBet();
                closeCombo();
              }}
              aria-current={active ? "page" : undefined}
              className="relative flex min-h-[56px] min-w-0 touch-manipulation flex-col items-center justify-center gap-1 px-1 py-2 transition-colors active:bg-elev/60"
            >
              {active && (
                <span className="absolute inset-x-0 top-0 mx-auto h-[2.5px] w-7 rounded-b-full bg-betclic-red" />
              )}
              <span className="relative">
                <Icon
                  className={cn(
                    "h-[19px] w-[19px] transition-colors",
                    active ? "text-betclic-red" : "text-dim"
                  )}
                  strokeWidth={active ? 2.4 : 1.9}
                />
                {badgeCount > 0 && (
                  <span
                    className={cn(
                      "absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 font-display text-[9.5px] font-bold leading-none text-white",
                      href === "/betslip" ? "bg-betclic-red" : "bg-ink"
                    )}
                  >
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "max-w-full truncate font-display text-[10px] leading-none",
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
