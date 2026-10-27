import React from "react";
import { StyleSheet, View } from "react-native";
import { AppHeader } from "@/components/app-header";
import { BetModal } from "@/components/bet-modal";
import { BottomNav } from "@/components/bottom-nav";
import { ComboFloatingBar, ComboSheet } from "@/components/combo-slip";
import { MarketSheet } from "@/components/market-sheet";
import { PredictionBetModal } from "@/components/prediction-bet-modal";
import { RechargeModal } from "@/components/recharge-modal";
import { ShareTicketModal } from "@/components/share-ticket-modal";
import { ToastHost } from "@/components/toast-host";
import { COLORS } from "@/theme/tokens";

export function MainShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.root}>
      <AppHeader />
      <View style={styles.body}>{children}</View>
      <ComboFloatingBar />
      <BottomNav />

      <BetModal />
      <PredictionBetModal />
      <MarketSheet />
      <ComboSheet />
      <RechargeModal />
      <ShareTicketModal />
      <ToastHost />
    </View>
  );
}

export default MainShellLayout;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.deep,
  },
  body: {
    flex: 1,
  },
});
