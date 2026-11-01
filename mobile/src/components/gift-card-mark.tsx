import React from "react";
import { Image, type ImageStyle, type StyleProp } from "react-native";
import { PAYMENT_BRAND_IMAGES } from "@/components/payment-method-mark";
import { giftCardBrand } from "@/lib/payment-logos";

/** Vrai logo de la carte cadeau (Transcash, PCS, Paysafecard, etc.). */
export function GiftCardMark({
  id,
  style,
}: {
  id: string;
  style?: StyleProp<ImageStyle>;
}) {
  const brand = giftCardBrand(id);
  if (!brand) return null;
  return (
    <Image
      source={PAYMENT_BRAND_IMAGES[brand]}
      resizeMode="contain"
      style={[{ width: 52, height: 33 }, style]}
    />
  );
}
