import { Platform, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";

/**
 * Palette exacte de `src/app/globals.css` (aucune différence visuelle avec le Web mobile).
 */
export const colors = {
  ink: "#111827",
  deep: "#f4f5f7",
  surface: "#ffffff",
  card: "#ffffff",
  elev: "#f1f3f5",
  edge: "#e5e7eb",
  edgeSoft: "#eef0f3",
  betclicRed: "#e10014",
  betclicRedDeep: "#be0011",
  bittersweet: "#dc2626",
  outerSpace: "#374151",
  live: "#e10014",
  win: "#15803d",
  winSoft: "rgba(21, 128, 61, 0.12)",
  emeraldCreative: "#059669",
  emeraldCreativeDark: "#047857",
  emeraldCreativeLight: "#10b981",
  amber: "#b45309",
  amberSoft: "rgba(245, 158, 11, 0.15)",
  mist: "#4b5563",
  dim: "#6b7280",
  white: "#ffffff",
  black: "#000000",
} as const;

export const cardSurface = StyleSheet.create({
  glassCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.edge,
    borderRadius: 16,
    ...Platform.select({
      android: {
        elevation: 1,
      },
      default: {
        shadowColor: "#111827",
        shadowOpacity: 0.04,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
      },
    }),
  },
  ticketWon: {
    backgroundColor: "#f7fdf9",
    borderWidth: 1,
    borderColor: "rgba(21, 128, 61, 0.30)",
    borderRadius: 16,
  },
});

export function triggerHaptic(
  kind: "light" | "medium" | "success" | "warning" | "error" = "light",
  enabled = true
) {
  if (!enabled) return;
  try {
    if (kind === "light") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (kind === "medium") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else if (kind === "success") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (kind === "warning") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  } catch {
    // Silencieux sur émulateurs sans moteur vibrant
  }
}
