import React from "react";
import { StyleSheet, View } from "react-native";
import { AppHeader } from "@/components/app-header";
import { BetModal } from "@/components/bet-modal";
import { BottomNav } from "@/components/bottom-nav";
import { ComboFloatingBar, ComboSheet } from "@/components/combo-slip";
import { InAppBrowserSheet } from "@/components/in-app-browser-sheet";
import { MarketSheet } from "@/components/market-sheet";
import { PredictionBetModal } from "@/components/prediction-bet-modal";
import { RechargeModal } from "@/components/recharge-modal";
import { ShareTicketModal } from "@/components/share-ticket-modal";
import { ToastHost } from "@/components/toast-host";
import { usePathname } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

export function MainShellLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFullscreenGame =
    pathname.startsWith("/tap") || pathname.startsWith("/accelerator");

  return (
    <View style={styles.root}>
      {!isFullscreenGame ? <AppHeader /> : null}
      <View style={styles.body}>{children}</View>
      {!isFullscreenGame ? <ComboFloatingBar /> : null}
      <BottomNav />

      <BetModal />
      <PredictionBetModal />
      <MarketSheet />
      <ComboSheet />
      <RechargeModal />
      <ShareTicketModal />
      <InAppBrowserSheet />
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
