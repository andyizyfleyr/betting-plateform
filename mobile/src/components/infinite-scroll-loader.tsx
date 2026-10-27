import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { COLORS } from "@/theme/tokens";

export const INFINITE_BATCH_SIZE = 10;

export function useInfiniteBatch<T>(
  items: readonly T[],
  batchSize = INFINITE_BATCH_SIZE,
  resetKey?: string
) {
  const [visibleCount, setVisibleCount] = useState(batchSize);

  useEffect(() => {
    setVisibleCount(batchSize);
  }, [batchSize, resetKey]);

  const hasMore = visibleCount < items.length;
  const visibleItems = items.slice(0, visibleCount);

  const loadMore = useCallback(() => {
    setVisibleCount((prev) =>
      prev < items.length ? Math.min(items.length, prev + batchSize) : prev
    );
  }, [batchSize, items.length]);

  const onScrollCheck = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!hasMore) return;
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 260) {
        loadMore();
      }
    },
    [hasMore, loadMore]
  );

  return { visibleItems, hasMore, loadMore, onScrollCheck };
}

/**
 * Spinner pur sans texte « Chargement… » (par bon de 10).
 */
export function InfiniteScrollLoader({ hasMore }: { hasMore: boolean }) {
  if (!hasMore) return null;
  return (
    <View style={styles.wrap} accessibilityLabel="Chargement de la suite">
      <ActivityIndicator size="small" color={COLORS.betclicRed} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
