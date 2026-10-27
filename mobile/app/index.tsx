import React from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect } from "@/lib/router";
import { useApp } from "@/context/app-context";
import { COLORS } from "@/theme/tokens";

export default function IndexRedirect() {
  const { authReady, user } = useApp();

  if (!authReady) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: COLORS.deep,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator size="small" color={COLORS.betclicRed} />
      </View>
    );
  }

  if (user?.role === "admin") {
    return <Redirect href="/admin" />;
  }

  return <Redirect href="/matchs" />;
}
