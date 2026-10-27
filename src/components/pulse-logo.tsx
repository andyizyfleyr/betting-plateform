import { useId } from "react";
import { cn } from "@/lib/format";

export function PulseMark({
  size = 28,
  inverted = false,
  className,
}: {
  size?: number;
  /** `true` sur fond rouge plein (barre desktop lg+) : écusson blanc + éclair rouge */
  inverted?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const bgId = `pb-bg-${uid}`;
  const glowId = `pb-glow-${uid}`;
  const rimId = `pb-rim-${uid}`;

  if (inverted) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        fill="none"
        aria-hidden="true"
        className={cn("shrink-0", className)}
      >
        <rect width="512" height="512" rx="128" fill="#FFFFFF" />
        <path
          d="M 76 274 H 128 L 150 232 L 174 302 L 198 258"
          stroke="#E10014"
          strokeWidth="28"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M 298 84 L 368 84 L 284 232 H 374 L 198 432 L 244 278 H 168 Z"
          fill="#E10014"
        />
        <path
          d="M 356 286 L 378 252 L 398 286 H 436"
          stroke="#E10014"
          strokeWidth="26"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="404" cy="132" r="24" fill="#E10014" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient
          id={bgId}
          x1="48"
          y1="24"
          x2="464"
          y2="488"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#FF2638" />
          <stop offset="48%" stopColor="#E10014" />
          <stop offset="100%" stopColor="#96000D" />
        </linearGradient>
        <radialGradient
          id={glowId}
          cx="148"
          cy="104"
          r="280"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#FF7A85" stopOpacity="0.38" />
          <stop offset="70%" stopColor="#FF2638" stopOpacity="0" />
        </radialGradient>
        <linearGradient
          id={rimId}
          x1="48"
          y1="32"
          x2="440"
          y2="480"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.06" />
        </linearGradient>
      </defs>

      <rect width="512" height="512" rx="128" fill={`url(#${bgId})`} />
      <rect width="512" height="512" rx="128" fill={`url(#${glowId})`} />
      <rect
        x="10"
        y="10"
        width="492"
        height="492"
        rx="118"
        stroke={`url(#${rimId})`}
        strokeWidth="10"
      />
      <path
        d="M 76 274 H 128 L 150 232 L 174 302 L 198 258"
        stroke="#FFFFFF"
        strokeWidth="28"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 298 84 L 368 84 L 284 232 H 374 L 198 432 L 244 278 H 168 Z"
        fill="#FFFFFF"
      />
      <path
        d="M 356 286 L 378 252 L 398 286 H 436"
        stroke="#FFFFFF"
        strokeWidth="26"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="404" cy="132" r="24" fill="#FFFFFF" />
    </svg>
  );
}

export function PulseLogo({
  size = "sm",
  variant = "light",
  subtitle,
  className,
}: {
  size?: "sm" | "md" | "lg";
  variant?: "light" | "dark" | "onRed";
  subtitle?: string;
  className?: string;
}) {
  const markPx = size === "lg" ? 38 : size === "md" ? 32 : 28;
  const isOnRed = variant === "onRed";
  const isDark = variant === "dark";

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <PulseMark size={markPx} inverted={isOnRed} />
      <span className="flex flex-col leading-none">
        <span className="inline-flex items-center gap-1">
          <span
            className={cn(
              "font-display font-black italic tracking-tight",
              size === "lg"
                ? "text-[19px]"
                : size === "md"
                  ? "text-[20px]"
                  : "text-[17px]",
              isOnRed || isDark ? "text-white" : "text-ink"
            )}
          >
            PULSE
          </span>
          <span
            className={cn(
              "inline-flex items-center justify-center rounded-md font-display font-black italic tracking-wide",
              size === "lg"
                ? "px-1.5 py-[2px] text-[11px]"
                : size === "md"
                  ? "px-1.5 py-[2px] text-[11.5px]"
                  : "px-1.5 py-[1.5px] text-[10px]",
              isOnRed
                ? "bg-white text-betclic-red"
                : "bg-betclic-red text-white"
            )}
          >
            BET
          </span>
        </span>
        {subtitle ? (
          <span
            className={cn(
              "mt-1 text-[11px] font-medium",
              isOnRed
                ? "text-white/80"
                : isDark
                  ? "text-slate-400"
                  : "text-dim"
            )}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
    </span>
  );
}
