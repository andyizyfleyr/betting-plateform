"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { useApp } from "@/components/providers";
import type { ComboSelection } from "@/components/combo-slip";
import { triggerHaptic } from "./feedback";

const LONG_PRESS_MS = 400;
const MOVE_CANCEL_PX = 10;

interface UseLongPressOddsOptions {
  disabled?: boolean;
  comboSelection: ComboSelection;
  onTap: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export function useLongPressOdds({
  disabled = false,
  comboSelection,
  onTap,
}: UseLongPressOddsOptions) {
  const { toggleComboLeg, toast, user } = useApp();
  const [pressing, setPressing] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const triggeredRef = useRef(false);
  const latestSelRef = useRef(comboSelection);

  useEffect(() => {
    latestSelRef.current = comboSelection;
  }, [comboSelection]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPressing(false);
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;

      triggeredRef.current = false;
      startPosRef.current = { x: e.clientX, y: e.clientY };
      setPressing(true);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        triggeredRef.current = true;
        setPressing(false);

        const sel = latestSelRef.current;
        const result = toggleComboLeg(sel);
        triggerHaptic(user?.haptics, [22, 30]);

        // Mêmes retours que l'app mobile : l'ajout/remplacement/retrait est
        // silencieux (pas de bottom sheet), seules les erreurs sont signalées.
        if (result === "full") {
          toast({
            kind: "error",
            title: "Betslip complet",
          });
        } else if (result === "source_conflict") {
          toast({
            kind: "error",
            title: "Mélange interdit",
            description: "Impossible de mélanger match réel et match virtuel.",
          });
        } else if (result === "added" || result === "replaced") {
          toast({
            kind: "success",
            title:
              result === "replaced"
                ? "Sélection remplacée dans le coupon"
                : "Ajouté au coupon de pari",
            description: `${sel.title} · ${sel.selectionLabel}`,
          });
        } else if (result === "removed") {
          toast({ kind: "info", title: "Retiré du coupon" });
        }
      }, LONG_PRESS_MS);
    },
    [disabled, toast, toggleComboLeg, user?.haptics]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!startPosRef.current || !timerRef.current) return;
      const dx = e.clientX - startPosRef.current.x;
      const dy = e.clientY - startPosRef.current.y;
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
        clearTimer();
      }
    },
    [clearTimer]
  );

  const onPointerUp = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const onPointerCancel = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const onPointerLeave = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === "mouse") {
        clearTimer();
      }
    },
    [clearTimer]
  );

  const onContextMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (disabled) return;
      if (triggeredRef.current) {
        triggeredRef.current = false;
        e.preventDefault();
        return;
      }
      onTap(e);
    },
    [disabled, onTap]
  );

  return {
    pressing,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
      onContextMenu,
      onClick,
    },
    style: {
      touchAction: "manipulation" as const,
      WebkitTouchCallout: "none" as const,
      userSelect: "none" as const,
    },
  };
}
