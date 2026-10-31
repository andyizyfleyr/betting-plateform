import Image from "next/image";
import type { ReactNode } from "react";

/** Les canaux génériques gardent leur icône : ils ne désignent aucun opérateur précis. */
export function PaymentMethodMark({ method, fallback }: { method: string; fallback: ReactNode }) {
  const brands = method === "paypal" ? ["paypal"] : method === "stripe" || method === "card" ? ["visa", "mastercard"] : [];
  if (!brands.length) return <>{fallback}</>;
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center gap-0.5">
      {brands.map((brand) => <Image key={brand} src={`/images/payments/${brand}.png`} alt="" width={30} height={19} unoptimized className="h-[19px] w-[30px] rounded-sm border border-edge object-contain" />)}
    </span>
  );
}
