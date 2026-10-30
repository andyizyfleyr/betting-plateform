"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/format";

export interface FilterDropdownOption<T extends string = string> {
  value: T;
  label: string;
  pillLabel?: string;
  count?: number;
}

export interface FilterDropdownItem<T extends string = string> {
  id: string;
  placeholder: string;
  value: T;
  defaultValue: T;
  options: FilterDropdownOption<T>[];
  onChange: (value: T) => void;
}

interface FilterDropdownRowProps {
  filters: FilterDropdownItem<any>[];
  onReset?: () => void;
  resultCountText?: string | null;
  sticky?: boolean;
  bleedHorizontal?: boolean;
  className?: string;
  compactMobile?: boolean;
}

interface MenuPosition {
  top?: number;
  bottom?: number;
  left: number;
  minWidth: number;
}

export function FilterDropdownRow({
  filters,
  onReset,
  resultCountText,
  sticky = true,
  bleedHorizontal = true,
  className,
  compactMobile = false,
}: FilterDropdownRowProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const menuRef = useRef<HTMLDivElement | null>(null);

  const hasActiveFilter = filters.some((f) => f.value !== f.defaultValue);
  const activeFilter = filters.find((f) => f.id === openId) ?? null;

  const updatePosition = useCallback((id: string) => {
    const btn = buttonRefs.current[id];
    if (!btn || typeof window === "undefined") return;
    const rect = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const measuredWidth = menuRef.current?.offsetWidth ?? 0;
    const desiredWidth = Math.max(212, Math.round(rect.width), measuredWidth);
    const maxLeft = Math.max(16, vw - desiredWidth - 16);
    const left = Math.min(Math.max(16, Math.round(rect.left)), maxLeft);

    const spaceBelow = vh - rect.bottom - 16;
    const openUpward = spaceBelow < 190 && rect.top > spaceBelow;

    if (openUpward) {
      setMenuPos({
        bottom: Math.round(vh - rect.top + 6),
        left,
        minWidth: Math.min(Math.max(212, Math.round(rect.width)), vw - 32),
      });
    } else {
      setMenuPos({
        top: Math.round(rect.bottom + 6),
        left,
        minWidth: Math.min(Math.max(212, Math.round(rect.width)), vw - 32),
      });
    }
  }, []);

  useLayoutEffect(() => {
    if (!openId) return;
    updatePosition(openId);
    const raf = window.requestAnimationFrame(() => updatePosition(openId));
    return () => window.cancelAnimationFrame(raf);
  }, [openId, updatePosition]);

  useEffect(() => {
    if (!openId) return;

    const handleReposition = () => updatePosition(openId);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      const btn = buttonRefs.current[openId];
      if (btn?.contains(target)) return;
      setOpenId(null);
    };

    window.addEventListener("scroll", handleReposition, { passive: true, capture: true });
    window.addEventListener("resize", handleReposition, { passive: true });
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [openId, updatePosition]);

  const toggleMenu = (id: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    updatePosition(id);
    setOpenId(id);
  };

  return (
    <>
      <div
        className={cn(
          bleedHorizontal ? "-mx-2 px-2 lg:mx-0 lg:px-0" : "",
          compactMobile ? "py-1.5 lg:py-3" : "py-3",
          sticky && "sticky top-[48px] z-30 bg-deep/95 backdrop-blur-md lg:top-[52px]",
          className
        )}
      >
        <div className="no-scrollbar flex w-full items-center gap-2 overflow-x-auto">
          {filters.map((filter) => {
            const isActive = filter.value !== filter.defaultValue;
            const isOpen = openId === filter.id;
            const selectedOption = filter.options.find((o) => o.value === filter.value);
            const displayLabel = isActive
              ? (selectedOption?.pillLabel ?? selectedOption?.label ?? filter.placeholder)
              : filter.placeholder;

            return (
              <button
                key={filter.id}
                ref={(el) => {
                  buttonRefs.current[filter.id] = el;
                }}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                onClick={() => toggleMenu(filter.id)}
                className={cn(
                  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border-0 text-[11.5px] font-medium leading-none whitespace-nowrap transition-all active:scale-[0.98]",
                  compactMobile ? "h-8 grow-0 px-3 lg:h-10 lg:grow lg:px-3.5" : "h-10 grow px-3.5",
                  isActive
                    ? "bg-betclic-red text-white shadow-[0_2px_8px_rgba(225,0,20,0.22)]"
                    : "bg-[#e7e9ed] text-[#374151] hover:bg-[#dde0e6]"
                )}
              >
                <span>{displayLabel}</span>
                <ChevronDown
                  aria-hidden="true"
                  strokeWidth={2.25}
                  className={cn(
                    "h-4 w-4 shrink-0 transition-transform duration-150",
                    isOpen && "rotate-180",
                    isActive ? "text-white/95" : "text-[#374151]/80"
                  )}
                />
              </button>
            );
          })}

          {hasActiveFilter && onReset && (
            <button
              type="button"
              onClick={() => {
                setOpenId(null);
                onReset();
              }}
              className={cn("shrink-0 rounded-full border-0 px-3 text-[11px] font-medium whitespace-nowrap text-betclic-red transition-colors hover:bg-betclic-red/8 active:scale-[0.98]", compactMobile ? "h-8 lg:h-10" : "h-10")}
            >
              Réinitialiser
            </button>
          )}
        </div>
      </div>

      {resultCountText != null && (
        <p className={cn("text-[11px] font-medium tabular-nums text-dim", compactMobile ? "mb-1.5 lg:mb-2.5" : "mb-2.5")}>
          {resultCountText}
        </p>
      )}

      {typeof document !== "undefined" &&
        activeFilter &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={activeFilter.placeholder}
            style={{
              position: "fixed",
              top: menuPos.top,
              bottom: menuPos.bottom,
              left: menuPos.left,
              minWidth: menuPos.minWidth,
              maxWidth: "calc(100vw - 32px)",
            }}
            className="z-50 max-h-[min(320px,55vh)] overflow-y-auto overscroll-contain rounded-2xl bg-white p-1.5 shadow-[0_12px_32px_rgba(17,24,39,0.16)] ring-1 ring-black/8"
          >
            {activeFilter.options.map((opt) => {
              const selected = opt.value === activeFilter.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    activeFilter.onChange(opt.value);
                    setOpenId(null);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-[11.5px] transition-colors",
                    selected
                      ? "bg-betclic-red/8 font-medium text-betclic-red"
                      : "font-medium text-ink hover:bg-elev active:bg-elev"
                  )}
                >
                  <span className="truncate">
                    {opt.label}
                    {typeof opt.count === "number" && (
                      <span
                        className={cn(
                          "ml-1.5 tabular-nums text-[11px]",
                          selected ? "font-medium text-betclic-red/85" : "font-normal text-dim"
                        )}
                      >
                        ({opt.count})
                      </span>
                    )}
                  </span>
                  {selected && (
                    <Check
                      className="h-4 w-4 shrink-0 text-betclic-red"
                      strokeWidth={2.5}
                    />
                  )}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
