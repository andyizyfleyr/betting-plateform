"use client";
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Check, X } from "lucide-react";

export function ActionOutcome({ kind, title, description, onClose }: { kind: "success" | "error"; title: string; description?: string; onClose: () => void }) {
  const success = kind === "success";
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    buttonRef.current?.focus();
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); previous?.focus(); };
  }, [onClose]);
  return <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
    <motion.div role="dialog" aria-modal="true" aria-label={title} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} onClick={e => e.stopPropagation()} className="w-full rounded-t-3xl bg-white px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 text-center shadow-xl sm:max-w-sm sm:rounded-3xl">
      <div className="mx-auto mb-6 h-1 w-10 rounded-full bg-gray-200" />
      <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${success ? "bg-emerald-50 text-emerald-500" : "bg-red-50 text-red-500"}`}>{success ? <Check size={32} strokeWidth={2.4} /> : <X size={32} strokeWidth={2.4} />}</div>
      <h2 className="mt-5 text-base font-semibold text-ink">{title}</h2>{description && <p className="mt-2 text-xs leading-relaxed text-gray-500">{description}</p>}
      <button ref={buttonRef} type="button" onClick={onClose} className="mt-7 w-full rounded-xl bg-betclic-red py-3 text-sm text-white">Terminé</button>
    </motion.div>
  </div>;
}
