import React from "react";
import { StyleSheet, View } from "react-native";
import { Slot } from "expo-router";
import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { MarketSheet } from "@/components/market-sheet";
import { BetModal } from "@/components/bet-modal";
import { PredictionBetModal } from "@/components/prediction-bet-modal";
import { RechargeModal } from "@/components/recharge-modal";
import { ShareTicketModal } from "@/components/share-ticket-modal";
import { ToastHost } from "@/components/toast-host";
import { colors } from "@/theme/tokens";

export default function MainShellLayout() {
  return (
    <View style={styles.root}>
      <AppHeader />
      <View style={styles.body}>
        <Slot />
      </View>
      <BottomNav />

      {/* Modales et feuilles globales partagées */}
      <MarketSheet />
      <BetModal />
      <PredictionBetModal />
      <RechargeModal />
      <ShareTicketModal />
      <ToastHost />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.deep,
  },
  body: {
    flex: 1,
  },
});
