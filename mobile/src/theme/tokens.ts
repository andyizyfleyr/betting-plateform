import * as Haptics from "expo-haptics";

/**
 * Tokens visuels 1:1 de Next.js (`src/app/globals.css`).
 */
export const COLORS = {
  deep: "#f4f5f7",
  surface: "#ffffff",
  card: "#ffffff",
  elev: "#f1f3f5",
  edge: "#e5e7eb",
  edgeSoft: "#eef0f3",
  ink: "#111827",
  mist: "#4b5563",
  dim: "#6b7280",
  betclicRed: "#e10014",
  betclicRedDeep: "#be0011",
  redSoft: "rgba(225, 0, 20, 0.08)",
  redBorder: "rgba(225, 0, 20, 0.25)",
  outerSpace: "#374151",
  live: "#e10014",
  win: "#15803d",
  winSoft: "rgba(21, 128, 61, 0.10)",
  winBorder: "rgba(21, 128, 61, 0.28)",
  emerald: "#10b981",
  emeraldDeep: "#059669",
  amber: "#d97706",
  amberBright: "#f59e0b",
  amberSoft: "rgba(245, 158, 11, 0.12)",
  amberBorder: "rgba(245, 158, 11, 0.30)",
  pillDefault: "#e7e9ed",
  darkSlip: "#111827",
  white: "#ffffff",
  black: "#000000",
} as const;

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
    } else if (kind === "error") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  } catch {
    /* silencieux */
  }
}
