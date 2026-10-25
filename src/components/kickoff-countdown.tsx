"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/format";

export function KickoffCountdown({
  startsAt,
  className,
}: {
  startsAt: string;
  className?: string;
}) {
  const target = new Date(startsAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  const diff = target - now;
  const underOneHour = Number.isFinite(target) && diff > 0 && diff < 3_600_000;

  useEffect(() => {
    const interval = underOneHour ? 10_000 : 30_000;
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [underOneHour]);

  if (!Number.isFinite(target) || diff <= 30_000) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full bg-betclic-red/10 px-2 py-0.5 font-display text-[10.5px] font-bold text-betclic-red",
          className
        )}
      >
        <span className="countdown-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
        Imminent
      </span>
    );
  }

  if (underOneHour) {
    const mins = Math.max(1, Math.ceil(diff / 60_000));
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full bg-betclic-red/10 px-2 py-0.5 font-display text-[10.5px] font-bold tabular-nums text-betclic-red",
          className
        )}
      >
        <span className="countdown-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />
        dans {mins} min
      </span>
    );
  }

  const kickoffDate = new Date(target);
  const nowDate = new Date(now);

  const sameDay =
    kickoffDate.getFullYear() === nowDate.getFullYear() &&
    kickoffDate.getMonth() === nowDate.getMonth() &&
    kickoffDate.getDate() === nowDate.getDate();

  const tomorrowDate = new Date(nowDate);
  tomorrowDate.setDate(nowDate.getDate() + 1);
  const isTomorrow =
    kickoffDate.getFullYear() === tomorrowDate.getFullYear() &&
    kickoffDate.getMonth() === tomorrowDate.getMonth() &&
    kickoffDate.getDate() === tomorrowDate.getDate();

  const timeStr = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(kickoffDate);

  let label: string;
  if (sameDay) {
    label = `Auj. ${timeStr}`;
  } else if (isTomorrow) {
    label = `Demain ${timeStr}`;
  } else {
    const dayStr = new Intl.DateTimeFormat("fr-FR", {
      weekday: "short",
      day: "numeric",
    }).format(kickoffDate);
    label = `${dayStr} · ${timeStr}`;
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md bg-elev px-2 py-0.5 font-display text-[10.5px] font-semibold tabular-nums text-mist",
        className
      )}
    >
      <Clock className="h-3 w-3 text-dim" strokeWidth={2.2} />
      {label}
    </span>
  );
}
