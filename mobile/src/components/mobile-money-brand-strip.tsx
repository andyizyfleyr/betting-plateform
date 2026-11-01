import React from "react";
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { PAYMENT_BRAND_IMAGES } from "@/components/payment-method-mark";
import { mobileMoneyBrands, PAYMENT_BRAND_LABELS } from "@/lib/payment-logos";
import { COLORS } from "@/theme/tokens";

/**
 * Rappel visuel des opérateurs Mobile Money disponibles dans le pays.
 * Les logos restent locaux : aucun appel à un CDN tiers.
 */
export function MobileMoneyBrandStrip({
  countryCode,
  style,
  limit,
}: {
  countryCode?: string | null;
  style?: StyleProp<ViewStyle>;
  limit?: number;
}) {
  const brands = mobileMoneyBrands(countryCode);
  if (!brands.length) return null;
  const shown = typeof limit === "number" ? brands.slice(0, limit) : brands;

  return (
    <View style={[styles.wrap, style]}>
      {shown.map((brand) => (
        <View key={brand} style={styles.chip}>
          <Image
            source={PAYMENT_BRAND_IMAGES[brand]}
            resizeMode="contain"
            style={styles.logo}
          />
          <Text numberOfLines={1} style={styles.label}>
            {PAYMENT_BRAND_LABELS[brand]}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: COLORS.white,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  logo: {
    width: 20,
    height: 14,
  },
  label: {
    maxWidth: 92,
    fontSize: 8.5,
    fontWeight: "500",
    color: COLORS.mist,
  },
});
