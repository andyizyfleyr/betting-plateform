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
  const { toggleComboLeg, comboLegs, toast, user } = useApp();
  const [pressing, setPressing] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const triggeredRef = useRef(false);
  const latestSelRef = useRef(comboSelection);
  const latestCountRef = useRef(comboLegs.length);

  useEffect(() => {
    latestSelRef.current = comboSelection;
  }, [comboSelection]);

  useEffect(() => {
    latestCountRef.current = comboLegs.length;
  }, [comboLegs.length]);

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
        const prevCount = latestCountRef.current;
        const result = toggleComboLeg(sel);
        triggerHaptic(user?.haptics, [22, 30]);

        if (result === "added") {
          const nextCount = prevCount + 1;
          toast({
            kind: "success",
            title: `Ajouté au Betslip (${nextCount})`,
            description: `${sel.title} · ${sel.selectionLabel}`,
          });
        } else if (result === "replaced") {
          toast({
            kind: "info",
            title: "Sélection modifiée dans le Betslip",
            description: `${sel.title} · ${sel.selectionLabel}`,
          });
        } else if (result === "removed") {
          toast({
            kind: "info",
            title: "Retiré du Betslip",
            description: `${sel.title} · ${sel.selectionLabel}`,
          });
        } else if (result === "full") {
          toast({
            kind: "error",
            title: "Betslip complet (8 sélections max)",
          });
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

  const onPointerLeave = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

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
      WebkitTouchCallout: "none" as const,
      userSelect: "none" as const,
    },
  };
}
