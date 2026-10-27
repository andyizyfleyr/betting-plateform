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
  const [stack, setStack] = useState<RouteEntry[]>(() => [
    parseHref(initialHref),
  ]);

  const current = stack[stack.length - 1] ?? {
    pathname: "/matchs",
    params: {},
  };

  const push = useCallback((href: string) => {
    const next = parseHref(href);
    setStack((prev) => {
      const top = prev[prev.length - 1];
      if (
        top &&
        top.pathname === next.pathname &&
        JSON.stringify(top.params) === JSON.stringify(next.params)
      ) {
        return prev;
      }
      return [...prev.slice(-24), next];
    });
  }, []);

  const replace = useCallback((href: string) => {
    const next = parseHref(href);
    setStack((prev) => {
      if (prev.length === 0) return [next];
      return [...prev.slice(0, -1), next];
    });
  }, []);

  const back = useCallback((fallbackHref?: string) => {
    setStack((prev) => {
      if (prev.length <= 1) {
        const fb = fallbackHref || "/matchs";
        if (prev[0]?.pathname !== fb) {
          return [parseHref(fb)];
        }
        return prev;
      }
      return prev.slice(0, -1);
    });
  }, []);

  // Bouton retour physique Android
  useEffect(() => {
    const onHardwareBack = () => {
      if (stack.length > 1) {
        setStack((prev) => prev.slice(0, -1));
        return true;
      }
      if (current.pathname !== "/matchs" && current.pathname !== "/admin") {
        setStack([{ pathname: "/matchs", params: {} }]);
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
    () => ({ current, push, replace, back }),
    [back, current, push, replace]
  );

  return (
    <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
  );
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

export function Redirect({ href }: { href: string }) {
  const { replace } = useRouter();
  useEffect(() => {
    replace(href);
  }, [href, replace]);
  return null;
}
