import Image from "next/image";
import { mobileMoneyBrands, PAYMENT_BRAND_LABELS } from "@/lib/payment-logos";
import { cn } from "@/lib/format";

/**
 * Rappel visuel des opérateurs Mobile Money disponibles dans le pays.
 * Les logos restent locaux : aucun appel à un CDN tiers.
 */
export function MobileMoneyBrandStrip({
  countryCode,
  className,
  limit,
}: {
  countryCode?: string | null;
  className?: string;
  limit?: number;
}) {
  const brands = mobileMoneyBrands(countryCode);
  if (!brands.length) return null;
  const shown = typeof limit === "number" ? brands.slice(0, limit) : brands;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {shown.map((brand) => (
        <span
          key={brand}
          className="inline-flex items-center gap-1 rounded-md border border-edge bg-white px-1.5 py-1"
        >
          <Image
            src={`/images/payments/${brand}.png`}
            alt=""
            width={22}
            height={15}
            unoptimized
            className="h-[15px] w-[22px] object-contain"
          />
          <span className="font-display text-[9px] font-medium leading-none text-mist">
            {PAYMENT_BRAND_LABELS[brand]}
          </span>
        </span>
      ))}
    </div>
  );
}
