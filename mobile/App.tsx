import "./src/lib/rn-polyfills";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from "react-native-safe-area-context";
import { AppProvider, useApp } from "@/context/app-context";
import { PulseSplashScreen } from "@/components/pulse-splash-screen";
import { AutoOtaUpdateCoordinator } from "@/lib/ota-updates";
import {
  ensureMobileFocusManagerBound,
  mobileQueryClient,
} from "@/lib/query-client";
import { RouterProvider, usePathname, useRouter } from "@/lib/router";
import { isBiometricModeActive, persistAuthToken, verifyBiometricUnlock } from "@/lib/http";
import { COLORS } from "@/theme/tokens";
import { InAppBrowserSheet } from "@/components/in-app-browser-sheet";
import { ToastHost } from "@/components/toast-host";
import { PushCoordinator } from "@/components/push-coordinator";
import { unregisterPushDevice } from "@/lib/push-notifications";

import IndexRedirect from "./app/index";
import MainShellLayout from "./app/(main)/_layout";
import AuthScreen from "./app/auth";
import MatchsHomeScreen from "./app/(main)/matchs/index";
import TousMatchsScreen from "./app/(main)/matchs/tous";
import VirtuelsMatchsScreen from "./app/(main)/matchs/virtuels";
import MatchDetailScreen from "./app/(main)/matchs/[id]";
import PredictionsListScreen from "./app/(main)/predictions/index";
import PredictionDetailScreen from "./app/(main)/predictions/[id]";
import BetslipScreen from "./app/(main)/betslip";
import ParisScreen from "./app/(main)/paris/index";
import SimpleBetDetailScreen from "./app/(main)/paris/simple/[id]";
import ComboBetDetailScreen from "./app/(main)/paris/combine/[id]";
import ResultatsListScreen from "./app/(main)/resultats/index";
import ResultatDetailScreen from "./app/(main)/resultats/[id]";
import ParametresScreen from "./app/(main)/parametres/index";
import DepotScreen from "./app/(main)/parametres/depot";
import RetraitScreen from "./app/(main)/parametres/retrait";
import TransactionsScreen from "./app/(main)/parametres/transactions";
import JeuxScreen from "./app/(main)/jeux";
import TapGameScreen from "./app/(main)/tap";
import AcceleratorGameScreen from "./app/(main)/accelerator";
import AdminScreen from "./app/(main)/admin";

// Maintient le splash système Android jusqu'au premier rendu du Splash HD React Native
SplashScreen.preventAutoHideAsync().catch(() => {});
ensureMobileFocusManagerBound();

function ActiveScreenSwitch() {
  const pathname = usePathname();
  const isDarkGame = pathname === "/tap" || pathname === "/accelerator";

  if (pathname === "/" || pathname === "") {
    return (
      <>
        <StatusBar style="light" backgroundColor="#090D16" />
        <IndexRedirect />
      </>
    );
  }

  if (pathname === "/auth" || pathname.startsWith("/auth/")) {
    return (
      <View style={styles.authRoot}>
        <StatusBar style="dark" backgroundColor={COLORS.deep} />
        <AuthScreen />
        <InAppBrowserSheet />
        <ToastHost />
      </View>
    );
  }

  let screen: React.ReactNode = null;

  if (pathname === "/matchs") {
    screen = <MatchsHomeScreen />;
  } else if (pathname === "/matchs/tous") {
    screen = <TousMatchsScreen />;
  } else if (pathname === "/matchs/virtuels") {
    screen = <VirtuelsMatchsScreen />;
  } else if (pathname.startsWith("/matchs/")) {
    screen = <MatchDetailScreen />;
  } else if (pathname === "/predictions") {
    screen = <PredictionsListScreen />;
  } else if (pathname.startsWith("/predictions/")) {
    screen = <PredictionDetailScreen />;
  } else if (pathname === "/betslip") {
    screen = <BetslipScreen />;
  } else if (pathname === "/paris") {
    screen = <ParisScreen />;
  } else if (pathname.startsWith("/paris/simple/")) {
    screen = <SimpleBetDetailScreen />;
  } else if (pathname.startsWith("/paris/combine/")) {
    screen = <ComboBetDetailScreen />;
  } else if (pathname === "/resultats") {
    screen = <ResultatsListScreen />;
  } else if (pathname.startsWith("/resultats/")) {
    screen = <ResultatDetailScreen />;
  } else if (pathname === "/parametres") {
    screen = <ParametresScreen />;
  } else if (pathname === "/parametres/depot") {
    screen = <DepotScreen />;
  } else if (pathname === "/parametres/retrait") {
    screen = <RetraitScreen />;
  } else if (pathname === "/parametres/transactions") {
    screen = <TransactionsScreen />;
  } else if (pathname === "/jeux") {
    screen = <JeuxScreen />;
  } else if (pathname === "/tap") {
    screen = <TapGameScreen />;
  } else if (pathname === "/accelerator") {
    screen = <AcceleratorGameScreen />;
  } else if (pathname === "/admin") {
    screen = <AdminScreen />;
  } else {
    screen = <MatchsHomeScreen />;
  }

  return (
    <>
      <StatusBar
        style={isDarkGame ? "light" : "dark"}
        backgroundColor={isDarkGame ? "#020617" : COLORS.white}
      />
      <MainShellLayout>{screen}</MainShellLayout>
    </>
  );
}

