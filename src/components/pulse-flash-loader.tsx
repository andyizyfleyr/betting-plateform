"use client";

import {
  Suspense,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/format";

/**
 * Géométrie officielle de l'éclair Pulse Bet centrée dans un viewBox 120×120.
 * L'animation de l'icône Flash constitue à elle seule l'indicateur de chargement.
 */
const FLASH_BOLT_PATH =
  "M 68.5 10 L 89.5 10 L 64.5 53.5 H 91.5 L 39.5 110 L 53 65.5 H 30.5 Z";

export function PulseFlashLoader({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const rawId = useId().replace(/:/g, "");
  const clipId = `pb-flash-clip-${rawId}`;
  const gradId = `pb-flash-grad-${rawId}`;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Chargement"
      className={cn(
        "flex w-full items-center justify-center select-none",
        compact
          ? "min-h-[260px] py-12"
          : "min-h-[calc(100dvh-132px)] py-10 lg:min-h-[64vh]",
        className
      )}
    >
      <div className="relative grid h-20 w-20 place-items-center">
        {/* Halo radial respirant */}
        <span
          aria-hidden="true"
          className="pb-flash-halo-anim pointer-events-none absolute inset-1 rounded-full bg-betclic-red/20 blur-md"
        />

        {/* Icône Flash animée (coeur du chargement) */}
        <svg
          width={62}
          height={62}
          viewBox="0 0 120 120"
          fill="none"
          aria-hidden="true"
          className="pb-flash-bolt-anim relative z-10 overflow-visible drop-shadow-[0_6px_18px_rgba(225,0,20,0.26)]"
        >
          <defs>
            <clipPath id={clipId}>
              <path d={FLASH_BOLT_PATH} />
            </clipPath>
            <linearGradient
              id={gradId}
              x1="34"
              y1="10"
              x2="86"
              y2="110"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#FF3B4B" />
              <stop offset="52%" stopColor="#E10014" />
              <stop offset="100%" stopColor="#B80010" />
            </linearGradient>
          </defs>

          {/* Silhouette de fond douce */}
          <path d={FLASH_BOLT_PATH} fill="rgba(225, 0, 20, 0.14)" />

          {/* Onde de charge électrique interne + reflet blanc */}
          <g clipPath={`url(#${clipId})`}>
            <rect
              x="16"
              y="6"
              width="88"
              height="108"
              fill={`url(#${gradId})`}
              className="pb-flash-charge-anim"
            />
            <rect
              x="10"
              y="44"
              width="100"
              height="20"
              fill="rgba(255, 255, 255, 0.65)"
              className="pb-flash-sheen-anim"
            />
          </g>

          {/* Tracé électrique périphérique continu */}
          <path
            d={FLASH_BOLT_PATH}
            stroke="#E10014"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pb-flash-stroke-anim"
          />
        </svg>
      </div>
    </div>
  );
}

/* ─── Contrôleur global de transition au clic (toutes pages & liens) ─── */

type RouteTransitionListener = (targetRoute: string | null) => void;
const listeners = new Set<RouteTransitionListener>();

function normalizePathname(p: string): string {
  if (!p || p === "/") return "/";
  return p.replace(/\/+$/, "") || "/";
}

function canonicalizeSearch(search: string): string {
  if (!search || search === "?") return "";
  const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  sp.sort();
  const str = sp.toString();
  return str ? `?${str}` : "";
}

function areEquivalentRoutes(a: string, b: string): boolean {
  if (a === b) return true;
  if ((a === "/" && b === "/matchs") || (a === "/matchs" && b === "/")) {
    return true;
  }
  return false;
}

function getCurrentBrowserRoute(): string {
  if (typeof window === "undefined") return "/";
  return `${normalizePathname(window.location.pathname)}${canonicalizeSearch(window.location.search || "")}`;
}

function resolveInternalRoute(href: string): string | null {
  if (typeof window === "undefined" || !href) return null;
  const trimmed = href.trim();
  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:")
  ) {
    return null;
  }
  try {
    const url = new URL(trimmed, window.location.href);
    if (url.origin !== window.location.origin) return null;
    const normPath = normalizePathname(url.pathname);
    if (
      normPath.startsWith("/api/") ||
      normPath === "/api" ||
      normPath.endsWith(".apk")
    ) {
      return null;
    }
    return `${normPath}${canonicalizeSearch(url.search || "")}`;
  } catch {
    return null;
  }
}

