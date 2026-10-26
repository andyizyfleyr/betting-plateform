"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/format";

export const INFINITE_BATCH_STEP = 10;

interface BatchState {
  key: string;
  count: number;
  loading: boolean;
}

export interface InfiniteBatchController {
  visibleCount: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
}

/**
 * Contrôleur de défilement infini par bond de 10 éléments avec état de chargement fluide.
 * Se réinitialise instantanément à `step` (10) dès que `resetKey` change (filtre, recherche, onglet).
 */
export function useInfiniteBatch(
  totalCount: number,
  resetKey = "default",
  step = INFINITE_BATCH_STEP
): InfiniteBatchController {
  const [state, setState] = useState<BatchState>({
    key: resetKey,
    count: step,
    loading: false,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);
  const stateRef = useRef(state);
  const totalRef = useRef(totalCount);
  const keyRef = useRef(resetKey);

  const visibleCount = state.key === resetKey ? state.count : step;
  const isLoadingMore = state.key === resetKey ? state.loading : false;
  const hasMore = visibleCount < totalCount;

  useEffect(() => {
    stateRef.current = state;
    totalRef.current = totalCount;
    if (keyRef.current !== resetKey) {
      keyRef.current = resetKey;
      loadingRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [state, totalCount, resetKey]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const loadMore = useCallback(() => {
    const activeKey = resetKey;
    const current =
      stateRef.current.key === activeKey ? stateRef.current.count : step;
    if (loadingRef.current || current >= totalRef.current) return;

    loadingRef.current = true;
    setState({ key: activeKey, count: current, loading: true });

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      loadingRef.current = false;
      if (keyRef.current !== activeKey) return;
      setState((prev) => {
        const base = prev.key === activeKey ? prev.count : step;
        return {
          key: activeKey,
          count: Math.min(totalRef.current, base + step),
          loading: false,
        };
      });
    }, 280);
  }, [resetKey, step]);

  return {
    visibleCount,
    hasMore,
    isLoadingMore,
    loadMore,
  };
}

/**
 * Découpe jusqu'à 3 sections ordonnées (ex. En direct / Avant-match / Terminés)
 * en respectant un budget cumulé global (`10`, `20`, `30`…).
 */
export function sliceThreeSections<T>(
  first: T[],
  second: T[],
  third: T[],
  budget: number
): [T[], T[], T[]] {
  const s1 = first.slice(0, Math.max(0, budget));
  const rem1 = Math.max(0, budget - s1.length);
  const s2 = second.slice(0, rem1);
  const rem2 = Math.max(0, rem1 - s2.length);
  const s3 = third.slice(0, rem2);
  return [s1, s2, s3];
}

/**
 * Sentinelle IntersectionObserver avec spinner de chargement automatique.
 */
export function InfiniteScrollSentinel({
  hasMore,
  isLoadingMore,
  onLoadMore,
  className,
}: {
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  className?: string;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore || isLoadingMore) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      },
      { rootMargin: "220px 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);

  if (!hasMore && !isLoadingMore) return null;

  return (
    <div
      ref={sentinelRef}
      role="status"
      aria-live="polite"
      aria-label="Chargement de la suite"
      className={cn("flex items-center justify-center py-4", className)}
    >
      <div className="inline-flex items-center gap-2 rounded-full border border-edge bg-white px-3.5 py-1.5 shadow-2xs">
        <Loader2
          className="h-4 w-4 animate-spin text-betclic-red"
          strokeWidth={2.4}
        />
        <span className="font-display text-[12px] font-semibold text-mist">
          Chargement…
        </span>
      </div>
    </div>
  );
}
