import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  Trophy,
  X,
} from "lucide-react-native";
import { useApp } from "@/context/app-context";
import { COLORS } from "@/theme/tokens";

export function ToastHost() {
  const { toasts, dismissToast } = useApp();

  if (toasts.length === 0) return null;

  return (
    <SafeAreaView pointerEvents="box-none" edges={["top"]} style={styles.host}>
      <View pointerEvents="box-none" style={styles.stack}>
        {toasts.map((t) => {
          const desc = t.description ?? t.subtitle;
          const Icon =
            t.kind === "win"
              ? Trophy
              : t.kind === "success"
                ? CheckCircle2
                : t.kind === "error"
                  ? AlertCircle
                  : Info;
          const accent =
            t.kind === "win" || t.kind === "success"
              ? COLORS.win
              : t.kind === "error"
                ? COLORS.betclicRed
                : COLORS.ink;

          return (
            <Pressable
              key={t.id}
              onPress={() => dismissToast(t.id)}
              style={styles.toast}
            >
              <Icon size={18} color={accent} strokeWidth={2.4} />
              <View style={styles.textCol}>
                <Text numberOfLines={1} style={styles.title}>
                  {t.title}
                </Text>
                {desc ? (
                  <Text numberOfLines={2} style={styles.desc}>
                    {desc}
                  </Text>
                ) : null}
              </View>
              <X size={14} color={COLORS.dim} strokeWidth={2.2} />
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 52,
    left: 12,
    right: 12,
    zIndex: 999,
  },
  stack: {
    gap: 6,
  },
  toast: {
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    paddingHorizontal: 13,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    elevation: 6,
    shadowColor: "#000000",
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  textCol: {
    flex: 1,
    gap: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.ink,
  },
  desc: {
    fontSize: 11.5,
    fontWeight: "500",
    color: COLORS.mist,
  },
});
