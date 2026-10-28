import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ArrowDownRight, ArrowUpRight, Check, RefreshCw } from "lucide-react-native";
import type { OddsChangedDetails, OddsChangePolicy } from "@/lib/api";
import { formatOdds } from "@/lib/format";
import { COLORS } from "@/theme/tokens";

export function OddsLockControls({
  oddsFormat,
  oddsPolicy: oddsPolicyProp,
  policy,
  onChangePolicy,
  oddsChanged: oddsChangedProp,
  details,
}: {
  oddsFormat: "decimal" | "fractional";
  oddsPolicy?: OddsChangePolicy;
  policy?: OddsChangePolicy;
  onChangePolicy: (policy: OddsChangePolicy) => void;
  oddsChanged?: OddsChangedDetails | null;
  details?: OddsChangedDetails | null;
  feedKind?: string;
  onAcceptNewOdds?: () => void;
}) {
  const oddsChanged = oddsChangedProp ?? details ?? null;
  const oddsPolicy = oddsPolicyProp ?? policy ?? "confirm_all";
  // Sur mobile (< lg dans Next.js), aucun bandeau permanent n'est affiché tant que la cote n'a pas varié.
  if (!oddsChanged) return null;

  const isUp = oddsChanged.direction === "up";
  const acceptHigher = oddsPolicy === "accept_higher";

  return (
    <View
      style={[
        styles.banner,
        isUp ? styles.bannerUp : styles.bannerDown,
      ]}
    >
      {isUp ? (
        <ArrowUpRight size={16} color={COLORS.win} strokeWidth={2.4} />
      ) : (
        <ArrowDownRight size={16} color={COLORS.amber} strokeWidth={2.4} />
      )}
      <View style={styles.body}>
        <Text style={styles.titleLine}>
          {isUp ? "La cote a augmenté : " : "La cote a évolué : "}
          <Text style={styles.oldOdds}>
            {formatOdds(oddsChanged.previousOdds, oddsFormat)}
          </Text>
          {" → "}
          <Text style={styles.newOdds}>
            {formatOdds(oddsChanged.currentOdds, oddsFormat)}
          </Text>
        </Text>

        <View style={styles.subLine}>
          <RefreshCw size={11.5} color={COLORS.mist} strokeWidth={2.2} />
          <Text style={styles.subText}>
            Aucun montant débité — confirmez la nouvelle cote.
          </Text>
        </View>

        <Pressable
          onPress={() =>
            onChangePolicy(acceptHigher ? "confirm_all" : "accept_higher")
          }
          style={styles.policyRow}
        >
          <View
            style={[
              styles.checkbox,
              acceptHigher && styles.checkboxChecked,
            ]}
          >
            {acceptHigher ? (
              <Check size={10} color="#ffffff" strokeWidth={3} />
            ) : null}
          </View>
          <Text style={styles.policyText}>
            Accepter automatiquement les prochaines hausses
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bannerUp: {
    backgroundColor: "rgba(16, 185, 129, 0.10)",
    borderColor: "rgba(16, 185, 129, 0.35)",
  },
  bannerDown: {
    backgroundColor: "rgba(245, 158, 11, 0.10)",
    borderColor: "rgba(245, 158, 11, 0.40)",
  },
  body: {
    flex: 1,
    gap: 4,
  },
  titleLine: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.ink,
  },
  oldOdds: {
    textDecorationLine: "line-through",
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  newOdds: {
    fontWeight: "500",
    color: COLORS.betclicRed,
    fontVariant: ["tabular-nums"],
  },
  subLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  subText: {
    fontSize: 10,
    color: COLORS.mist,
    flex: 1,
  },
  policyRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  checkbox: {
    width: 15,
    height: 15,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: COLORS.mist,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    borderColor: COLORS.betclicRed,
    backgroundColor: COLORS.betclicRed,
  },
  policyText: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.ink,
    flex: 1,
  },
});
