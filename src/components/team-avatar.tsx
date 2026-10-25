"use client";

import { useState } from "react";
import { teamLogo } from "@/lib/team-logos";
import { cn, initials, teamHue } from "@/lib/format";

const SIZES = {
  xs: { box: "h-7 w-7 rounded-lg text-[9.5px]", pad: "p-1" },
  sm: { box: "h-8 w-8 rounded-[10px] text-[10.5px]", pad: "p-[5px]" },
  md: { box: "h-11 w-11 rounded-xl text-[12px]", pad: "p-1.5" },
  lg: { box: "h-13 w-13 rounded-2xl text-[14px]", pad: "p-1.5" },
} as const;

/**
 * Affiche l'écusson officiel du club avec bascule automatique :
 * CDN officiel (teamLogo) → URL fournie en base (logo) → blason monogramme.
 */
export function TeamAvatar({
  name,
  logo,
  size = "md",
  className,
}: {
  name: string;
  logo?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const [failedUrls, setFailedUrls] = useState<Record<string, true>>({});
  const s = SIZES[size];
  const hue = teamHue(name);

  const primary = teamLogo(name);
  const candidates = [primary, logo].filter(
    (u, idx, arr): u is string => Boolean(u) && arr.indexOf(u) === idx
  );
  const activeUrl = candidates.find((u) => !failedUrls[u]) ?? null;

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
          src={activeUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() =>
            setFailedUrls((prev) => (prev[activeUrl] ? prev : { ...prev, [activeUrl]: true }))
          }
          className={cn("h-full w-full object-contain", s.pad)}
        />
      </span>
    );
  }

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
