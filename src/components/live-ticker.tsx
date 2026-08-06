import type { ClientMatch } from "@/lib/api";

/** Bandeau défilant lime façon bandeau TV des scores. */
export function LiveTicker({ live }: { live: ClientMatch[] }) {
  if (live.length === 0) return null;

  const items = live.map(
    (m) =>
      `${m.homeTeam} ${m.homeScore ?? 0}–${m.awayScore ?? 0} ${m.awayTeam} · ${m.minute ?? ""}`
  );
  const loop = [...items, ...items, ...items, ...items];

  return (
    <div className="relative -mx-3 mt-4 overflow-hidden border-y border-lime/25 bg-lime py-1.5">
      <div className="marquee flex min-w-max items-center gap-5 px-3 whitespace-nowrap" style={{ willChange: "transform" }}>
        {loop.map((label, i) => (
          <span key={i} className="flex items-center gap-2 shrink-0 whitespace-nowrap">
            <span className="flex items-center gap-1.5 font-display text-[8.5px] font-black tracking-[0.2em] text-ink/70">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink" />
              LIVE
            </span>
            <span className="font-display text-[12px] font-bold tabular-nums text-ink">
              {label}
            </span>
            <span className="h-3 w-px rotate-12 bg-ink/25" />
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-lime to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-lime to-transparent" />
    </div>
  );
}
