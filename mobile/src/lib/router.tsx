import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { BackHandler } from "react-native";

export interface RouteEntry {
  pathname: string;
  params: Record<string, string>;
}

function parseHref(href: string): RouteEntry {
  const clean = (href || "/matchs").trim();
  const qIdx = clean.indexOf("?");
  const pathname = (qIdx === -1 ? clean : clean.slice(0, qIdx)) || "/matchs";
  const queryStr = qIdx === -1 ? "" : clean.slice(qIdx + 1);
  const params: Record<string, string> = {};

  if (queryStr) {
    for (const part of queryStr.split("&")) {
      if (!part) continue;
      const eq = part.indexOf("=");
      if (eq === -1) {
        params[decodeURIComponent(part)] = "";
      } else {
        params[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(
          part.slice(eq + 1)
        );
      }
    }
  }

  // Extraction automatique de `[id]` pour les routes dynamiques
  const segments = pathname.split("/").filter(Boolean);
  if (
    segments.length === 2 &&
    (segments[0] === "matchs" ||
      segments[0] === "predictions" ||
      segments[0] === "resultats") &&
    segments[1] !== "tous" &&
    segments[1] !== "virtuels"
  ) {
    params.id = segments[1];
  } else if (
    segments.length === 3 &&
    segments[0] === "paris" &&
    (segments[1] === "simple" || segments[1] === "combine")
  ) {
    params.id = segments[2];
  }

  return { pathname, params };
}

interface RouterContextValue {
  current: RouteEntry;
  isNavigating: boolean;
  push: (href: string) => void;
  replace: (href: string) => void;
  back: (fallbackHref?: string) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

export function RouterProvider({
  initialHref = "/",
  children,
}: {
  initialHref?: string;
  children: React.ReactNode;
}) {
  const [routerState, setRouterState] = useState<{
    stack: RouteEntry[];
    isNavigating: boolean;
  }>(() => ({
    stack: [parseHref(initialHref)],
    isNavigating: false,
  }));

  const { stack, isNavigating } = routerState;

  const current = stack[stack.length - 1] ?? {
    pathname: "/matchs",
    params: {},
  };

  useEffect(() => {
    if (!isNavigating) return;
    const t = setTimeout(() => {
      setRouterState((prev) =>
        prev.isNavigating ? { ...prev, isNavigating: false } : prev
      );
    }, 180);
    return () => clearTimeout(t);
  }, [isNavigating, current.pathname, current.params]);

  const push = useCallback((href: string) => {
    const next = parseHref(href);
    setRouterState((prev) => {
      const top = prev.stack[prev.stack.length - 1];
      if (
        top &&
        top.pathname === next.pathname &&
        JSON.stringify(top.params) === JSON.stringify(next.params)
      ) {
        return prev;
      }
      const showLoader =
        !next.pathname.startsWith("/tap") &&
        !next.pathname.startsWith("/accelerator");
      return {
        stack: [...prev.stack.slice(-24), next],
        isNavigating: showLoader,
      };
    });
  }, []);

  const replace = useCallback((href: string) => {
    const next = parseHref(href);
    setRouterState((prev) => {
      const top = prev.stack[prev.stack.length - 1];
      if (
        top &&
        top.pathname === next.pathname &&
        JSON.stringify(top.params) === JSON.stringify(next.params)
      ) {
        return prev;
      }
      const showLoader =
        !next.pathname.startsWith("/tap") &&
        !next.pathname.startsWith("/accelerator");
      return {
        stack: prev.stack.length === 0 ? [next] : [...prev.stack.slice(0, -1), next],
        isNavigating: showLoader,
      };
    });
  }, []);

  const back = useCallback((fallbackHref?: string) => {
    setRouterState((prev) => {
      if (prev.stack.length <= 1) {
        const fb = fallbackHref || "/matchs";
        if (prev.stack[0]?.pathname !== fb) {
          return { stack: [parseHref(fb)], isNavigating: true };
        }
        return prev;
      }
      return { stack: prev.stack.slice(0, -1), isNavigating: false };
    });
  }, []);

  // Bouton retour physique Android
  useEffect(() => {
    const onHardwareBack = () => {
      if (stack.length > 1) {
        setRouterState((prev) => ({
          stack: prev.stack.slice(0, -1),
          isNavigating: false,
        }));
        return true;
      }
      if (current.pathname !== "/matchs" && current.pathname !== "/admin") {
        setRouterState({
          stack: [{ pathname: "/matchs", params: {} }],
          isNavigating: true,
        });
        return true;
      }
      return false;
    };

    const sub = BackHandler.addEventListener(
      "hardwareBackPress",
      onHardwareBack
    );
    return () => sub.remove();
  }, [current.pathname, stack.length]);

  const value = useMemo<RouterContextValue>(
    () => ({ current, isNavigating, push, replace, back }),
    [back, current, isNavigating, push, replace]
  );

  return (
    <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
  );
}

export function useRouterNavigating(): boolean {
  const ctx = useContext(RouterContext);
  return ctx?.isNavigating ?? false;
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter must be used inside RouterProvider");
  return {
    push: ctx.push,
    replace: ctx.replace,
    back: ctx.back,
  };
}

export function usePathname(): string {
  const ctx = useContext(RouterContext);
  return ctx?.current.pathname ?? "/matchs";
}

export function useLocalSearchParams<
  T extends Record<string, string | undefined> = Record<string, string | undefined>,
>(): T {
  const ctx = useContext(RouterContext);
  return (ctx?.current.params ?? {}) as unknown as T;
}

export const useParams = useLocalSearchParams;

export function useSearchParams(): {
  get: (key: string) => string | null;
} {
  const ctx = useContext(RouterContext);
  const params = ctx?.current.params ?? {};
  return useMemo(
    () => ({
      get: (key: string): string | null =>
        Object.prototype.hasOwnProperty.call(params, key) && params[key] !== undefined
          ? params[key]
          : null,
    }),
    [params]
  );
}

export function Redirect({ href }: { href: string }) {
  const { replace } = useRouter();
  useEffect(() => {
    replace(href);
  }, [href, replace]);
  return null;
}
