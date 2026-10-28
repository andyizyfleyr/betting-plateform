import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { ChevronLeft, Lock, RotateCw, X } from "lucide-react-native";
import { useApp } from "@/context/app-context";
import { api, generateIdempotencyKey } from "@/lib/api";
import {
  closeInAppUrl,
  extractHostnameLabel,
  getActiveInAppUrl,
  hasNativeWebView,
  parsePaymentReturnUrl,
  subscribeInAppUrl,
  type InAppBrowserRequest,
  type PaymentReturnEvent,
} from "@/lib/external-url";
import { API_BASE_URL } from "@/lib/http";
import { COLORS } from "@/theme/tokens";

type WebViewInstance = {
  goBack: () => void;
  reload: () => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let CachedWebViewComp: React.ComponentType<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveWebViewComponent(): React.ComponentType<any> | null {
  if (!hasNativeWebView()) return null;
  if (CachedWebViewComp) return CachedWebViewComp;
  try {
    // Chargement paresseux uniquement lorsque `RNCWebView` est présent dans le binaire natif
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-webview");
    CachedWebViewComp = mod?.WebView ?? mod?.default ?? null;
    return CachedWebViewComp;
  } catch {
    return null;
  }
}

export function InAppBrowserSheet() {
  const { applyUser, bumpBets, setBalance, toast } = useApp();
  const [request, setRequest] = useState<InAppBrowserRequest | null>(() =>
    getActiveInAppUrl()
  );
  const [currentUrl, setCurrentUrl] = useState<string>("");
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0.12);

  const webViewRef = useRef<WebViewInstance | null>(null);
  const handledReturnIdRef = useRef<string | null>(null);
  const fallbackRunningIdRef = useRef<string | null>(null);

  const WebViewComp = useMemo(() => resolveWebViewComponent(), []);

  useEffect(() => {
    return subscribeInAppUrl((next) => {
      setRequest(next);
      setCurrentUrl(next?.url ?? "");
      setCanGoBack(false);
      setLoading(Boolean(next));
      setProgress(0.12);
    });
  }, []);

  const refreshWalletAndUser = useCallback(async () => {
    try {
      const [settingsRes, walletRes] = await Promise.all([
        api.settings().catch(() => null),
        api.wallet({ forceRefresh: true }).catch(() => null),
      ]);
      if (settingsRes?.user) {
        applyUser(settingsRes.user);
      } else if (walletRes && typeof walletRes.balance === "number") {
        setBalance(walletRes.balance);
      }
      bumpBets();
    } catch {
      /* silencieux */
    }
  }, [applyUser, bumpBets, setBalance]);

  const confirmStripeDeposit = useCallback(
    async (ref: string, silentIfPending = false) => {
      if (!ref) return;
      if (!silentIfPending) {
        toast({ kind: "info", title: "Confirmation du paiement…" });
      }
      for (let attempt = 0; attempt < (silentIfPending ? 2 : 7); attempt++) {
        try {
          const st = await api.payments.status(ref);
          if (st.credited) {
            await refreshWalletAndUser();
            toast({ kind: "success", title: "Solde rechargé" });
            return;
          }
        } catch {
          /* nouvelle tentative */
        }
        if (attempt < (silentIfPending ? 1 : 6)) {
          await new Promise((r) => setTimeout(r, 1_300));
        }
      }
      if (!silentIfPending) {
        await refreshWalletAndUser();
        toast({
          kind: "info",
          title: "Vérification en cours",
          description: "Votre solde sera mis à jour automatiquement.",
        });
      }
    },
    [refreshWalletAndUser, toast]
  );

  const capturePayPalDeposit = useCallback(
    async (orderId: string) => {
      if (!orderId) return;
      toast({ kind: "info", title: "Validation du paiement…" });
      try {
        const safeToken = orderId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
        const idemKey =
          safeToken.length >= 6
            ? `ppcap_${safeToken}_v1`
            : generateIdempotencyKey("ppcap");
        const r = await api.payments.capturePayPal(orderId, idemKey);
        if (r.user) applyUser(r.user);
        await refreshWalletAndUser();
        toast({ kind: "success", title: "Solde rechargé" });
      } catch {
        toast({ kind: "error", title: "Paiement non confirmé" });
      }
    },
    [applyUser, refreshWalletAndUser, toast]
  );

  const handlePaymentReturn = useCallback(
    (req: InAppBrowserRequest, evt: PaymentReturnEvent) => {
      if (handledReturnIdRef.current === req.id) return;
      handledReturnIdRef.current = req.id;
      closeInAppUrl();

      if (evt.kind === "cancelled") {
        toast({ kind: "info", title: "Paiement annulé" });
        return;
      }
      if (evt.kind === "stripe") {
        const ref = evt.ref || req.providerRef || "";
        void confirmStripeDeposit(ref, false);
        return;
      }
      if (evt.kind === "paypal") {
        const orderId = evt.token || req.providerRef || "";
        void capturePayPalDeposit(orderId);
      }
    },
    [capturePayPalDeposit, confirmStripeDeposit, toast]
  );

  const handleManualClose = useCallback(() => {
    const closingReq = request;
    closeInAppUrl();
    if (
      closingReq &&
      handledReturnIdRef.current !== closingReq.id &&
      closingReq.provider === "stripe" &&
      closingReq.providerRef
    ) {
      handledReturnIdRef.current = closingReq.id;
      void confirmStripeDeposit(closingReq.providerRef, true);
    }
  }, [confirmStripeDeposit, request]);

  // Repli intégré (même tâche Android, sans quitter l'app) si `RNCWebView` est absent d'un ancien APK pré-OTA
  useEffect(() => {
    if (!request || WebViewComp) return;
    if (fallbackRunningIdRef.current === request.id) return;
    fallbackRunningIdRef.current = request.id;
    const activeReq = request;

    void (async () => {
      try {
        const returnUrl = `${API_BASE_URL}/parametres`;
        const res = await WebBrowser.openAuthSessionAsync(
          activeReq.url,
          returnUrl,
          {
            createTask: false,
            showInRecents: false,
            toolbarColor: "#ffffff",
            secondaryToolbarColor: "#eef0f4",
            showTitle: true,
            enableBarCollapsing: false,
          }
        );
        closeInAppUrl();
        if (res.type === "success" && "url" in res && res.url) {
          const parsed = parsePaymentReturnUrl(res.url);
          if (parsed) {
            handlePaymentReturn(activeReq, parsed);
            return;
          }
        }
        if (activeReq.provider === "stripe" && activeReq.providerRef) {
          void confirmStripeDeposit(activeReq.providerRef, true);
        }
      } catch {
        try {
          await WebBrowser.openBrowserAsync(activeReq.url, {
            createTask: false,
            showInRecents: false,
            toolbarColor: "#ffffff",
            secondaryToolbarColor: "#eef0f4",
            showTitle: true,
            enableBarCollapsing: false,
          });
        } catch {
          toast({
            kind: "error",
            title: "Impossible d'ouvrir la page sécurisée",
          });
        } finally {
          closeInAppUrl();
          if (activeReq.provider === "stripe" && activeReq.providerRef) {
            void confirmStripeDeposit(activeReq.providerRef, true);
          }
        }
      }
    })();
  }, [WebViewComp, confirmStripeDeposit, handlePaymentReturn, request, toast]);

  if (!request || !WebViewComp) return null;

  const screenHeight = Dimensions.get("window").height;
  const sheetHeight = Math.round(screenHeight * 0.88);
  const hostLabel = extractHostnameLabel(currentUrl || request.url);
  const headerTitle = request.title || hostLabel;

  const interceptNavigationUrl = (navUrl?: string): boolean => {
    if (!navUrl) return true;
    const ret = parsePaymentReturnUrl(navUrl);
    if (ret) {
      handlePaymentReturn(request, ret);
      return false;
    }
    if (
      !navUrl.startsWith("http://") &&
      !navUrl.startsWith("https://") &&
      !navUrl.startsWith("about:") &&
      !navUrl.startsWith("blob:") &&
      !navUrl.startsWith("data:")
    ) {
      return false;
    }
    return true;
  };

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (canGoBack && webViewRef.current) {
          webViewRef.current.goBack();
          return;
        }
        handleManualClose();
      }}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleManualClose} />

        <View style={[styles.sheet, { height: sheetHeight }]}>
          <View style={styles.grabberRow}>
            <View style={styles.grabber} />
          </View>

          <View style={styles.toolbar}>
            <View style={styles.toolbarSide}>
              <Pressable
                disabled={!canGoBack}
                onPress={() => webViewRef.current?.goBack()}
                style={[
                  styles.iconBtn,
                  !canGoBack && { opacity: 0.32 },
                ]}
              >
                <ChevronLeft size={17} color={COLORS.ink} strokeWidth={2.2} />
              </Pressable>
            </View>

            <View style={styles.titleCol}>
              <Text numberOfLines={1} style={styles.sheetTitle}>
                {headerTitle}
              </Text>
              <View style={styles.hostRow}>
                <Lock size={10} color={COLORS.win} strokeWidth={2.4} />
                <Text numberOfLines={1} style={styles.hostText}>
                  {hostLabel}
                </Text>
              </View>
            </View>

            <View style={[styles.toolbarSide, styles.toolbarRight]}>
              <Pressable
                onPress={() => webViewRef.current?.reload()}
                style={styles.iconBtn}
              >
                <RotateCw size={14} color={COLORS.mist} strokeWidth={2.2} />
              </Pressable>
              <Pressable onPress={handleManualClose} style={styles.closeBtn}>
                <X size={16} color={COLORS.ink} strokeWidth={2.3} />
              </Pressable>
            </View>
          </View>

          {loading ? (
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.max(10, Math.min(100, Math.round(progress * 100)))}%`,
                  },
                ]}
              />
            </View>
          ) : (
            <View style={styles.toolbarDivider} />
          )}

          <View style={styles.webWrap}>
            <WebViewComp
              ref={webViewRef}
              source={{ uri: request.url }}
              javaScriptEnabled
              domStorageEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              setSupportMultipleWindows={false}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.initialLoader}>
                  <ActivityIndicator size="small" color={COLORS.betclicRed} />
                </View>
              )}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              onLoadProgress={(e: { nativeEvent?: { progress?: number } }) => {
                const p = e?.nativeEvent?.progress ?? 0;
                setProgress(p);
                if (p >= 0.99) setLoading(false);
              }}
              onShouldStartLoadWithRequest={(reqEvt: { url?: string }) =>
                interceptNavigationUrl(reqEvt?.url)
              }
              onNavigationStateChange={(navState: {
                url?: string;
                canGoBack?: boolean;
                loading?: boolean;
              }) => {
                if (typeof navState?.canGoBack === "boolean") {
                  setCanGoBack(navState.canGoBack);
                }
                if (navState?.url) {
                  setCurrentUrl(navState.url);
                  interceptNavigationUrl(navState.url);
                }
              }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(9, 13, 22, 0.54)",
  },
  sheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: "hidden",
  },
  grabberRow: {
    paddingTop: 8,
    paddingBottom: 4,
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#d1d5db",
  },
  toolbar: {
    height: 44,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#ffffff",
  },
  toolbarSide: {
    width: 72,
    flexDirection: "row",
    alignItems: "center",
  },
  toolbarRight: {
    justifyContent: "flex-end",
    gap: 6,
  },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  titleCol: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  sheetTitle: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.ink,
  },
  hostRow: {
    marginTop: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 3.5,
  },
  hostText: {
    fontSize: 9.5,
    fontWeight: "400",
    color: COLORS.dim,
  },
  progressTrack: {
    height: 2.5,
    backgroundColor: COLORS.edge,
    width: "100%",
  },
  progressFill: {
    height: 2.5,
    backgroundColor: COLORS.betclicRed,
  },
  toolbarDivider: {
    height: 1,
    backgroundColor: COLORS.edge,
  },
  webWrap: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  initialLoader: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
});
