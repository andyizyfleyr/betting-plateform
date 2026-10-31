"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layers, SlidersHorizontal, Ticket, TrendingUp, Trophy } from "lucide-react";
import { useApp } from "./providers";
import { DEFAULT_LANGUAGE, translate } from "@/lib/i18n/catalog";
import { cn } from "@/lib/format";

const ITEMS = [
  { href: "/matchs", label: translate(DEFAULT_LANGUAGE, "matches"), Icon: Trophy },
  { href: "/predictions", label: translate(DEFAULT_LANGUAGE, "predictions"), Icon: TrendingUp },
  { href: "/betslip", label: translate(DEFAULT_LANGUAGE, "betslip"), Icon: Layers },
  { href: "/paris", label: translate(DEFAULT_LANGUAGE, "myBets"), Icon: Ticket },
  { href: "/parametres", label: translate(DEFAULT_LANGUAGE, "account"), Icon: SlidersHorizontal },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const { pendingCount, comboLegs, user, closeMarkets, closeBet, closeCombo } =
    useApp();
  const slipCount = comboLegs.length;

  if (
    user?.role === "admin" ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
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
      style={{
        bottom: 0,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[480px] border-t border-edge bg-white shadow-[0_-2px_10px_rgba(17,24,39,0.05)] select-none after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-24 after:bg-white sm:border-x lg:hidden"
    >
      <div className="grid grid-cols-5">
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
              className="relative flex min-h-[58px] min-w-0 touch-manipulation flex-col items-center justify-center gap-1 px-1 py-2 transition-colors active:bg-elev/60"
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
                      "absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 font-display text-[9.5px] font-medium leading-none text-white",
                      href === "/betslip" ? "bg-betclic-red" : "bg-ink"
                    )}
                  >
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "max-w-full truncate font-display text-[9.5px] leading-none",
                  active ? "font-medium text-betclic-red" : "font-medium text-dim"
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
