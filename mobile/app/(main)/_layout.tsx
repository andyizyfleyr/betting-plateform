import React from "react";
import { StyleSheet, View } from "react-native";
import { SupportChat } from "@/components/support-chat";
import { AppHeader } from "@/components/app-header";
import { BetModal } from "@/components/bet-modal";
import { BottomNav } from "@/components/bottom-nav";
import { ComboSheet } from "@/components/combo-slip";
import { InAppBrowserSheet } from "@/components/in-app-browser-sheet";
import { MarketSheet } from "@/components/market-sheet";
import { PredictionBetModal } from "@/components/prediction-bet-modal";
import { RechargeModal } from "@/components/recharge-modal";
import { ShareTicketModal } from "@/components/share-ticket-modal";
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
      <BottomNav />

      <BetModal />
      <PredictionBetModal />
      <MarketSheet />
      <ComboSheet />
      <RechargeModal />
      <ShareTicketModal />
      <InAppBrowserSheet />
      {!isFullscreenGame ? <SupportChat /> : null}
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
