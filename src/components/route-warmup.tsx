"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

const warmedRoutePatterns = new Set<string>();
const warmedClientChunks = new Set<string>();

function warmPatternOnce(router: ReturnType<typeof useRouter>, sampleHref: string) {
  if (warmedRoutePatterns.has(sampleHref)) return;
  warmedRoutePatterns.add(sampleHref);
  try {
    router.prefetch(sampleHref);
  } catch {
    /* ignore */
  }
}

function warmChunkOnce(key: string, loader: () => Promise<unknown>) {
  if (warmedClientChunks.has(key)) return;
  warmedClientChunks.add(key);
  void loader().catch(() => {
    warmedClientChunks.delete(key);
  });
}

/**
 * Préchauffe une seule fois par motif dynamique (`[id]`) l'arbre RSC (Optimistic Routing)
 * et le module JS client associé dès que la page liste correspondante est au repos.
 * Évite 10 à 20 préchargements redondants sur réseau mobile lent tout en rendant l'ouverture
 * des fiches dédiées instantanée (0 ms) au premier toucher.
 */
export function RouteWarmup() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    const run = () => {
      if (pathname === "/paris") {
        warmPatternOnce(router, "/paris/simple/sport-1");
        warmPatternOnce(router, "/paris/combine/1");
        warmChunkOnce("paris-simple", () =>
          import("@/app/(main)/paris/simple/[id]/page")
        );
        warmChunkOnce("paris-combine", () =>
          import("@/app/(main)/paris/combine/[id]/page")
        );
        return;
      }

      if (pathname.startsWith("/paris/simple/") || pathname.startsWith("/paris/combine/")) {
        warmPatternOnce(router, "/matchs/1");
        warmPatternOnce(router, "/resultats/1");
        warmPatternOnce(router, "/predictions/1");
        warmChunkOnce("matchs-id", () => import("@/app/(main)/matchs/[id]/page"));
        warmChunkOnce("resultats-id", () =>
          import("@/app/(main)/resultats/[id]/page")
        );
        warmChunkOnce("predictions-id", () =>
          import("@/app/(main)/predictions/[id]/page")
        );
        return;
      }

      if (pathname === "/matchs" || pathname.startsWith("/matchs/")) {
        warmPatternOnce(router, "/matchs/1");
        warmChunkOnce("matchs-id", () => import("@/app/(main)/matchs/[id]/page"));
        return;
      }

      if (pathname === "/predictions") {
        warmPatternOnce(router, "/predictions/1");
        warmChunkOnce("predictions-id", () =>
          import("@/app/(main)/predictions/[id]/page")
        );
        return;
      }

      if (pathname === "/resultats") {
        warmPatternOnce(router, "/resultats/1");
        warmChunkOnce("resultats-id", () =>
          import("@/app/(main)/resultats/[id]/page")
        );
        return;
      }

      if (pathname === "/betslip") {
        warmPatternOnce(router, "/matchs/1");
        warmPatternOnce(router, "/predictions/1");
        warmPatternOnce(router, "/resultats/1");
        warmChunkOnce("matchs-id", () => import("@/app/(main)/matchs/[id]/page"));
        warmChunkOnce("predictions-id", () =>
          import("@/app/(main)/predictions/[id]/page")
        );
      }
    };

    const ric = (
      window as Window & {
        requestIdleCallback?: (
          cb: () => void,
          opts?: { timeout: number }
        ) => number;
        cancelIdleCallback?: (id: number) => void;
      }
    ).requestIdleCallback;

    if (typeof ric === "function") {
      const handle = ric(run, { timeout: 600 });
      return () => {
        (
          window as Window & { cancelIdleCallback?: (id: number) => void }
        ).cancelIdleCallback?.(handle);
      };
    }

    const timer = window.setTimeout(run, 180);
    return () => window.clearTimeout(timer);
  }, [pathname, router]);

  return null;
}