/**
 * Déclenche immédiatement la page loader Flash lors d'une navigation
 * programmatique (`router.push(...)`) vers une autre route interne.
 */
export function triggerRouteLoader(targetHref: string): void {
  const targetRoute = resolveInternalRoute(targetHref);
  if (!targetRoute) return;
  const current = getCurrentBrowserRoute();
  if (areEquivalentRoutes(targetRoute, current)) return;
  listeners.forEach((fn) => fn(targetRoute));
}

export function clearRouteLoader(): void {
  listeners.forEach((fn) => fn(null));
}

function NavigationTransitionInner({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const searchStr = searchParams?.toString() ?? "";
  const currentRoute = `${normalizePathname(pathname)}${canonicalizeSearch(searchStr ? `?${searchStr}` : "")}`;

  const [prevRoute, setPrevRoute] = useState(currentRoute);
  const [pending, setPending] = useState<{
    fromRoute: string;
    toRoute: string;
  } | null>(null);

  // Dès que l'URL courante change (vers la destination ou une redirection),
  // nettoie immédiatement `pending` afin qu'aucun retour arrière ultérieur ne fige la page.
  if (currentRoute !== prevRoute) {
    setPrevRoute(currentRoute);
    if (pending !== null) {
      setPending(null);
    }
  } else if (
    pending !== null &&
    (!areEquivalentRoutes(pending.fromRoute, currentRoute) ||
      areEquivalentRoutes(pending.toRoute, currentRoute))
  ) {
    setPending(null);
  }

  useEffect(() => {
    const onTrigger: RouteTransitionListener = (targetRoute) => {
      if (!targetRoute) {
        setPending(null);
        return;
      }
      const from = getCurrentBrowserRoute();
      if (areEquivalentRoutes(targetRoute, from)) return;
      setPending({ fromRoute: from, toRoute: targetRoute });
    };
    listeners.add(onTrigger);

    const onDocumentClick = (e: MouseEvent) => {
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
      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.dataset.noRouteLoader === "true") return;

      const rawHref = anchor.getAttribute("href");
      if (!rawHref) return;
      const dest = resolveInternalRoute(rawHref);
      if (!dest) return;
      const nowRoute = getCurrentBrowserRoute();
      if (areEquivalentRoutes(dest, nowRoute)) return;

      setPending({ fromRoute: nowRoute, toRoute: dest });
    };

    const onPopState = () => {
      setPending(null);
    };

    document.addEventListener("click", onDocumentClick);
    window.addEventListener("popstate", onPopState);
    return () => {
      listeners.delete(onTrigger);
      document.removeEventListener("click", onDocumentClick);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  const isNavigating =
    pending !== null &&
    areEquivalentRoutes(pending.fromRoute, currentRoute) &&
    !areEquivalentRoutes(pending.toRoute, currentRoute);

  // Remonte immédiatement en haut de l'écran et libère toujours l'affichage sous 3,2 s max
  useEffect(() => {
    if (!isNavigating || !pending) return;
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
    const targetHref = pending.toRoute;
    const originHref = pending.fromRoute;

    const retryTimer = window.setTimeout(() => {
      if (areEquivalentRoutes(getCurrentBrowserRoute(), originHref)) {
        router.push(targetHref);
      }
    }, 1_800);

    const clearTimer = window.setTimeout(() => {
      setPending(null);
    }, 3_200);

    return () => {
      window.clearTimeout(retryTimer);
      window.clearTimeout(clearTimer);
    };
  }, [isNavigating, pending, router]);

  return (
    <>
      {isNavigating && <PulseFlashLoader />}
      <div className={isNavigating ? "hidden" : undefined}>{children}</div>
    </>
  );
}

export function NavigationTransitionLayer({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Suspense fallback={<PulseFlashLoader />}>
      <NavigationTransitionInner>{children}</NavigationTransitionInner>
    </Suspense>
  );
}
