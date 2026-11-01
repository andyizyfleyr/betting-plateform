import Image from "next/image";
import type { ReactNode } from "react";
import { paymentBrandsForMethod } from "@/lib/payment-logos";

/**
 * Affiche les vrais logos des services de paiement.
 * Les canaux réellement génériques conservent leur icône de repli.
 */
export function PaymentMethodMark({
  method,
  countryCode,
  fallback,
  max = 2,
  size = "sm",
}: {
  method: string;
  countryCode?: string | null;
  fallback: ReactNode;
  max?: number;
  size?: "xs" | "sm" | "md";
}) {
  const brands = paymentBrandsForMethod(method, countryCode).slice(0, max);
  if (!brands.length) return <>{fallback}</>;

  const dimensions =
    size === "md"
      ? { width: 30, height: 19, className: "h-[19px] w-[30px]" }
      : size === "xs"
        ? { width: 20, height: 13, className: "h-[13px] w-[20px]" }
        : { width: 24, height: 16, className: "h-4 w-6" };

  return (
    <span aria-hidden="true" className="flex shrink-0 items-center gap-0.5">
      {brands.map((brand) => (
        <Image
          key={brand}
          src={`/images/payments/${brand}.png`}
          alt=""
          width={dimensions.width}
          height={dimensions.height}
          unoptimized
          className={`${dimensions.className} rounded-[3px] border border-edge bg-white object-contain`}
        />
      ))}
    </span>
  );
}
