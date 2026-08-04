import { cn } from "@/lib/format";

/** Icônes sport dessinées à la main (balle + lignes de jeu). */
export function SportIcon({
  sport,
  className,
}: {
  sport: string;
  className?: string;
}) {
  const cls = cn("h-4 w-4", className);
  const common = {
    className: cls,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (sport === "football") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8.2 15.4 10.7 14.1 14.7H9.9L8.6 10.7 12 8.2Z" fill="currentColor" stroke="none" opacity="0.9" />
        <path d="M12 3v5.2M15.4 10.7l4.4-1.6M14.1 14.7l2.7 4M9.9 14.7l-2.7 4M8.6 10.7 4.2 9.1" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}
