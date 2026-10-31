import React from "react";
import { Image, View } from "react-native";

const images = {
  paypal: require("../../assets/payments/paypal.png"),
  visa: require("../../assets/payments/visa.png"),
  mastercard: require("../../assets/payments/mastercard.png"),
};

export function PaymentMethodMark({ method, fallback }: { method: string; fallback: React.ReactNode }) {
  const brands: (keyof typeof images)[] = method === "paypal" ? ["paypal"] : method === "stripe" || method === "card" ? ["visa", "mastercard"] : [];
  if (!brands.length) return <>{fallback}</>;
  return (
    <View accessible={false} style={{ flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
      {brands.map((brand) => <Image key={brand} source={images[brand]} resizeMode="contain" style={{ width: 30, height: 19, borderRadius: 2, borderWidth: 1, borderColor: "#e5e7eb" }} />)}
    </View>
  );
}
