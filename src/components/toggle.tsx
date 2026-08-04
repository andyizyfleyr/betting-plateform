"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/format";

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[30px] w-[52px] shrink-0 rounded-full transition-colors duration-300",
        checked ? "bg-lime" : "bg-elev",
        disabled && "opacity-50"
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 550, damping: 32 }}
        className={cn(
          "absolute top-[3px] h-6 w-6 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.35)]",
          checked ? "left-[23px]" : "left-[3px]"
        )}
      />
    </button>
  );
}
