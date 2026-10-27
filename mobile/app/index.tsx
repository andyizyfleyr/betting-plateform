import React from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";
import { useApp } from "@/context/app-context";
import { colors } from "@/theme/tokens";

export default function IndexRedirect() {
  const { authReady, user } = useApp();

  if (!authReady) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.deep,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator size="small" color={colors.betclicRed} />
      </View>
    );
  }

  if (user?.role === "admin") {
    return <Redirect href="/admin" />;
  }

  return <Redirect href="/matchs" />;
}
