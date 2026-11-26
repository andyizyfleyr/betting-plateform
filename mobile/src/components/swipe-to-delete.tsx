import React, { useRef, useState } from "react";
import { Animated, PanResponder, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/theme/tokens";

/**
 * Carte « swipe to delete » façon grandes apps (React Native).
 * Glissement horizontal vers la gauche : suivi direct puis frein progressif
 * (résistance type rubber-band) au-delà du seuil. Le relâchement au-delà du
 * seuil (ou un geste vif) supprime la carte ; sinon retour élastique.
 */
const THRESHOLD = 104;
const MAX_DRAG = 168;
const FLICK_DISTANCE = 56;
const FLICK_VELOCITY = 0.5; // px / ms
const EXIT_X = -460;

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
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  const baseX = useRef(0);
  const startX = useRef(0);
  const onDeleteRef = useRef(onDelete);
  const disabledRef = useRef(Boolean(disabled));
  onDeleteRef.current = onDelete;
  disabledRef.current = Boolean(disabled);

  const snapBack = () => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      speed: 16,
      bounciness: 3,
    }).start();
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        !disabledRef.current &&
        g.dx < -8 &&
        Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
      onPanResponderGrant: () => {
        startX.current = 0;
        // @ts-expect-error — valeur interne d'Animated.Value
        baseX.current = (translateX.__getValue() as number) ?? 0;
        translateX.setValue(baseX.current);
      },
      onPanResponderMove: (_e, g) => {
        const raw = baseX.current + g.dx;
        let next: number;
        if (raw >= -THRESHOLD) {
          next = raw;
        } else {
          const over = -raw - THRESHOLD;
          next = Math.max(EXIT_X + 120, -THRESHOLD - over * 0.4);
        }
        next = Math.max(-MAX_DRAG, Math.min(0, next));
        translateX.setValue(next);

        const nowArmed = next <= -THRESHOLD;
        if (nowArmed !== armedRef.current) {
          armedRef.current = nowArmed;
          setArmed(nowArmed);
          if (nowArmed) triggerHaptic("light");
        }
      },
      onPanResponderRelease: (_e, g) => {
        const raw = baseX.current + g.dx;
        const fastFlick = g.vx <= -FLICK_VELOCITY && raw <= -FLICK_DISTANCE;
        if (raw <= -THRESHOLD || fastFlick) {
          triggerHaptic("warning");
          Animated.timing(translateX, {
            toValue: EXIT_X,
            duration: 190,
            useNativeDriver: true,
          }).start(() => onDeleteRef.current());
          return;
        }
        armedRef.current = false;
        setArmed(false);
        snapBack();
      },
      onPanResponderTerminate: () => {
        armedRef.current = false;
        setArmed(false);
        snapBack();
      },
    })
  ).current;

  return (
    <View style={styles.container}>
      <View style={styles.deleteBg}>
        <View
          style={[
            styles.deleteInner,
            { transform: [{ scale: armed ? 1.08 : 0.96 }] },
          ]}
        >
          <Ionicons name="trash-outline" size={18} color="#ffffff" />
          <Text style={styles.deleteLabel}>Supprimer</Text>
        </View>
      </View>
      <Animated.View
        {...pan.panHandlers}
        style={[styles.front, { transform: [{ translateX }] }]}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 16,
  },
  deleteBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#d1384a",
    alignItems: "flex-end",
    justifyContent: "center",
    paddingRight: 18,
  },
  deleteInner: {
    flexDirection: "row",
    alignItems: "center",
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
