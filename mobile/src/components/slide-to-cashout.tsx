import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Check, ChevronsRight } from "lucide-react-native";
import { useOddsTrend } from "./odds-trend-corner";
import { eur } from "@/lib/format";
import { triggerHaptic } from "@/theme/tokens";

const THUMB_WIDTH = 46;
const TRACK_PAD = 5;
const CONFIRM_RELEASE_RATIO = 0.78;
const CONFIRM_SNAP_RATIO = 0.94;

export function SlideToCashOut({
  amount: amountProp,
  amountLabel,
  stake = 0,
  loading = false,
  disabled = false,
  onConfirm,
}: {
  amount?: number;
  amountLabel?: string;
  stake?: number;
  loading?: boolean;
  disabled?: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  const amount =
    typeof amountProp === "number"
      ? amountProp
      : amountLabel
        ? parseFloat(
            amountLabel.replace(/[^\d,.-]/g, "").replace(",", ".")
          ) || 0
        : 0;
  const [trackWidth, setTrackWidth] = useState(0);
  const [readyToConfirm, setReadyToConfirm] = useState(false);
  const [nudge, setNudge] = useState(false);
  const dragX = useRef(new Animated.Value(0)).current;
  const maxTravelRef = useRef(0);
  const triggeredRef = useRef(false);

  const trend = useOddsTrend(amount, 4200);
  const profit = Math.round((amount - stake) * 100) / 100;
  const inProfit = stake > 0 && profit >= 0.01;

  const maxTravel = Math.max(0, trackWidth - THUMB_WIDTH - TRACK_PAD * 2);
  maxTravelRef.current = maxTravel;

  const resetSlider = () => {
    triggeredRef.current = false;
    setReadyToConfirm(false);
    Animated.spring(dragX, {
      toValue: 0,
      useNativeDriver: false,
      bounciness: 5,
    }).start();
  };

  const triggerSell = async () => {
    if (triggeredRef.current || loading || disabled) return;
    triggeredRef.current = true;
    setReadyToConfirm(true);
    triggerHaptic("success");
    Animated.timing(dragX, {
      toValue: maxTravelRef.current,
      duration: 90,
      useNativeDriver: false,
    }).start();
    try {
      await onConfirm();
    } finally {
      setTimeout(() => {
        resetSlider();
      }, 350);
    }
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () =>
          !loading && !disabled && !triggeredRef.current,
        onMoveShouldSetPanResponder: (_, g) =>
          !loading &&
          !disabled &&
          !triggeredRef.current &&
          Math.abs(g.dx) > Math.abs(g.dy) &&
          g.dx > 3,
        onPanResponderGrant: () => {
          triggerHaptic("light");
        },
        onPanResponderMove: (_, g) => {
          const max = maxTravelRef.current;
          if (max <= 0 || triggeredRef.current) return;
          const clamped = Math.max(0, Math.min(max, g.dx));
          dragX.setValue(clamped);
          const ratio = clamped / max;
          setReadyToConfirm(ratio >= CONFIRM_RELEASE_RATIO);
          if (ratio >= CONFIRM_SNAP_RATIO) {
            void triggerSell();
          }
        },
        onPanResponderRelease: (_, g) => {
          const max = maxTravelRef.current;
          if (max <= 0 || triggeredRef.current) return;
          const clamped = Math.max(0, Math.min(max, g.dx));
          const ratio = clamped / max;
          if (ratio >= CONFIRM_RELEASE_RATIO) {
            void triggerSell();
          } else {
            resetSlider();
            if (g.dx < 6) {
              setNudge(true);
              setTimeout(() => setNudge(false), 320);
            }
          }
        },
        onPanResponderTerminate: () => {
          if (!triggeredRef.current) resetSlider();
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disabled, loading]
  );

  const onLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  return (
    <View
      onLayout={onLayout}
      {...panResponder.panHandlers}
      style={[styles.trackOuter, (disabled || loading) && { opacity: 0.85 }]}
    >
      <LinearGradient
        colors={["#047857", "#059669", "#10b981"]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFillObject}
      />

      <View pointerEvents="none" style={styles.topGloss} />

      <Animated.View
        pointerEvents="none"
        style={[
          styles.fillHighlight,
          {
            width: loading
              ? "100%"
              : Animated.add(dragX, THUMB_WIDTH + TRACK_PAD),
          },
        ]}
      />

      <Animated.View
        pointerEvents="none"
        style={[
          styles.thumb,
          {
            transform: [
              {
                translateX: loading ? maxTravel : nudge ? 12 : dragX,
              },
            ],
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#059669" />
        ) : readyToConfirm ? (
          <Check size={18} color="#047857" strokeWidth={3} />
        ) : (
          <ChevronsRight size={20} color="#047857" strokeWidth={2.7} />
        )}
      </Animated.View>

      <View pointerEvents="none" style={styles.contentRow}>
        <View style={styles.leftCol}>
          <Text numberOfLines={1} style={styles.titleText}>
            {loading
              ? "Vente en cours…"
              : readyToConfirm
                ? "Relâchez pour vendre !"
                : "Vendre le coupon"}
          </Text>
          <Text numberOfLines={1} style={styles.subText}>
            {loading
              ? "Crédit immédiat sur le solde"
              : nudge
                ? "Faites glisser le bouton blanc →"
                : "Glisser vers la droite →"}
          </Text>
        </View>

        <View style={styles.rightCol}>
          <View style={styles.amountLine}>
            {trend === "up" ? (
              <Text style={styles.trendUp}>▲</Text>
            ) : trend === "down" ? (
              <Text style={styles.trendDown}>▼</Text>
            ) : null}
            <Text style={styles.amountText}>{eur(amount)}</Text>
          </View>
          {inProfit ? (
            <View style={styles.profitPill}>
              <Text style={styles.profitText}>+{eur(profit)}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  trackOuter: {
    height: 54,
    borderRadius: 16,
    padding: TRACK_PAD,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    shadowColor: "#059669",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  topGloss: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "50%",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  fillHighlight: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(255, 255, 255, 0.20)",
  },
  thumb: {
    position: "absolute",
    top: TRACK_PAD,
    bottom: TRACK_PAD,
    left: TRACK_PAD,
    width: THUMB_WIDTH,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20,
    shadowColor: "#000000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  contentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingLeft: 56,
    paddingRight: 10,
    zIndex: 10,
  },
  leftCol: {
    flex: 1,
    minWidth: 0,
  },
  titleText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#ffffff",
    letterSpacing: -0.2,
  },
  subText: {
    marginTop: 1,
    fontSize: 9.5,
    fontWeight: "500",
    color: "rgba(236, 253, 245, 0.90)",
  },
  rightCol: {
    alignItems: "flex-end",
    justifyContent: "center",
  },
  amountLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  trendUp: {
    fontSize: 9.5,
    color: "#d1fae5",
  },
  trendDown: {
    fontSize: 9.5,
    color: "#fde68a",
  },
  amountText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
  profitPill: {
    marginTop: 2,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.22)",
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  profitText: {
    fontSize: 9.5,
    fontWeight: "500",
    color: "#ffffff",
    fontVariant: ["tabular-nums"],
  },
});
