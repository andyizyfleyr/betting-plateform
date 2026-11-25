"use client";

import { useRef, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/format";

/**
 * Cartes « swipe to delete » façon grandes apps.
 * Un glissement horizontal vers la gauche (avec résistance douce) dévoile un
 * fond « Supprimer » ; au-delà d'un seuil le relâchement déclenche la suppression.
 */
export function SwipeToDelete({
  children,
  onDelete,
  disabled,
  deleteLabel = "Supprimer",
}: {
  children: ReactNode;
  onDelete: () => void;
  disabled?: boolean;
  deleteLabel?: string;
}) {
  const [tx, setTx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef<number | null>(null);
  const startTx = useRef(0);

  const SWIPE_THRESHOLD = 110;

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    startX.current = e.clientX;
    startTx.current = tx;
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || startX.current === null) return;
    const delta = e.clientX - startX.current;
    // résistance douce : on décroît l'amplitude au-delà du seuil
    const next = startTx.current + Math.max(-260, Math.min(0, delta));
    setTx(next);
  };

  const finish = () => {
    if (!dragging) return;
    setDragging(false);
    startX.current = null;
    if (tx <= -SWIPE_THRESHOLD) {
      onDelete();
    } else {
      setTx(0);
    }
  };

  return (
    <div className="relative overflow-hidden">
      {/* fond Supprimer */}
      <div
        className={cn(
          "absolute inset-y-0 left-0 flex items-center justify-center gap-1.5 bg-betclic-red text-white",
          disabled && "opacity-40"
        )}
        style={{ width: 132 }}
      >
        <Trash2 className="h-4 w-4" strokeWidth={2.3} />
        <span className="font-display text-[11.5px] font-medium">{deleteLabel}</span>
      </div>

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={finish}
        style={{
          transform: `translateX(${tx}px)`,
          transition: dragging ? "none" : "transform 0.25s ease-out",
          touchAction: "pan-y",
        }}
        className="relative"
      >
        {children}
      </div>
    </div>
  );
}
