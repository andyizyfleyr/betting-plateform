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
import { eur } from "@/lib/format";
import { triggerHaptic } from "@/theme/tokens";

const THUMB_SIZE = 38;
const TRACK_PAD = 4;

export function SlideToCashOut({
  amount,
  loading = false,
  disabled = false,
  onConfirm,
}: {
  amount: number;
  loading?: boolean;
  disabled?: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [completed, setCompleted] = useState(false);
  const dragX = useRef(new Animated.Value(0)).current;
  const maxTravelRef = useRef(0);
  const triggeredRef = useRef(false);

  const maxTravel = Math.max(0, trackWidth - THUMB_SIZE - TRACK_PAD * 2);
  maxTravelRef.current = maxTravel;

  const resetSlider = () => {
    triggeredRef.current = false;
    setCompleted(false);
    Animated.spring(dragX, {
      toValue: 0,
      useNativeDriver: false,
      bounciness: 5,
    }).start();
  };

  const triggerSell = async () => {
    if (triggeredRef.current || loading || disabled) return;
    triggeredRef.current = true;
    setCompleted(true);
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
      }, 450);
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
          if (clamped / max >= 0.94) {
            void triggerSell();
          }
        },
        onPanResponderRelease: (_, g) => {
          const max = maxTravelRef.current;
          if (max <= 0 || triggeredRef.current) return;
          const ratio = Math.max(0, Math.min(max, g.dx)) / max;
          if (ratio >= 0.78) {
            void triggerSell();
          } else {
            resetSlider();
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
      style={[styles.trackOuter, (disabled || loading) && { opacity: 0.78 }]}
    >
      <LinearGradient
        colors={["#059669", "#10b981", "#0d9488"]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFillObject}
      />

      <Animated.View
        pointerEvents="none"
        style={[
          styles.fillHighlight,
          {
            width: Animated.add(dragX, THUMB_SIZE + TRACK_PAD),
          },
        ]}
      />

      <View pointerEvents="none" style={styles.centerCopy}>
        <Text numberOfLines={1} style={styles.label}>
          {loading || completed
            ? "Validation du Cash Out…"
            : `Glisser pour vendre · ${eur(amount)}`}
        </Text>
      </View>

      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.thumb,
          {
            transform: [{ translateX: dragX }],
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#059669" />
        ) : completed ? (
          <Check size={18} color="#059669" strokeWidth={2.8} />
        ) : (
          <ChevronsRight size={19} color="#059669" strokeWidth={2.6} />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  trackOuter: {
    height: 46,
    borderRadius: 14,
    padding: TRACK_PAD,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
  },
  fillHighlight: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
  },
  centerCopy: {
    position: "absolute",
    left: THUMB_SIZE + 12,
    right: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: 0.1,
    fontVariant: ["tabular-nums"],
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 11,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
});
