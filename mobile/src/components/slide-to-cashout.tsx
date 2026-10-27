import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronsRight, Sparkles } from "lucide-react-native";
import { eur } from "@/lib/format";
import { colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

/**
 * `SlideToCashOut` vert créatif émeraude (`#10b981 -> #059669 -> #047857`)
 * fidèle à 100 % à `src/components/slide-to-cashout.tsx` :
 * - Glisser horizontalement sur Android (seuil 80 %) OU appui franc sur le bouton « Vendre ».
 */
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
  const { hapticsEnabled } = useApp();
  const [trackWidth, setTrackWidth] = useState(260);
  const dragX = useRef(new Animated.Value(0)).current;
  const maxSlide = Math.max(48, trackWidth - 54);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !loading && !disabled,
        onMoveShouldSetPanResponder: (_, g) =>
          !loading && !disabled && Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: (_, g) => {
          const clamped = Math.max(0, Math.min(maxSlide, g.dx));
          dragX.setValue(clamped);
        },
        onPanResponderRelease: (_, g) => {
          if (g.dx >= maxSlide * 0.78) {
            triggerHaptic("success", hapticsEnabled);
            Animated.spring(dragX, {
              toValue: maxSlide,
              useNativeDriver: true,
            }).start(() => {
              dragX.setValue(0);
              void onConfirm();
            });
          } else {
            Animated.spring(dragX, {
              toValue: 0,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [disabled, dragX, hapticsEnabled, loading, maxSlide, onConfirm]
  );

  return (
    <View
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      style={[styles.outer, disabled && styles.outerDisabled]}
    >
      <LinearGradient
        colors={["#10b981", "#059669", "#047857"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.track}
      >
        <View style={styles.centerContent}>
          <View style={styles.labelRow}>
            <Sparkles size={13} color="#d1fae5" strokeWidth={2.4} />
            <Text style={styles.titleText}>
              {loading ? "Encaissement…" : `Vendre · ${eur(amount)}`}
            </Text>
          </View>
          <Text style={styles.hintText}>Glisser ou appuyer pour encaisser</Text>
        </View>

        <Pressable
          disabled={loading || disabled}
          onPress={() => {
            triggerHaptic("medium", hapticsEnabled);
            void onConfirm();
          }}
          style={styles.quickBtn}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#047857" />
          ) : (
            <Text style={styles.quickBtnText}>Vendre</Text>
          )}
        </Pressable>

        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.thumb,
            {
              transform: [{ translateX: dragX }],
            },
          ]}
        >
          <ChevronsRight size={20} color="#047857" strokeWidth={2.8} />
        </Animated.View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    borderRadius: 14,
    overflow: "hidden",
    elevation: 2,
    shadowColor: "#047857",
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  outerDisabled: {
    opacity: 0.55,
  },
  track: {
    height: 48,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 54,
    paddingRight: 8,
    position: "relative",
  },
  thumb: {
    position: "absolute",
    left: 4,
    top: 4,
    width: 40,
    height: 40,
    borderRadius: 11,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  centerContent: {
    flex: 1,
    paddingHorizontal: 6,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  titleText: {
    fontSize: 13.5,
    fontWeight: "900",
    color: colors.white,
    fontVariant: ["tabular-nums"],
  },
  hintText: {
    fontSize: 10,
    fontWeight: "600",
    color: "rgba(236, 253, 245, 0.85)",
  },
  quickBtn: {
    height: 32,
    paddingHorizontal: 11,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.94)",
    alignItems: "center",
    justifyContent: "center",
  },
  quickBtnText: {
    fontSize: 11.5,
    fontWeight: "900",
    color: "#047857",
  },
});
