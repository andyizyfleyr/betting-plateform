import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Delete, Keyboard as KeyboardIcon } from "@/components/icons";
import { eur } from "@/lib/format";
import { colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

const KEYPAD_ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [",", "0", "DEL"],
] as const;

/**
 * Pavé de mise tactile (`TouchStakePad`) fidèle à `src/components/touch-stake-pad.tsx` :
 * - Chips rapides (`5 €`, `10 €`, `25 €`, `50 €` ou presets personnalisés) + `Tout`
 * - Pavé numérique repliable sans déclencher le clavier système Android.
 */
export function TouchStakePad({
  stake,
  onChangeStake,
  maxBalance,
  presets,
  defaultExpanded = false,
}: {
  stake: number;
  onChangeStake: (val: number) => void;
  maxBalance: number;
  presets: number[];
  defaultExpanded?: boolean;
}) {
  const { hapticsEnabled } = useApp();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [rawStr, setRawStr] = useState<string>(
    stake > 0 ? String(stake).replace(".", ",") : "10"
  );

  const applyValue = (next: number) => {
    const clamped = Math.max(0, Math.min(10_000, Math.round(next * 100) / 100));
    onChangeStake(clamped);
    setRawStr(clamped > 0 ? String(clamped).replace(".", ",") : "");
  };

  const handleKeyPress = (k: string) => {
    triggerHaptic("light", hapticsEnabled);
    if (k === "DEL") {
      const nextStr = rawStr.slice(0, -1);
      setRawStr(nextStr);
      const num = parseFloat(nextStr.replace(",", ".")) || 0;
      onChangeStake(Math.min(10_000, Math.round(num * 100) / 100));
      return;
    }
    if (k === ",") {
      if (rawStr.includes(",")) return;
      const nextStr = (rawStr || "0") + ",";
      setRawStr(nextStr);
      return;
    }
    const parts = rawStr.split(",");
    if (parts[1] && parts[1].length >= 2) return;
    const nextStr = rawStr === "0" ? k : rawStr + k;
    const num = parseFloat(nextStr.replace(",", ".")) || 0;
    if (num > 10_000) return;
    setRawStr(nextStr);
    onChangeStake(Math.round(num * 100) / 100);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => {
          triggerHaptic("light", hapticsEnabled);
          setExpanded((v) => !v);
        }}
        style={styles.displayBox}
      >
        <View>
          <Text style={styles.displayLabel}>Votre mise</Text>
          <Text style={styles.displayValue}>
            {rawStr ? `${rawStr} €` : eur(stake)}
          </Text>
        </View>
        <View style={styles.kbdToggle}>
          <KeyboardIcon size={15} color={colors.ink} strokeWidth={2.2} />
          <Text style={styles.kbdToggleText}>
            {expanded ? "Masquer" : "Clavier"}
          </Text>
        </View>
      </Pressable>

      <View style={styles.presetsRow}>
        {presets.slice(0, 4).map((p) => {
          const active = Math.abs(stake - p) < 0.005;
          return (
            <Pressable
              key={p}
              onPress={() => {
                triggerHaptic("light", hapticsEnabled);
                applyValue(p);
              }}
              style={[styles.presetChip, active && styles.presetChipActive]}
            >
              <Text
                style={[styles.presetText, active && styles.presetTextActive]}
              >
                {p} €
              </Text>
            </Pressable>
          );
        })}

        {maxBalance > 0 && (
          <Pressable
            onPress={() => {
              triggerHaptic("light", hapticsEnabled);
              applyValue(Math.min(maxBalance, 5_000));
            }}
            style={styles.allInChip}
          >
            <Text style={styles.allInText}>Tout</Text>
          </Pressable>
        )}
      </View>

      {expanded && (
        <View style={styles.keypad}>
          {KEYPAD_ROWS.map((row, ri) => (
            <View key={ri} style={styles.keypadRow}>
              {row.map((key) => (
                <Pressable
                  key={key}
                  onPress={() => handleKeyPress(key)}
                  style={styles.keyBtn}
                >
                  {key === "DEL" ? (
                    <Delete size={17} color={colors.ink} strokeWidth={2.3} />
                  ) : (
                    <Text style={styles.keyText}>{key}</Text>
                  )}
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  displayBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.elev,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.edge,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  displayLabel: {
    fontSize: 10.5,
    fontWeight: "600",
    color: colors.dim,
  },
  displayValue: {
    marginTop: 1,
    fontSize: 17,
    fontWeight: "900",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  kbdToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.edge,
  },
  kbdToggleText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: colors.ink,
  },
  presetsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  presetChip: {
    flex: 1,
    height: 34,
    borderRadius: 9,
    backgroundColor: colors.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  presetChipActive: {
    backgroundColor: colors.ink,
  },
  presetText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: colors.ink,
  },
  presetTextActive: {
    color: colors.white,
  },
  allInChip: {
    height: 34,
    paddingHorizontal: 11,
    borderRadius: 9,
    backgroundColor: "rgba(225, 0, 20, 0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  allInText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.betclicRed,
  },
  keypad: {
    gap: 6,
    marginTop: 2,
  },
  keypadRow: {
    flexDirection: "row",
    gap: 6,
  },
  keyBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  keyText: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.ink,
  },
});
