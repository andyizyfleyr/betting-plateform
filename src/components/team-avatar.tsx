"use client";

import { useState } from "react";
import { teamLogo } from "@/lib/team-logos";
import { cn, initials, teamHue } from "@/lib/format";

const SIZES = {
  xs: { box: "h-7 w-7 rounded-lg text-[9px]", pad: "p-1" },
  sm: { box: "h-8 w-8 rounded-[10px] text-[10px]", pad: "p-[5px]" },
  md: { box: "h-10 w-10 rounded-xl text-[12px]", pad: "p-1.5" },
  lg: { box: "h-12 w-12 rounded-2xl text-[14px]", pad: "p-1.5" },
} as const;

/**
 * Affiche le vrai écusson du club sur pastille blanche,
 * avec repli vers l'avatar dégradé à initiales si indisponible.
 */
export function TeamAvatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const hue = teamHue(name);
  const logo = teamLogo(name);
  const [broken, setBroken] = useState(false);
  const s = SIZES[size];

  if (logo && !broken) {
    return (
      <span
        className={cn(
          "relative grid shrink-0 place-items-center overflow-hidden bg-white",
          s.box,
          className
        )}
        style={{
          boxShadow:
            "inset 0 0 0 1px rgba(18,28,40,0.16), 0 5px 14px -8px rgba(0,0,0,0.55)",
        }}
        aria-hidden
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logo}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
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
        background: `linear-gradient(140deg, hsl(${hue} 62% 46% / 0.9), hsl(${(hue + 40) % 360} 70% 30% / 0.95))`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.22), 0 6px 16px -8px hsl(${hue} 70% 40% / 0.6)`,
      }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
