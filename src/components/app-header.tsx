"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, LogOut, Plus, ShieldCheck, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "./providers";
import { AnimatedNumber } from "./animated-number";
import { eur } from "@/lib/format";

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { balance, user, applyUser, clearCombo, openRecharge, toast } = useApp();
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
      <header className="pt-safe sticky top-0 z-40 border-b border-edge bg-white/95 backdrop-blur-md">
        <div className="flex h-[52px] items-center justify-between px-4">
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
      </header>
    );
  }

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
