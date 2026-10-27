import "./src/lib/sdk42-compat";
import React from "react";
import { StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProvider } from "@/context/app-context";
import { Redirect, RouterProvider, usePathname } from "@/lib/router";
import { colors } from "@/theme/tokens";
import { ToastHost } from "@/components/toast-host";

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

function ActiveScreenSwitch() {
  const pathname = usePathname();

  if (pathname === "/" || pathname === "") {
    return <Redirect href="/matchs" />;
  }

  if (pathname === "/auth") {
    return (
      <View style={styles.authRoot}>
        <AuthScreen />
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

  return <MainShellLayout>{screen}</MainShellLayout>;
}

export default function App() {
  return (
    <View style={styles.root}>
      <SafeAreaProvider>
        <RouterProvider initialHref="/matchs">
          <AppProvider>
            <StatusBar style="dark" backgroundColor={colors.white} />
            <ActiveScreenSwitch />
          </AppProvider>
        </RouterProvider>
      </SafeAreaProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.deep,
  },
  authRoot: {
    flex: 1,
    backgroundColor: colors.deep,
  },
});
