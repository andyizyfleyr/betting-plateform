import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlertCircle, CheckCircle2, Info, Sparkles, X } from "lucide-react-native";
import { colors } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const { toasts, dismissToast } = useApp();

  if (toasts.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { top: insets.top + 58 }]}
    >
      {toasts.map((t) => {
        const isWin = t.kind === "win";
        const isErr = t.kind === "error";
        const isOk = t.kind === "success";
        return (
          <Pressable
            key={t.id}
            onPress={() => dismissToast(t.id)}
            style={[
              styles.card,
              isWin && styles.cardWin,
              isErr && styles.cardErr,
            ]}
          >
            {isWin ? (
              <Sparkles size={18} color={colors.win} strokeWidth={2.4} />
            ) : isErr ? (
              <AlertCircle size={18} color={colors.betclicRed} strokeWidth={2.4} />
            ) : isOk ? (
              <CheckCircle2 size={18} color={colors.win} strokeWidth={2.4} />
            ) : (
              <Info size={18} color={colors.ink} strokeWidth={2.4} />
            )}
            <View style={styles.body}>
              <Text style={styles.title}>{t.title}</Text>
              {t.subtitle ? (
                <Text numberOfLines={2} style={styles.sub}>
                  {t.subtitle}
                </Text>
              ) : null}
            </View>
            <X size={15} color={colors.dim} strokeWidth={2.3} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 99,
    gap: 8,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.edge,
    paddingHorizontal: 14,
    paddingVertical: 11,
    elevation: 5,
    shadowColor: "#111827",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  cardWin: {
    backgroundColor: "#f0fdf4",
    borderColor: "rgba(21, 128, 61, 0.35)",
  },
  cardErr: {
    backgroundColor: "#fef2f2",
    borderColor: "rgba(225, 0, 20, 0.30)",
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.ink,
  },
  sub: {
    marginTop: 2,
    fontSize: 11.5,
    fontWeight: "500",
    color: colors.mist,
  },
});