function RootBootCoordinator() {
  const { authReady, user, applyUser } = useApp();
  const router = useRouter();
  const [biometricLocked, setBiometricLocked] = useState(false);
  const unlocking = useRef(false);
  const unlock = useCallback(async () => {
    if (unlocking.current) return;
    unlocking.current = true;
    try { if (await verifyBiometricUnlock()) setBiometricLocked(false); } catch { /* l'utilisateur peut réessayer ou utiliser son mot de passe */ }
    finally { unlocking.current = false; }
  }, []);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "background" && user && isBiometricModeActive() && !unlocking.current) setBiometricLocked(true);
      if (state === "active" && biometricLocked) void unlock();
    });
    return () => listener.remove();
  }, [biometricLocked, unlock, user]);
  const usePassword = async () => {
    await unregisterPushDevice().catch(() => {});
    await persistAuthToken(null);
    applyUser(null);
    setBiometricLocked(false);
    router.replace("/auth/connexion");
  };
  const [minSplashDone, setMinSplashDone] = useState(false);
  const [splashMounted, setSplashMounted] = useState(true);
  const nativeHiddenRef = useRef(false);

  const hideNativeSplash = useCallback(() => {
    if (nativeHiddenRef.current) return;
    nativeHiddenRef.current = true;
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    const fallbackHide = setTimeout(hideNativeSplash, 140);
    const minDisplay = setTimeout(() => setMinSplashDone(true), 1150);
    return () => {
      clearTimeout(fallbackHide);
      clearTimeout(minDisplay);
    };
  }, [hideNativeSplash]);

  const splashReadyToExit = authReady && minSplashDone;

  return (
    <View style={styles.root} onLayout={hideNativeSplash}>
      <ActiveScreenSwitch />
      {!splashMounted ? <AutoOtaUpdateCoordinator /> : null}
      {biometricLocked && user ? <View style={{ ...StyleSheet.absoluteFillObject, zIndex: 10000, backgroundColor: "#090D16", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <Text style={{ color: "white", fontSize: 16 }}>Pulse Bet est verrouillé</Text>
        <Pressable onPress={() => void unlock()} style={{ padding: 12 }}><Text style={{ color: "white" }}>Déverrouiller avec la biométrie</Text></Pressable>
        <Pressable onPress={() => void usePassword()} style={{ padding: 12 }}><Text style={{ color: "white" }}>Utiliser le mot de passe</Text></Pressable>
      </View> : null}
      {splashMounted ? (
        <PulseSplashScreen
          exiting={splashReadyToExit}
          onExited={() => setSplashMounted(false)}
        />
      ) : null}
    </View>
  );
}

interface RootErrorBoundaryState {
  hasError: boolean;
}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  RootErrorBoundaryState
> {
  state: RootErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RootErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch() {
    SplashScreen.hideAsync().catch(() => {});
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorBoundaryRoot}>
          <Text style={styles.errorBoundaryTitle}>PULSE BET</Text>
          <Text style={styles.errorBoundaryBody}>
            Une actualisation de l’affichage est nécessaire.
          </Text>
          <Pressable
            onPress={this.handleRetry}
            style={styles.errorBoundaryBtn}
          >
            <Text style={styles.errorBoundaryBtnText}>Réessayer</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <View style={styles.root}>
      <RootErrorBoundary>
        <QueryClientProvider client={mobileQueryClient}>
          <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <RouterProvider initialHref="/">
              <AppProvider>
                <PushCoordinator />
                <RootBootCoordinator />
              </AppProvider>
            </RouterProvider>
          </SafeAreaProvider>
        </QueryClientProvider>
      </RootErrorBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.deep,
  },
  authRoot: {
    flex: 1,
    backgroundColor: COLORS.deep,
  },
  errorBoundaryRoot: {
    flex: 1,
    backgroundColor: "#090D16",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  errorBoundaryTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    fontStyle: "italic",
    marginBottom: 10,
  },
  errorBoundaryBody: {
    color: "#9CA3AF",
    fontSize: 11.5,
    textAlign: "center",
    marginBottom: 20,
  },
  errorBoundaryBtn: {
    backgroundColor: "#E10014",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  errorBoundaryBtnText: {
    color: "#FFFFFF",
    fontSize: 11.5,
    fontWeight: "500",
  },
});
