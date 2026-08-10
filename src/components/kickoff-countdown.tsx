"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/format";

/**
 * Décompte temps réel jusqu'au coup d'envoi d'un match à venir.
 * - > 48 h : date longue (ex. « sam. 14 juin · 20:45 »)
 * - <= 48 h : « J-1 · 14:32:12 » puis « 14:32:12 » (live tick à la seconde)
 * - passé : « C'est l'heure ! »
 */
export function KickoffCountdown({
  startsAt,
  className,
}: {
  startsAt: string;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const target = new Date(startsAt).getTime();
  const diff = target - now;

  if (!Number.isFinite(target) || diff <= 0) {
    return (
      <span className={cn("font-display text-[10px] font-black tracking-wide text-live", className)}>
        C'est l'heure !
      </span>
    );
  }

  const secs = Math.floor(diff / 1000);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  const remainder = secs % 60;

  const pad = (n: number) => String(n).padStart(2, "0");

  let label: string;
  if (days >= 2) {
    const day = new Intl.DateTimeFormat("fr-FR", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(target));
    label = day.replace(/(\d+):(\d+)/, "$1h$2");
    return (
      <span className={cn("shrink-0 font-display text-[10px] font-semibold tracking-[0.08em] text-mist", className)}>
        {label}
      </span>
    );
  }

  if (days === 1) {
    label = `J-1 · ${pad(hours)}h${pad(mins)}`;
  } else if (hours >= 1) {
    label = `${pad(hours)}h${pad(mins)}`;
  } else {
    label = `${pad(mins)}:${pad(remainder)}`;
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 font-display text-[10px] font-black tabular-nums tracking-wide text-betclic-red",
        className
      )}
    >
      <span className="countdown-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
      {label}
    </span>
  );
}