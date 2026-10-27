import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { colors } from "@/theme/tokens";

export const INFINITE_BATCH_STEP = 10;

export function useInfiniteBatch(
  totalCount: number,
  resetKey: string,
  step = INFINITE_BATCH_STEP
) {
  const [visibleCount, setVisibleCount] = useState(step);

  useEffect(() => {
    setVisibleCount(step);
  }, [resetKey, step]);

  const hasMore = visibleCount < totalCount;

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => {
      if (prev >= totalCount) return prev;
      return Math.min(totalCount, prev + step);
    });
  }, [step, totalCount]);

  return { visibleCount, hasMore, loadMore };
}

export function sliceThreeSections<A, B, C>(
  a: readonly A[],
  b: readonly B[],
  c: readonly C[],
  budget: number
): { aSlice: A[]; bSlice: B[]; cSlice: C[] } {
  let rem = Math.max(0, budget);
  const aSlice = a.slice(0, rem);
  rem -= aSlice.length;
  const bSlice = b.slice(0, rem);
  rem -= bSlice.length;
  const cSlice = c.slice(0, rem);
  return { aSlice, bSlice, cSlice };
}

/**
 * Uniquement le spinner nu (sans texte « Chargement… »), conformément à la règle UX stricte.
 */
export function BareInfiniteSpinner({ visible = true }: { visible?: boolean }) {
  if (!visible) return null;
  return (
    <View style={styles.wrap} accessibilityLabel="Chargement">
      <ActivityIndicator size="small" color={colors.betclicRed} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});
