import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Delete } from "lucide-react-native";
import { COLORS, triggerHaptic } from "@/theme/tokens";

const QUICK_AMOUNTS = [5, 10, 25, 50] as const;

export function TouchStakePad({
  value,
  onChange,
  balance,
  isLoggedIn,
  defaultExpanded = false,
  compact = false,
  dark = false,
}: {
  value: string;
  onChange: (next: string) => void;
  balance: number;
  isLoggedIn: boolean;
  defaultExpanded?: boolean;
  compact?: boolean;
  dark?: boolean;
}) {
  const [padOpen, setPadOpen] = useState(defaultExpanded);

  const numericValue = parseFloat((value || "0").replace(",", ".")) || 0;
  const maxBalance = Math.max(0, Math.floor(balance * 100) / 100);

  const appendKey = (key: string) => {
    triggerHaptic("light");
    const clean = value.replace(",", ".");
    if (key === "BACK") {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === ",") {
      if (clean.includes(".")) return;
      onChange((value || "0") + ",");
      return;
    }
    const nextRaw = value === "0" ? key : value + key;
    const parts = nextRaw.replace(",", ".").split(".");
    if (parts[0].length > 5) return;
    if (parts[1] && parts[1].length > 2) return;
    onChange(nextRaw);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <Text style={[styles.label, dark && { color: "rgba(255,255,255,0.72)" }]}>
          Mise (€)
        </Text>
        <View style={styles.chipsRow}>
          {QUICK_AMOUNTS.map((amt) => {
            const active = Math.abs(numericValue - amt) < 0.005;
            return (
              <Pressable
                key={amt}
                onPress={() => {
                  triggerHaptic("light");
                  onChange(String(amt));
                }}
                style={[
                  styles.chip,
                  dark ? styles.chipDark : styles.chipLight,
                  active && styles.chipActive,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    dark && { color: "#ffffff" },
                    active && styles.chipTextActive,
                  ]}
                >
                  {amt} €
                </Text>
              </Pressable>
            );
          })}
          {isLoggedIn && maxBalance > 0 ? (
            <Pressable
              onPress={() => {
                triggerHaptic("light");
                onChange(
                  Number.isInteger(maxBalance)
                    ? String(maxBalance)
                    : maxBalance.toFixed(2).replace(".", ",")
                );
              }}
              style={[
                styles.chip,
                dark ? styles.chipDark : styles.chipLight,
                Math.abs(numericValue - maxBalance) < 0.01 && styles.chipActive,
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  dark && { color: "#ffffff" },
                  Math.abs(numericValue - maxBalance) < 0.01 &&
                    styles.chipTextActive,
                ]}
              >
                MAX
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <Pressable
        onPress={() => {
          triggerHaptic("light");
          setPadOpen((o) => !o);
        }}
        style={[
          styles.displayBox,
          compact && { height: 44 },
          dark ? styles.displayBoxDark : styles.displayBoxLight,
          padOpen && styles.displayBoxFocused,
        ]}
      >
        <Text
          style={[
            styles.displayVal,
            !value && styles.displayPlaceholder,
            dark && { color: value ? "#ffffff" : "rgba(255,255,255,0.4)" },
          ]}
        >
          {value || "0"}
        </Text>
        <View style={styles.displayRight}>
          <Text
            style={[
              styles.euroSign,
              dark && { color: "rgba(255,255,255,0.65)" },
            ]}
          >
            €
          </Text>
          <Text style={styles.toggleHint}>
            {padOpen ? "Masquer" : "Modifier"}
          </Text>
        </View>
      </Pressable>

      {padOpen ? (
        <View style={[styles.padGrid, dark && styles.padGridDark]}>
          {[
            ["1", "2", "3", "BACK"],
            ["4", "5", "6", "00"],
            ["7", "8", "9", ","],
            ["C", "0", "OK"],
          ].map((row, rIdx) => (
            <View key={rIdx} style={styles.padRow}>
              {row.map((k) => {
                const isOk = k === "OK";
                const isClear = k === "C";
                const isBack = k === "BACK";
                return (
                  <Pressable
                    key={k}
                    onPress={() => {
                      if (isOk) {
                        triggerHaptic("light");
                        setPadOpen(false);
                      } else if (isClear) {
                        triggerHaptic("light");
                        onChange("");
                      } else {
                        appendKey(k);
                      }
                    }}
                    style={[
                      styles.keyBtn,
                      isOk && { flex: 2, backgroundColor: COLORS.outerSpace },
                      !isOk && (dark ? styles.keyBtnDark : styles.keyBtnLight),
                    ]}
                  >
                    {isBack ? (
                      <Delete
                        size={17}
                        color={dark ? "#ffffff" : COLORS.ink}
                        strokeWidth={2.2}
                      />
                    ) : (
                      <Text
                        style={[
                          styles.keyText,
                          dark && { color: "#ffffff" },
                          isClear && { color: COLORS.betclicRed },
                          isOk && { color: "#ffffff", fontSize: 13.5 },
                        ]}
                      >
                        {isClear ? "Effacer" : k}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.mist,
  },
  chipsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  chip: {
    height: 28,
    paddingHorizontal: 9,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  chipLight: {
    backgroundColor: COLORS.elev,
  },
  chipDark: {
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  chipActive: {
    backgroundColor: COLORS.betclicRed,
  },
  chipText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  chipTextActive: {
    color: "#ffffff",
  },
  displayBox: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1.5,
  },
  displayBoxLight: {
    backgroundColor: COLORS.elev,
    borderColor: COLORS.edge,
  },
  displayBoxDark: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.16)",
  },
  displayBoxFocused: {
    borderColor: COLORS.betclicRed,
  },
  displayVal: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  displayPlaceholder: {
    color: COLORS.dim,
  },
  displayRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  euroSign: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.mist,
  },
  toggleHint: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.betclicRed,
  },
  padGrid: {
    borderRadius: 14,
    backgroundColor: COLORS.elev,
    padding: 7,
    gap: 6,
  },
  padGridDark: {
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  padRow: {
    flexDirection: "row",
    gap: 6,
  },
  keyBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  keyBtnLight: {
    backgroundColor: "#ffffff",
  },
  keyBtnDark: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  keyText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
});
