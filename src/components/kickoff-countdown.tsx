"use client";

import { useEffect, useState } from "react";
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
    const interval = underOneHour ? 1_000 : 30_000;
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [underOneHour]);

  if (!Number.isFinite(target) || diff <= 0) {
    return (
      <span className={cn("font-display text-[11px] font-bold text-betclic-red", className)}>
        Imminent
      </span>
    );
  }

  const secs = Math.floor(diff / 1000);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  const remainder = secs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  if (days >= 2) {
    const label = new Intl.DateTimeFormat("fr-FR", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
      .format(new Date(target))
      .replace(/(\d+):(\d+)/, "$1h$2");
    return (
      <span className={cn("shrink-0 text-[11px] font-medium text-dim", className)}>{label}</span>
    );
  }

  const label =
    days === 1
      ? `J-1 · ${pad(hours)}h${pad(mins)}`
      : hours >= 1
        ? `${pad(hours)}h${pad(mins)}`
        : `${pad(mins)}:${pad(remainder)}`;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 font-display text-[11px] font-semibold tabular-nums text-mist",
        underOneHour && "font-bold text-betclic-red",
        className
      )}
    >
      {underOneHour && <span className="countdown-dot h-1.5 w-1.5 rounded-full bg-betclic-red" />}
      {label}
    </span>
  );
}
