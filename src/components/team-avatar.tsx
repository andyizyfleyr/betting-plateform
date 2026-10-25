"use client";

import { useMemo, useState } from "react";
import { teamLogoCandidates } from "@/lib/team-logos";
import { cn, initials, teamHue } from "@/lib/format";

const SIZES = {
  "2xs": { box: "h-6 w-6 rounded-md text-[8.5px]", pad: "p-0.5" },
  xs: { box: "h-7 w-7 rounded-lg text-[9.5px]", pad: "p-1" },
  sm: { box: "h-8 w-8 rounded-[10px] text-[10.5px]", pad: "p-[5px]" },
  md: { box: "h-11 w-11 rounded-xl text-[12px]", pad: "p-1.5" },
  lg: { box: "h-13 w-13 rounded-2xl text-[14px]", pad: "p-1.5" },
} as const;

export type TeamAvatarSize = keyof typeof SIZES;

/**
 * Affiche l'écusson officiel du club avec bascule automatique multi-CDN :
 * blason ESPN / URL officielle → CDN de secours API-Sports → monogramme déterministe.
 */
export function TeamAvatar({
  name,
  logo,
  size = "md",
  className,
}: {
  name: string;
  logo?: string | null;
  size?: TeamAvatarSize;
  className?: string;
}) {
  const candidates = useMemo(() => teamLogoCandidates(name, logo), [name, logo]);
  const sourcesKey = candidates.join("|");

  const [attempt, setAttempt] = useState<{ key: string; idx: number }>({
    key: sourcesKey,
    idx: 0,
  });

  const s = SIZES[size];
  const idx = attempt.key === sourcesKey ? attempt.idx : 0;
  const activeUrl = candidates[idx] ?? null;

  if (activeUrl) {
    return (
      <span
        className={cn(
          "relative grid shrink-0 place-items-center overflow-hidden bg-white ring-1 ring-black/8",
          s.box,
          className
        )}
        aria-hidden
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={activeUrl}
          src={activeUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() =>
            setAttempt((prev) => ({
              key: sourcesKey,
              idx: (prev.key === sourcesKey ? prev.idx : 0) + 1,
            }))
          }
          className={cn("h-full w-full object-contain", s.pad)}
        />
      </span>
    );
  }

  const hue = teamHue(name);

  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center font-display font-bold text-white/95",
        s.box,
        className
      )}
      style={{
        background: `linear-gradient(140deg, hsl(${hue} 62% 46% / 0.92), hsl(${(hue + 40) % 360} 70% 30% / 0.96))`,
      }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
