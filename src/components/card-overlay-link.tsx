"use client";

import { useCallback, useEffect, useRef } from "react";
import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/format";

let globalNavToken = 0;

function CardPendingBar() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[2.5px] animate-pulse bg-betclic-red"
    />
  );
}

interface CardOverlayLinkProps {
  href: string;
  label: string;
  onBeforeNavigate?: () => void;
  className?: string;
}

/**
 * Couche `<Link>` native pleine carte (`absolute inset-0 z-0`) dédiée aux cartes tactiles Web/Mobile :
 * - Aucun pseudo-élément `::after`, aucune transition d'`opacity` sur `:active`, et aucun enfant DOM
 *   dynamique susceptible de se détacher entre `touchstart` et `touchend` lors des ticks temps réel.
 * - Désactive le préchargement automatique de masse (`prefetch={false}`) sur les longues listes pour
 *   préserver la bande passante mobile, tout en préchargeant à l'intention (`touchstart` / survol).
 * - Intègre un filet de sécurité si une requête RSC mobile échoue silencieusement sur réseau instable.
 */
export function CardOverlayLink({
  href,
  label,
  onBeforeNavigate,
  className,
}: CardOverlayLinkProps) {
  const router = useRouter();
  const prefetchedRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) {
      window.clearTimeout(id);
    }
    timersRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const warmTarget = useCallback(() => {
    if (prefetchedRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    prefetchedRef.current = true;
    try {
      router.prefetch(href);
    } catch {
      /* ignore */
    }
  }, [href, router]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      onBeforeNavigate?.();

      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }

      if (typeof window === "undefined") return;

      clearTimers();
      const token = ++globalNavToken;
      const originLocation = window.location.pathname + window.location.search;
      const targetUrl = new URL(href, window.location.origin);
      const targetLocation = targetUrl.pathname + targetUrl.search;

      if (originLocation === targetLocation) return;

      const t1 = window.setTimeout(() => {
        if (token !== globalNavToken) return;
        const nowLoc = window.location.pathname + window.location.search;
        if (nowLoc === originLocation) {
          router.push(href);
        }
      }, 1800);

      const t2 = window.setTimeout(() => {
        if (token !== globalNavToken) return;
        const nowLoc = window.location.pathname + window.location.search;
        if (
          nowLoc === originLocation &&
          (typeof navigator === "undefined" || navigator.onLine !== false)
        ) {
          window.location.assign(href);
        }
      }, 4200);

      timersRef.current = [t1, t2];
    },
    [clearTimers, href, onBeforeNavigate, router]
  );

  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={label}
      onTouchStart={warmTarget}
      onPointerEnter={warmTarget}
      onClick={handleClick}
      className={cn(
        "absolute inset-0 z-0 block overflow-hidden rounded-2xl transition-colors hover:bg-elev/15 active:bg-elev/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-betclic-red/70",
        className
      )}
    >
      <CardPendingBar />
    </Link>
  );
}
