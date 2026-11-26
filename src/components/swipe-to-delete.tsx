"use client";

import { useRef, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/format";

/**
 * Carte « swipe to delete » façon grandes apps (web mobile).
 * Glissement horizontal vers la gauche : le suivi est direct puis freiné
 * (résistance type rubber-band) au-delà du seuil, le relâchement au-delà du
 * seuil (ou avec un geste vif) supprime la carte, sinon retour élastique.
 */
const THRESHOLD = 104;
const MAX_DRAG = 168;
const FLICK_DISTANCE = 56;
const FLICK_VELOCITY = 0.5; // px / ms

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
  const [armed, setArmed] = useState(false);
  const [removing, setRemoving] = useState(false);
  const startX = useRef<number | null>(null);
  const startTx = useRef(0);
  const lastX = useRef(0);
  const lastT = useRef(0);
  const velocity = useRef(0);
  const moved = useRef(false);

  const resist = (raw: number) => {
    // au-delà du seuil, on freine progressivement : jamais plus de MAX_DRAG.
    if (raw >= -THRESHOLD) return raw;
    const over = -raw - THRESHOLD;
    return Math.max(-MAX_DRAG, -THRESHOLD - over * 0.4);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || removing) return;
    startX.current = e.clientX;
    startTx.current = tx;
    lastX.current = e.clientX;
    lastT.current = e.timeStamp;
    velocity.current = 0;
    moved.current = false;
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || startX.current === null) return;
    const dt = e.timeStamp - lastT.current;
    if (dt > 0) {
      const inst = (e.clientX - lastX.current) / dt;
      velocity.current = velocity.current * 0.6 + inst * 0.4;
      lastX.current = e.clientX;
      lastT.current = e.timeStamp;
    }
    const delta = e.clientX - startX.current;
    if (Math.abs(delta) > 6) moved.current = true;
    // pas de swipe vers la droite : la carte reste alignée.
    const next = resist(Math.min(0, startTx.current + delta));
    setTx(next);
    const nowArmed = next <= -THRESHOLD;
    if (nowArmed !== armed) setArmed(nowArmed);
  };

  const finish = (e?: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    startX.current = null;
    setArmed(false);

    const fastFlick = velocity.current <= -FLICK_VELOCITY && tx <= -FLICK_DISTANCE;
    if (tx <= -THRESHOLD || fastFlick) {
      setRemoving(true);
      setTx(-420);
      window.setTimeout(onDelete, 190);
      return;
    }
    setTx(0);
    void e;
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl transition-[height,opacity] duration-200 ease-out",
        removing && "pointer-events-none opacity-0"
      )}
    >
      {/* fond « Supprimer » révélé à droite */}
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex items-center justify-end gap-1.5 bg-betclic-red pr-4 text-white",
          disabled && "opacity-40"
        )}
        aria-hidden={!armed}
      >
        <Trash2
          className="h-4 w-4 transition-transform duration-150"
          style={{ transform: armed ? "scale(1.1)" : "scale(0.9)" }}
          strokeWidth={2.3}
        />
        <span className="font-display text-[11.5px] font-medium">{deleteLabel}</span>
      </div>

      <div
        onClickCapture={(e) => {
          // après un glissement, on ne déclenche pas le lien de la carte.
          if (moved.current) {
            e.preventDefault();
            e.stopPropagation();
            moved.current = false;
          }
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={finish}
        style={{
          transform: `translateX(${tx}px)`,
          transition: dragging
            ? "none"
            : "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
          touchAction: "pan-y",
        }}
        className="relative will-change-transform"
      >
        {children}
      </div>
    </div>
  );
}
