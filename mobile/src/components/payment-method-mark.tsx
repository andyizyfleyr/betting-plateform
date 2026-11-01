import React from "react";
import { Image, View } from "react-native";
import { paymentBrandsForMethod } from "@/lib/payment-logos";

const images: Record<string, number> = {
  paypal: require("../../assets/payments/paypal.png"),
  visa: require("../../assets/payments/visa.png"),
  mastercard: require("../../assets/payments/mastercard.png"),
  amex: require("../../assets/payments/amex.png"),
  stripe: require("../../assets/payments/stripe.png"),
  sepa: require("../../assets/payments/sepa.png"),
  transcash: require("../../assets/payments/transcash.png"),
  pcs: require("../../assets/payments/pcs.png"),
  paysafecard: require("../../assets/payments/paysafecard.png"),
  neosurf: require("../../assets/payments/neosurf.png"),
  amazon: require("../../assets/payments/amazon.png"),
  apple: require("../../assets/payments/apple.png"),
  orange_money: require("../../assets/payments/orange_money.png"),
  mtn_momo: require("../../assets/payments/mtn_momo.png"),
  moov_money: require("../../assets/payments/moov_money.png"),
  wave: require("../../assets/payments/wave.png"),
  free_money: require("../../assets/payments/free_money.png"),
  airtel_money: require("../../assets/payments/airtel_money.png"),
  m_pesa: require("../../assets/payments/m_pesa.png"),
  telecel: require("../../assets/payments/telecel.png"),
  tmoney: require("../../assets/payments/tmoney.png"),
  flooz: require("../../assets/payments/flooz.png"),
  celtiis: require("../../assets/payments/celtiis.png"),
  zamani: require("../../assets/payments/zamani.png"),
  muni_dinero: require("../../assets/payments/muni_dinero.png"),
  cash_plus: require("../../assets/payments/cash_plus.png"),
  inwi: require("../../assets/payments/inwi.png"),
  baridimob: require("../../assets/payments/baridimob.png"),
  d17: require("../../assets/payments/d17.png"),
  flouci: require("../../assets/payments/flouci.png"),
  opay: require("../../assets/payments/opay.png"),
  palmpay: require("../../assets/payments/palmpay.png"),
  moniepoint: require("../../assets/payments/moniepoint.png"),
  mvola: require("../../assets/payments/mvola.png"),
  ozow: require("../../assets/payments/ozow.png"),
  capitec: require("../../assets/payments/capitec.png"),
  vodafone_cash: require("../../assets/payments/vodafone_cash.png"),
  instapay: require("../../assets/payments/instapay.png"),
  paylib: require("../../assets/payments/paylib.png"),
  wero: require("../../assets/payments/wero.png"),
  payconiq: require("../../assets/payments/payconiq.png"),
  bancontact: require("../../assets/payments/bancontact.png"),
  twint: require("../../assets/payments/twint.png"),
  giropay: require("../../assets/payments/giropay.png"),
  bizum: require("../../assets/payments/bizum.png"),
  postepay: require("../../assets/payments/postepay.png"),
  bancomat_pay: require("../../assets/payments/bancomat_pay.png"),
  mb_way: require("../../assets/payments/mb_way.png"),
  ideal: require("../../assets/payments/ideal.png"),
  revolut: require("../../assets/payments/revolut.png"),
  monzo: require("../../assets/payments/monzo.png"),
  interac: require("../../assets/payments/interac.png"),
  cash_app: require("../../assets/payments/cash_app.png"),
  venmo: require("../../assets/payments/venmo.png"),
  zelle: require("../../assets/payments/zelle.png"),
  faster_payments: require("../../assets/payments/faster_payments.png"),
};

export { images as PAYMENT_BRAND_IMAGES };

/**
 * Affiche les vrais logos des services de paiement.
 * Les canaux réellement génériques conservent leur icône de repli.
 */
export function PaymentMethodMark({
  method,
  countryCode,
  fallback,
  max = 2,
}: {
  method: string;
  countryCode?: string | null;
  fallback: React.ReactNode;
  max?: number;
}) {
  const brands = paymentBrandsForMethod(method, countryCode).slice(0, max);
  if (!brands.length) return <>{fallback}</>;

  return (
    <View
      accessible={false}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        flexShrink: 0,
      }}
    >
      {brands.map((brand) => (
        <Image
          key={brand}
          source={images[brand]}
          resizeMode="contain"
          style={{
            width: 24,
            height: 16,
            borderRadius: 2,
            borderWidth: 1,
            borderColor: "#e5e7eb",
            backgroundColor: "#ffffff",
          }}
        />
      ))}
    </View>
  );
}
