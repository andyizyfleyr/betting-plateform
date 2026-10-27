import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProvider } from "@/context/app-context";
import { colors } from "@/theme/tokens";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.deep }}>
      <SafeAreaProvider>
        <AppProvider>
          <StatusBar style="dark" backgroundColor={colors.white} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.deep },
              animation: "fade_from_bottom",
            }}
          />
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
