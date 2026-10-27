import React, { useEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Layers } from "lucide-react-native";
import { ComboSlipBody } from "@/components/combo-slip";
import { useApp, type ComboSelection } from "@/context/app-context";
import { api } from "@/lib/api";
import {
  cacheCouponLocally,
  getLocalCachedCoupon,
  normalizeCouponCode,
} from "@/lib/coupon-code";
import { useLocalSearchParams } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

export default function BetslipScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { comboLegs, loadComboLegs, toast } = useApp();

  useEffect(() => {
    if (!code) return;
    const norm = normalizeCouponCode(code);
    if (!norm) return;
    let active = true;
    (async () => {
      try {
        const res = await api.loadCoupon(norm);
        if (active && res.legs.length > 0) {
          loadComboLegs(res.legs as ComboSelection[]);
          await cacheCouponLocally(res.code, res.legs);
          toast({
            kind: "success",
            title: `Coupon ${res.code} chargé`,
          });
        }
      } catch {
        const local = await getLocalCachedCoupon(norm);
        if (active && local && local.length > 0) {
          loadComboLegs(local as ComboSelection[]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [code, loadComboLegs, toast]);

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerRow}>
        <Layers size={19} color={COLORS.betclicRed} strokeWidth={2.5} />
        <Text style={styles.title}>Betslip</Text>
        {comboLegs.length > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{comboLegs.length}</Text>
          </View>
        ) : null}
      </View>

      <ComboSlipBody inPage />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: COLORS.deep,
  },
  content: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 26,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.ink,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 11.5,
    fontWeight: "800",
    color: "#ffffff",
  },
});
