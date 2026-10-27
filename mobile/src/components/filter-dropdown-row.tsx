import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Check, ChevronDown, RotateCcw, X } from "lucide-react-native";
import { colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

export interface FilterOptionItem {
  value: string;
  label: string;
  count?: number;
}

export interface FilterDropdownConfig {
  id: string;
  label: string;
  value: string;
  defaultValue?: string;
  options: FilterOptionItem[];
  onChange: (value: string) => void;
}

/**
 * Barre de filtres mobile unifiée (`FilterDropdownRow`) :
 * - 1 seule ligne sticky de pills `40 px`, sans bordure, `14 px` medium, `gap: 8 px`
 * - Fond gris `#f1f3f5` par défaut, rouge `#e10014` lorsqu'un filtre est actif
 * - Action `Réinitialiser` en fin de ligne + compteur de résultats juste en dessous.
 */
export function FilterDropdownRow({
  filters,
  onReset,
  resultCountLabel,
}: {
  filters: FilterDropdownConfig[];
  onReset?: () => void;
  resultCountLabel?: string;
}) {
  const { hapticsEnabled } = useApp();
  const [openFilterId, setOpenFilterId] = useState<string | null>(null);

  const activeFilter = filters.find((f) => f.id === openFilterId) ?? null;
  const hasAnyActive = filters.some(
    (f) => f.value !== (f.defaultValue ?? "all")
  );

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollRow}
      >
        {filters.map((f) => {
          const defaultVal = f.defaultValue ?? "all";
          const isActive = f.value !== defaultVal;
          const selectedOpt = f.options.find((o) => o.value === f.value);
          const displayLabel = isActive
            ? (selectedOpt?.label ?? f.label)
            : f.label;

          return (
            <Pressable
              key={f.id}
              onPress={() => {
                triggerHaptic("light", hapticsEnabled);
                setOpenFilterId(f.id);
              }}
              style={[styles.pill, isActive && styles.pillActive]}
            >
              <Text
                numberOfLines={1}
                style={[styles.pillText, isActive && styles.pillTextActive]}
              >
                {displayLabel}
              </Text>
              <ChevronDown
                size={15}
                color={isActive ? colors.white : colors.mist}
                strokeWidth={2.4}
              />
            </Pressable>
          );
        })}

        {hasAnyActive && onReset && (
          <Pressable
            onPress={() => {
              triggerHaptic("light", hapticsEnabled);
              onReset();
            }}
            style={styles.resetBtn}
          >
            <RotateCcw size={13.5} color={colors.betclicRed} strokeWidth={2.4} />
            <Text style={styles.resetText}>Réinitialiser</Text>
          </Pressable>
        )}
      </ScrollView>

      {resultCountLabel ? (
        <Text style={styles.countLabel}>{resultCountLabel}</Text>
      ) : null}

      <Modal
        visible={Boolean(activeFilter)}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenFilterId(null)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setOpenFilterId(null)}
        >
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{activeFilter?.label}</Text>
              <Pressable
                onPress={() => setOpenFilterId(null)}
                style={styles.closeBtn}
              >
                <X size={18} color={colors.ink} strokeWidth={2.4} />
              </Pressable>
            </View>
            <ScrollView style={styles.optionsList} bounces={false}>
              {(activeFilter?.options ?? []).map((opt) => {
                const chosen = activeFilter?.value === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => {
                      if (activeFilter) {
                        triggerHaptic("light", hapticsEnabled);
                        activeFilter.onChange(opt.value);
                      }
                      setOpenFilterId(null);
                    }}
                    style={[styles.optRow, chosen && styles.optRowActive]}
                  >
                    <Text
                      style={[styles.optLabel, chosen && styles.optLabelActive]}
                    >
                      {opt.label}
                      {typeof opt.count === "number" ? ` (${opt.count})` : ""}
                    </Text>
                    {chosen && (
                      <Check
                        size={17}
                        color={colors.betclicRed}
                        strokeWidth={2.8}
                      />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 4,
    paddingBottom: 8,
    backgroundColor: colors.deep,
  },
  scrollRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 8,
  },
  pill: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.elev,
    maxWidth: 200,
  },
  pillActive: {
    backgroundColor: colors.betclicRed,
  },
  pillText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.ink,
    flexShrink: 1,
  },
  pillTextActive: {
    color: colors.white,
    fontWeight: "700",
  },
  resetBtn: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(225, 0, 20, 0.09)",
  },
  resetText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.betclicRed,
  },
  countLabel: {
    marginTop: 7,
    fontSize: 12,
    fontWeight: "600",
    color: colors.dim,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: "72%",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.edge,
    marginBottom: 10,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.edgeSoft,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.ink,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.elev,
    alignItems: "center",
    justifyContent: "center",
  },
  optionsList: {
    marginTop: 8,
  },
  optRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderRadius: 12,
    marginVertical: 2,
  },
  optRowActive: {
    backgroundColor: "rgba(225, 0, 20, 0.08)",
  },
  optLabel: {
    fontSize: 14.5,
    fontWeight: "600",
    color: colors.ink,
  },
  optLabelActive: {
    fontWeight: "800",
    color: colors.betclicRed,
  },
});
