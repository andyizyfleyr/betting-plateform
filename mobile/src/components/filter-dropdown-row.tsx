import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Check, ChevronDown } from "lucide-react-native";
import { COLORS } from "@/theme/tokens";

export interface FilterDropdownOption<T extends string = string> {
  value: T;
  label: string;
  pillLabel?: string;
  count?: number;
}

export interface FilterDropdownDef<T extends string = string> {
  id: string;
  placeholder?: string;
  label?: string;
  value: T;
  defaultValue?: T;
  options: FilterDropdownOption<T>[];
  onChange: (value: T) => void;
}

export function FilterDropdownRow({
  filters,
  onReset,
  resultCountText,
  hasActiveFilters,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filters: FilterDropdownDef<any>[];
  onReset?: () => void;
  resultCountText?: string | null;
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
      <View style={styles.barWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rowContent}
        >
          {filters.map((f) => {
            const defVal = f.defaultValue ?? f.options[0]?.value;
            const isActive = defVal !== undefined && f.value !== defVal;
            const isOpen = openId === f.id;
            const selectedOption = f.options.find((o) => o.value === f.value);
            const fallbackPlaceholder = f.placeholder ?? f.label ?? "Filtre";
            const displayLabel = isActive
              ? (selectedOption?.pillLabel ??
                selectedOption?.label ??
                fallbackPlaceholder)
              : fallbackPlaceholder;

            return (
              <Pressable
                key={f.id}
                onPress={() => setOpenId(isOpen ? null : f.id)}
                style={({ pressed }) => [
                  styles.pill,
                  isActive ? styles.pillActive : styles.pillDefault,
                  pressed && { transform: [{ scale: 0.98 }] },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.pillText,
                    isActive ? styles.pillTextActive : styles.pillTextDefault,
                  ]}
                >
                  {displayLabel}
                </Text>
                <ChevronDown
                  size={16}
                  strokeWidth={2.25}
                  color={
                    isActive
                      ? "rgba(255,255,255,0.95)"
                      : "rgba(55,65,81,0.8)"
                  }
                  style={
                    isOpen ? { transform: [{ rotate: "180deg" }] } : undefined
                  }
                />
              </Pressable>
            );
          })}

          {anyActive && onReset ? (
            <Pressable
              onPress={() => {
                setOpenId(null);
                onReset();
              }}
              style={({ pressed }) => [
                styles.resetBtn,
                pressed && { backgroundColor: "rgba(225,0,20,0.08)" },
              ]}
            >
              <Text style={styles.resetText}>Réinitialiser</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>

      {resultCountText != null ? (
        <Text style={styles.countText}>{resultCountText}</Text>
      ) : null}

      <Modal
        visible={Boolean(activeDef)}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenId(null)}
      >
        <View style={styles.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpenId(null)}
          />
          <View style={styles.menuCard}>
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
                    style={({ pressed }) => [
                      styles.optionItem,
                      selected && styles.optionItemSelected,
                      pressed && !selected && { backgroundColor: COLORS.elev },
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.optionLabel,
                        selected && styles.optionLabelSelected,
                      ]}
                    >
                      {opt.label}
                      {typeof opt.count === "number" ? (
                        <Text
                          style={[
                            styles.optionCount,
                            selected && styles.optionCountSelected,
                          ]}
                        >
                          {` (${opt.count})`}
                        </Text>
                      ) : null}
                    </Text>
                    {selected ? (
                      <Check
                        size={16}
                        strokeWidth={2.5}
                        color={COLORS.betclicRed}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  barWrap: {
    backgroundColor: COLORS.deep,
    paddingVertical: 12,
  },
  rowContent: {
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pill: {
    height: 40,
    flexGrow: 1,
    flexShrink: 0,
    borderRadius: 999,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  pillDefault: {
    backgroundColor: "#e7e9ed",
  },
  pillActive: {
    backgroundColor: COLORS.betclicRed,
    shadowColor: "#e10014",
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  pillText: {
    fontSize: 14,
    fontWeight: "500",
  },
  pillTextDefault: {
    color: "#374151",
  },
  pillTextActive: {
    color: "#ffffff",
  },
  resetBtn: {
    height: 40,
    flexShrink: 0,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  resetText: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.betclicRed,
  },
  countText: {
    marginBottom: 10,
    fontSize: 12.5,
    fontWeight: "500",
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.22)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  menuCard: {
    width: "100%",
    maxWidth: 340,
    maxHeight: 340,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    padding: 6,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
    shadowColor: "#111827",
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  optionsList: {
    maxHeight: 320,
  },
  optionItem: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  optionItemSelected: {
    backgroundColor: "rgba(225, 0, 20, 0.08)",
  },
  optionLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.ink,
  },
  optionLabelSelected: {
    fontWeight: "600",
    color: COLORS.betclicRed,
  },
  optionCount: {
    fontSize: 13,
    fontWeight: "400",
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  optionCountSelected: {
    fontWeight: "600",
    color: "rgba(225, 0, 20, 0.85)",
  },
});
