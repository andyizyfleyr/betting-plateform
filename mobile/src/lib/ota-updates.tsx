import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { requireOptionalNativeModule } from "expo-modules-core";
import { RefreshCw, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

type ExpoUpdatesApi = typeof import("expo-updates");

interface NativeUpdatesEventPayload {
  context?: {
    isUpdatePending?: boolean;
    isUpdateAvailable?: boolean;
    isDownloading?: boolean;
  };
}

interface OptionalNativeUpdatesEmitter {
  isEnabled?: boolean;
  addListener?: (
    eventName: string,
    listener: (payload: NativeUpdatesEventPayload) => void
  ) => { remove?: () => void };
}

let cachedUpdatesModule: ExpoUpdatesApi | null | undefined;

function getSafeUpdatesModule(): ExpoUpdatesApi | null {
  if (cachedUpdatesModule !== undefined) {
    return cachedUpdatesModule;
  }
  try {
    const nativeMod =
      requireOptionalNativeModule<OptionalNativeUpdatesEmitter>("ExpoUpdates");
    if (!nativeMod) {
      cachedUpdatesModule = null;
      return null;
    }
    // Chargement paresseux uniquement lorsque le module natif ExpoUpdates est compilé dans le binaire
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-updates") as ExpoUpdatesApi;
    cachedUpdatesModule = mod;
    return mod;
  } catch {
    cachedUpdatesModule = null;
    return null;
  }
}

export interface OtaRuntimeDiagnostics {
  isStoreClient: boolean;
  isSupported: boolean;
  isEnabled: boolean;
  isEmbeddedLaunch: boolean;
  updateId: string | null;
  shortUpdateId: string | null;
  runtimeVersion: string;
  channel: string;
  appVersion: string;
  createdAtIso: string | null;
}

export function getOtaRuntimeDiagnostics(): OtaRuntimeDiagnostics {
  const isStoreClient =
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  const appVersion =
    Constants.expoConfig?.version ||
    (Constants.manifest2?.extra?.expoClient as { version?: string } | undefined)
      ?.version ||
    "1.2.4";
  const updates = getSafeUpdatesModule();

  if (!updates) {
    return {
      isStoreClient,
      isSupported: false,
      isEnabled: false,
      isEmbeddedLaunch: true,
      updateId: null,
      shortUpdateId: null,
      runtimeVersion: "pulse-sdk52-v1",
      channel: "production",
      appVersion,
      createdAtIso: null,
    };
  }

  const updateId =
    typeof updates.updateId === "string" && updates.updateId.length > 0
      ? updates.updateId
      : null;

  return {
    isStoreClient,
    isSupported: !__DEV__ && !isStoreClient && Boolean(updates.isEnabled),
    isEnabled: Boolean(updates.isEnabled),
    isEmbeddedLaunch: Boolean(updates.isEmbeddedLaunch),
    updateId,
    shortUpdateId: updateId ? updateId.slice(0, 8) : null,
    runtimeVersion: updates.runtimeVersion || "pulse-sdk52-v1",
    channel: updates.channel || "production",
    appVersion,
    createdAtIso:
      updates.createdAt instanceof Date && !Number.isNaN(updates.createdAt.getTime())
        ? updates.createdAt.toISOString()
        : null,
  };
}

export type ManualOtaResult =
  | { status: "reloaded" }
  | { status: "up_to_date" }
  | { status: "expo_go" }
  | { status: "disabled" }
  | { status: "error"; message: string };

export async function manualCheckAndApplyOtaUpdate(): Promise<ManualOtaResult> {
  const diag = getOtaRuntimeDiagnostics();
  if (diag.isStoreClient) {
    return { status: "expo_go" };
  }
  const updates = getSafeUpdatesModule();
  if (!updates || !updates.isEnabled || __DEV__) {
    return { status: "disabled" };
  }

  try {
    const check = await updates.checkForUpdateAsync();
    if (!check.isAvailable && !check.isRollBackToEmbedded) {
      return { status: "up_to_date" };
    }
    const fetched = await updates.fetchUpdateAsync();
    if (fetched.isNew || fetched.isRollBackToEmbedded) {
      await updates.reloadAsync();
      return { status: "reloaded" };
    }
    return { status: "up_to_date" };
  } catch (err) {
    return {
      status: "error",
      message:
        err instanceof Error && err.message
          ? err.message
          : "Impossible de joindre le serveur OTA.",
    };
  }
}

const MIN_FOREGROUND_CHECK_INTERVAL_MS = 60_000;
const INITIAL_BOOT_CHECK_DELAY_MS = 3_500;

/**
 * Coordinateur OTA silencieux :
 * - Vérifie et pré-télécharge automatiquement les mises à jour au lancement (après le splash)
 *   ainsi qu'à chaque retour au premier plan (`AppState === "active"`).
 * - Détecte également toute mise à jour déjà téléchargée nativement (`checkAutomatically: "ALWAYS"`).
 * - Affiche une bannière discrète pour appliquer en 1 geste sans jamais interrompre un pari en cours,
 *   et applique automatiquement la mise à jour au passage en arrière-plan hors mini-jeu.
 */
export function AutoOtaUpdateCoordinator() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const [updateReady, setUpdateReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [reloading, setReloading] = useState(false);

  const checkingRef = useRef(false);
  const lastCheckAtRef = useRef(0);
  const updateReadyRef = useRef(false);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const markUpdateReady = useCallback(() => {
    if (updateReadyRef.current) return;
    updateReadyRef.current = true;
    setDismissed(false);
    setUpdateReady(true);
  }, []);

  const checkAndPrefetchSilently = useCallback(
    async (force = false) => {
      const diag = getOtaRuntimeDiagnostics();
      if (!diag.isSupported || updateReadyRef.current || checkingRef.current) {
        return;
      }
      const now = Date.now();
      if (!force && now - lastCheckAtRef.current < MIN_FOREGROUND_CHECK_INTERVAL_MS) {
        return;
      }

      const updates = getSafeUpdatesModule();
      if (!updates || !updates.isEnabled) return;

      checkingRef.current = true;
      lastCheckAtRef.current = now;
      try {
        const result = await updates.checkForUpdateAsync();
        if (result.isAvailable || result.isRollBackToEmbedded) {
          const downloaded = await updates.fetchUpdateAsync();
          if (downloaded.isNew || downloaded.isRollBackToEmbedded) {
            markUpdateReady();
          }
        }
      } catch {
        // Silencieux en arrière-plan : la prochaine reprise réseau réessaiera automatiquement
      } finally {
        checkingRef.current = false;
      }
    },
    [markUpdateReady]
  );

  useEffect(() => {
    const diag = getOtaRuntimeDiagnostics();
    if (!diag.isSupported) return;

    const bootTimer = setTimeout(() => {
      void checkAndPrefetchSilently(true);
    }, INITIAL_BOOT_CHECK_DELAY_MS);

    let nativeSub: { remove?: () => void } | null = null;
    try {
      const nativeMod =
        requireOptionalNativeModule<OptionalNativeUpdatesEmitter>("ExpoUpdates");
      if (nativeMod && typeof nativeMod.addListener === "function") {
        nativeSub = nativeMod.addListener(
          "Expo.nativeUpdatesStateChangeEvent",
          (payload) => {
            if (payload?.context?.isUpdatePending) {
              markUpdateReady();
            }
          }
        );
      }
    } catch {
      /* ignore */
    }

    let prevState: AppStateStatus = AppState.currentState;
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      const wasBackground =
        prevState === "background" || prevState === "inactive";
      if (wasBackground && nextState === "active") {
        void checkAndPrefetchSilently(false);
      } else if (
        nextState === "background" &&
        updateReadyRef.current &&
        pathnameRef.current !== "/tap" &&
        pathnameRef.current !== "/accelerator"
      ) {
        const updates = getSafeUpdatesModule();
        if (updates) {
          updates.reloadAsync().catch(() => {});
        }
      }
      prevState = nextState;
    });

    return () => {
      clearTimeout(bootTimer);
      appStateSub.remove();
      try {
        nativeSub?.remove?.();
      } catch {
        /* ignore */
      }
    };
  }, [checkAndPrefetchSilently, markUpdateReady]);

  const handleApplyNow = useCallback(async () => {
    if (reloading) return;
    const updates = getSafeUpdatesModule();
    if (!updates) return;
    setReloading(true);
    try {
      await updates.reloadAsync();
    } catch {
      setReloading(false);
    }
  }, [reloading]);

  if (!updateReady || dismissed) {
    return null;
  }

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlayWrap, { top: Math.max(insets.top + 6, 12) }]}
    >
      <View style={styles.banner}>
        <View style={styles.iconDot}>
          <RefreshCw size={12} color="#ffffff" strokeWidth={2.2} />
        </View>
        <Text numberOfLines={1} style={styles.bannerText}>
          Nouvelle mise à jour prête
        </Text>
        <Pressable
          disabled={reloading}
          onPress={() => void handleApplyNow()}
          style={({ pressed }) => [
            styles.applyBtn,
            pressed && { opacity: 0.88 },
          ]}
        >
          {reloading ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.applyBtnText}>Appliquer</Text>
          )}
        </Pressable>
        <Pressable
          hitSlop={8}
          onPress={() => setDismissed(true)}
          style={styles.closeBtn}
        >
          <X size={13} color="#9CA3AF" strokeWidth={2.1} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayWrap: {
    position: "absolute",
    left: 8,
    right: 8,
    zIndex: 950,
    alignItems: "center",
  },
  banner: {
    width: "100%",
    maxWidth: 420,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "#0F172A",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    shadowColor: "#000000",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  iconDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  bannerText: {
    flex: 1,
    color: "#F8FAFC",
    fontSize: 11,
    fontWeight: "400",
  },
  applyBtn: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  applyBtnText: {
    color: "#FFFFFF",
    fontSize: 10.5,
    fontWeight: "500",
  },
  closeBtn: {
    padding: 3,
    alignItems: "center",
    justifyContent: "center",
  },
});
