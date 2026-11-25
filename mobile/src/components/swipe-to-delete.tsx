import React, { useRef } from "react";
import { Animated, PanResponder, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

/**
 * Cartes « swipe to delete » façon grandes apps (React Native).
 * Un glissement horizontal vers la gauche (résistance douce) dévoile un fond
 * « Supprimer » ; au-delà d'un seuil le relâchement déclenche la suppression.
 */
export function SwipeToDelete({
  children,
  onDelete,
  disabled,
}: {
  children: React.ReactNode;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const baseX = useRef(0);
  const startX = useRef(0);

  const SWIPE_THRESHOLD = 110;
  const MAX_DRAG = 260;

  const pan = useRef(
    PanResponder.create({
      onPanResponderGrant: (_e, g) => {
        startX.current = g.x;
        baseX.current = translateX.__getValue() as number;
        translateX.setValue(baseX.current);
      },
      onPanResponderMove: (_e, g) => {
        let next = baseX.current + (g.x - startX.current);
        // résistance douce au-delà du seuil
        const over = -next - SWIPE_THRESHOLD;
        if (over > 0) next = -SWIPE_THRESHOLD - Math.min(over, 120) * 0.35;
        next = Math.max(-MAX_DRAG, Math.min(0, next));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_e, g) => {
        const v = baseX.current + (g.x - startX.current);
        if (v <= -SWIPE_THRESHOLD) {
          onDelete();
        } else {
          translateX.setValue(0);
        }
      },
      onPanResponderTerminate: () => {
        translateX.setValue(0);
      },
    })
  ).current;

  return (
    <View style={styles.container}>
      <View style={[styles.deleteBg, { opacity: disabled ? 0.4 : 1 }]}>
        <Ionicons name="trash-outline" size={18} color="#ffffff" />
        <Text style={styles.deleteLabel}>Supprimer</Text>
      </View>
      <Animated.View {...pan.panHandlers} style={[styles.front, { transform: [{ translateX }] }]}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
    overflow: "hidden",
  },
  deleteBg: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: 132,
    backgroundColor: "#d1384a",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  deleteLabel: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "500",
  },
  front: {
    position: "relative",
  },
});
