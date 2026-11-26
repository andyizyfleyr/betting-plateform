"use client";

import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  /** Sélections concernées, affichées en liste. */
  items?: string[];
  /** Phrase de conséquence affichée sous la liste. */
  note?: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Boîte de confirmation au style de la plateforme : remplace les `window.confirm`
 * du navigateur (coupons de pari, annulation de bonus avant retrait…).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  items,
  note,
  confirmLabel,
  cancelLabel = "Annuler",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[130] grid place-items-center bg-black/50 px-6"
      onClick={onCancel}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[340px] rounded-2xl bg-white p-4 shadow-xl"
      >
        <span className="grid h-10 w-10 place-items-center rounded-full bg-amber-100 text-amber-700">
          <AlertTriangle className="h-5 w-5" strokeWidth={2.3} />
        </span>
        <h2 className="mt-3 font-display text-[14px] font-bold text-ink">{title}</h2>
        <p className="mt-1 text-[11.5px] leading-relaxed text-mist">{description}</p>
        {items && items.length > 0 && (
          <div className="mt-3 space-y-1 rounded-xl bg-elev px-3 py-2.5">
            {items.map((item) => (
              <p key={item} className="truncate text-[11px] text-ink">
                · {item}
              </p>
            ))}
          </div>
        )}
        {note && <p className="mt-2.5 text-[11.5px] leading-relaxed text-mist">{note}</p>}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-11 flex-1 rounded-xl bg-elev font-display text-[11.5px] font-medium text-ink active:bg-edge"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-11 flex-1 rounded-xl bg-betclic-red font-display text-[11.5px] font-semibold text-white active:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
