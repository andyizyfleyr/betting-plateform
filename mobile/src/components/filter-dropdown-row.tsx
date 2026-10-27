import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Check, ChevronDown, RotateCcw } from "lucide-react-native";
import { COLORS } from "@/theme/tokens";

export interface FilterDropdownOption<T extends string = string> {
  value: T;
  label: string;
  count?: number;
}

export interface FilterDropdownDef<T extends string = string> {
  id: string;
  label?: string;
  value: T;
  defaultValue?: T;
  options: FilterDropdownOption<T>[];
  onChange: (value: T) => void;
}

export function FilterDropdownRow({
  filters,
  onReset,
  hasActiveFilters,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filters: FilterDropdownDef<any>[];
  onReset?: () => void;
  hasActiveFilters?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const activeDef = filters.find((f) => f.id === openId) ?? null;

  const anyActive =
    hasActiveFilters ??
    filters.some((f) => {
      const defVal = f.defaultValue ?? f.options[0]?.value;
      return defVal !== undefined && f.value !== defVal;
    });

  return (
    <>
      <View style={styles.stickyBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rowContent}
        >
          {filters.map((f) => {
            const defVal = f.defaultValue ?? f.options[0]?.value;
            const isActive = defVal !== undefined && f.value !== defVal;
            const currentOpt =
              f.options.find((o) => o.value === f.value) ?? f.options[0];
            const isOpen = openId === f.id;
            const pillActive = isActive || isOpen;

            return (
              <Pressable
                key={f.id}
                onPress={() => setOpenId(isOpen ? null : f.id)}
                style={[
                  styles.pill,
                  pillActive ? styles.pillActive : styles.pillDefault,
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.pillText,
                    pillActive ? styles.pillTextActive : styles.pillTextDefault,
                  ]}
                >
                  {currentOpt?.label ?? f.label ?? "Tous"}
                </Text>
                <ChevronDown
                  size={15}
                  strokeWidth={2.2}
                  color={pillActive ? "#ffffff" : COLORS.mist}
                  style={isOpen ? { transform: [{ rotate: "180deg" }] } : undefined}
                />
              </Pressable>
            );
          })}

          {anyActive && onReset ? (
            <Pressable onPress={onReset} style={styles.resetPill}>
              <RotateCcw size={13.5} strokeWidth={2.2} color={COLORS.mist} />
              <Text style={styles.resetText}>Réinitialiser</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>

      <Modal
        visible={Boolean(activeDef)}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenId(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpenId(null)}>
          <Pressable
            style={styles.menuSheet}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.grabber} />
            {activeDef?.label ? (
              <Text style={styles.menuTitle}>{activeDef.label}</Text>
            ) : null}
            <ScrollView
              style={styles.optionsList}
              showsVerticalScrollIndicator={false}
            >
              {activeDef?.options.map((opt) => {
                const selected = opt.value === activeDef.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => {
                      activeDef.onChange(opt.value);
                      setOpenId(null);
                    }}
                    style={[
                      styles.optionItem,
                      selected && styles.optionItemSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionLabel,
                        selected && styles.optionLabelSelected,
                      ]}
                    >
                      {opt.label}
                    </Text>
                    <View style={styles.optionRight}>
                      {typeof opt.count === "number" ? (
                        <Text
                          style={[
                            styles.optionCount,
                            selected && styles.optionCountSelected,
                          ]}
                        >
                          {opt.count}
                        </Text>
                      ) : null}
                      {selected ? (
                        <Check
                          size={15}
                          strokeWidth={2.6}
                          color={COLORS.betclicRed}
                        />
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  stickyBar: {
    backgroundColor: COLORS.deep,
    paddingVertical: 6,
  },
  rowContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 4,
  },
  pill: {
    height: 40,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 220,
  },
  pillDefault: {
    backgroundColor: COLORS.pillDefault,
  },
  pillActive: {
    backgroundColor: COLORS.betclicRed,
  },
  pillText: {
    fontSize: 14,
    fontWeight: "500",
    flexShrink: 1,
  },
  pillTextDefault: {
    color: COLORS.ink,
  },
  pillTextActive: {
    color: "#ffffff",
  },
  resetPill: {
    height: 40,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: COLORS.pillDefault,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  resetText: {
    fontSize: 13.5,
    fontWeight: "500",
    color: COLORS.mist,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.36)",
    justifyContent: "flex-end",
  },
  menuSheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 24,
    maxHeight: "68%",
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.edge,
    marginBottom: 10,
  },
  menuTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.dim,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  optionsList: {
    maxHeight: 360,
  },
  optionItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
  },
  optionItemSelected: {
    backgroundColor: "rgba(225, 0, 20, 0.08)",
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.ink,
    flex: 1,
    paddingRight: 8,
  },
  optionLabelSelected: {
    fontWeight: "700",
    color: COLORS.betclicRed,
  },
  optionRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  optionCount: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  optionCountSelected: {
    color: COLORS.betclicRed,
  },
});
