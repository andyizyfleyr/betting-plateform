import { NativeModules, TurboModuleRegistry, UIManager } from "react-native";

export interface InAppBrowserOptions {
  title?: string;
  provider?: "stripe" | "paypal";
  providerRef?: string;
  amountLabel?: string;
}

export interface InAppBrowserRequest extends InAppBrowserOptions {
  id: string;
  url: string;
}

export type PaymentReturnEvent =
  | { kind: "cancelled" }
  | { kind: "stripe"; ref: string | null }
  | { kind: "paypal"; token: string | null };

let cachedHasWebView: boolean | null = null;

/**
 * Détecte sans lever d'exception si le composant natif `RNCWebView` / `RNCWebViewModule`
 * est présent dans le binaire Android courant — compatible à la fois avec la Nouvelle
 * Architecture Bridgeless/Fabric (Expo Go SDK 52 via `TurboModuleRegistry`) et avec
 * l'Architecture classique (`NativeModules` / `UIManager.getViewManagerConfig` sur APK natif).
 */
export function hasNativeWebView(): boolean {
  if (cachedHasWebView !== null) return cachedHasWebView;
  try {
    const turboMod =
      typeof TurboModuleRegistry?.get === "function"
        ? TurboModuleRegistry.get("RNCWebViewModule")
        : null;
    const legacyMod =
      NativeModules?.RNCWebViewModule ?? NativeModules?.RNCWebView ?? null;
    const cfg =
      typeof UIManager?.getViewManagerConfig === "function"
        ? UIManager.getViewManagerConfig("RNCWebView")
        : null;
    cachedHasWebView = Boolean(turboMod || legacyMod || cfg);
  } catch {
    cachedHasWebView = false;
  }
  return cachedHasWebView;
}

let activeRequest: InAppBrowserRequest | null = null;
const listeners = new Set<(req: InAppBrowserRequest | null) => void>();

function notify() {
  for (const fn of listeners) {
    try {
      fn(activeRequest);
    } catch {
      /* ignore */
    }
  }
}

export function getActiveInAppUrl(): InAppBrowserRequest | null {
  return activeRequest;
}

export function subscribeInAppUrl(
  listener: (req: InAppBrowserRequest | null) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openInAppUrl(
  rawUrl: string,
  options?: InAppBrowserOptions
): void {
  const url = String(rawUrl ?? "").trim();
  if (!url) return;
  activeRequest = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    url,
    ...options,
  };
  notify();
}

export function closeInAppUrl(): void {
  if (!activeRequest) return;
  activeRequest = null;
  notify();
}

export function extractHostnameLabel(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return u.hostname.replace(/^www\./i, "");
  } catch {
    return "pulse-bet";
  }
}

/**
 * Détecte les URLs de retour Stripe / PayPal (`/parametres?deposit=...`,
 * `/parametres/depot?deposit=...` ou schéma `pulsebets://`) afin de refermer
 * automatiquement le BottomSheet sur place et créditer le solde sans quitter la page.
 */
export function parsePaymentReturnUrl(rawUrl: string): PaymentReturnEvent | null {
  const clean = String(rawUrl ?? "").trim();
  if (!clean) return null;
  try {
    const u = new URL(clean);
    const deposit = u.searchParams.get("deposit");
    const isPulseScheme = u.protocol === "pulsebets:";
    const isParametresPath =
      u.pathname === "/parametres" || u.pathname.startsWith("/parametres/");
    if (!deposit || (!isPulseScheme && !isParametresPath)) {
      return null;
    }
    if (deposit === "cancelled") {
      return { kind: "cancelled" };
    }
    if (deposit === "stripe") {
      return { kind: "stripe", ref: u.searchParams.get("ref") };
    }
    if (deposit === "paypal") {
      return {
        kind: "paypal",
        token: u.searchParams.get("token") ?? u.searchParams.get("ba_token"),
      };
    }
  } catch {
    /* URL partielle ou non standard */
  }
  return null;
}
