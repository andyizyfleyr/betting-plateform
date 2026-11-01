import Image from "next/image";
import { giftCardBrand } from "@/lib/payment-logos";
import { cn } from "@/lib/format";

/** Vrai logo de la carte cadeau (Transcash, PCS, Paysafecard, etc.). */
export function GiftCardMark({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const brand = giftCardBrand(id);
  if (!brand) return null;
  return (
    <Image
      src={`/images/payments/${brand}.png`}
      alt=""
      width={40}
      height={24}
      unoptimized
      className={cn("h-9 w-14 shrink-0 object-contain", className)}
    />
  );
}
