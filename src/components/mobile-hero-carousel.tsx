"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/format";

export type HeroPromoAction =
  | "focus_matches"
  | "open_live"
  | "open_combo"
  | "filter_favorites"
  | "open_recharge";

interface HeroSlide {
  id: string;
  player: string;
  title: string;
  description: string;
  ctaLabel: string;
  action: HeroPromoAction;
  image: string;
  objectPosition: string;
  bgBase: string;
  bgVia: string;
  ctaClass: string;
}

const HERO_SLIDES: HeroSlide[] = [
  {
    id: "yamal",
    player: "Lamine Yamal",
    title: "Cotes boostées sur les chocs",
    description: "Lamine Yamal enflamme l'Europe : pariez en 1x2 et Total buts.",
    ctaLabel: "Parier maintenant",
    action: "focus_matches",
    image: "/images/hero/lamine-yamal.webp",
    objectPosition: "56% 14%",
    bgBase: "#101935",
    bgVia: "#4c1228",
    ctaClass: "bg-betclic-red text-white",
  },
  {
    id: "mbappe",
    player: "Kylian Mbappé",
    title: "Pari combiné · Gains boostés",
    description: "Combinez Real Madrid, Liga et LDC dans votre Betslip jusqu'à +50 %.",
    ctaLabel: "Créer un combiné",
    action: "open_combo",
    image: "/images/hero/kylian-mbappe.webp",
    objectPosition: "52% 12%",
    bgBase: "#0f172a",
    bgVia: "#1e293b",
    ctaClass: "bg-white text-ink",
  },
  {
    id: "gordon",
    player: "Anthony Gordon",
    title: "En direct · Premier League",
    description: "Gordon et les cadors anglais : cotes ajustées à l'action réelle.",
    ctaLabel: "Voir le direct",
    action: "open_live",
    image: "/images/hero/anthony-gordon.webp",
    objectPosition: "55% 15%",
    bgBase: "#111827",
    bgVia: "#1f2937",
    ctaClass: "bg-betclic-red text-white",
  },
  {
    id: "haaland",
    player: "Erling Haaland",
    title: "Festival de buts · Plus de 2,5",
    description: "Haaland frappe fort : profitez des lignes Total & Les 2 marquent.",
    ctaLabel: "Voir les favoris",
    action: "filter_favorites",
    image: "/images/hero/erling-haaland.webp",
    objectPosition: "52% 14%",
    bgBase: "#0b2239",
    bgVia: "#143d60",
    ctaClass: "bg-white text-ink",
  },
  {
    id: "salah",
    player: "Mohamed Salah",
    title: "Dépôt rapide · Mise immédiate",
    description: "Rechargez votre solde en quelques secondes avant le coup d'envoi.",
    ctaLabel: "Recharger",
    action: "open_recharge",
    image: "/images/hero/mohamed-salah.webp",
    objectPosition: "54% 14%",
    bgBase: "#2b0a12",
    bgVia: "#5e1120",
    ctaClass: "bg-betclic-red text-white",
  },
];

interface MobileHeroCarouselProps {
  onAction: (action: HeroPromoAction) => void;
}

export const MobileHeroCarousel = memo(function MobileHeroCarousel({
  onAction,
}: MobileHeroCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pauseUntilRef = useRef<number>(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const scrollToSlide = useCallback((index: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const width = el.clientWidth;
    if (width <= 0) return;
    const clamped = ((index % HERO_SLIDES.length) + HERO_SLIDES.length) % HERO_SLIDES.length;
    el.scrollTo({ left: clamped * width, behavior: "smooth" });
    setActiveIndex(clamped);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || el.clientWidth <= 0) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    const clamped = Math.max(0, Math.min(HERO_SLIDES.length - 1, idx));
    setActiveIndex((prev) => (prev === clamped ? prev : clamped));
  }, []);

  const pauseAutoPlay = useCallback(() => {
    pauseUntilRef.current = Date.now() + 8_000;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() < pauseUntilRef.current) return;
      setActiveIndex((prev) => {
        const next = (prev + 1) % HERO_SLIDES.length;
        const el = scrollerRef.current;
        if (el && el.clientWidth > 0) {
          el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
        }
        return next;
      });
    }, 5_200);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <section
      aria-label="Promotions à la une"
      className="relative mb-2.5 overflow-hidden rounded-2xl shadow-xs lg:hidden"
      onTouchStart={pauseAutoPlay}
      onMouseDown={pauseAutoPlay}
    >
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
      >
        {HERO_SLIDES.map((slide, idx) => (
          <article
            key={slide.id}
            style={{ backgroundColor: slide.bgBase }}
            className="relative h-[118px] w-full shrink-0 snap-center overflow-hidden select-none"
          >
            {/* Visuel joueur cadré à droite sans couper le visage */}
            <div className="pointer-events-none absolute inset-y-0 right-0 w-[56%]">
              <Image
                src={slide.image}
                alt={slide.player}
                fill
                sizes="(max-width: 1023px) 58vw, 240px"
                priority={idx === 0}
                style={{ objectPosition: slide.objectPosition }}
                className="object-cover"
              />
            </div>

            {/* Fondu latéral fluide garantissant la lisibilité parfaite du texte à gauche */}
            <div
              aria-hidden="true"
              style={{
                background: `linear-gradient(90deg, ${slide.bgBase} 0%, ${slide.bgVia} 42%, rgba(15,23,42,0.58) 60%, rgba(15,23,42,0.08) 80%, rgba(15,23,42,0) 100%)`,
              }}
              className="pointer-events-none absolute inset-0"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-black/35 to-transparent"
            />

            {/* Contenu : Titre + Description + Bouton d'action */}
            <div className="relative z-10 flex h-full w-[64%] flex-col justify-between px-3.5 py-2.5">
              <div>
                <h2 className="line-clamp-1 font-display text-[14.5px] font-extrabold leading-tight tracking-tight text-white">
                  {slide.title}
                </h2>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-[1.3] text-white/82">
                  {slide.description}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  pauseAutoPlay();
                  onAction(slide.action);
                }}
                className={cn(
                  "inline-flex h-[26px] w-fit items-center gap-1 rounded-full px-2.5 font-display text-[11px] font-bold shadow-xs transition-transform active:scale-95",
                  slide.ctaClass
                )}
              >
                <span>{slide.ctaLabel}</span>
                <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={2.6} />
              </button>
            </div>
          </article>
        ))}
      </div>

      {/* Indicateurs de slides intégrés en bas à droite (0 px de hauteur ajoutée) */}
      <div className="absolute bottom-2 right-2.5 z-20 flex items-center gap-1">
        {HERO_SLIDES.map((s, idx) => {
          const active = idx === activeIndex;
          return (
            <button
              key={s.id}
              type="button"
              aria-label={`Aller à la bannière ${idx + 1} (${s.player})`}
              onClick={() => {
                pauseAutoPlay();
                scrollToSlide(idx);
              }}
              className={cn(
                "h-1.5 rounded-full transition-all duration-200",
                active ? "w-4 bg-white" : "w-1.5 bg-white/45"
              )}
            />
          );
        })}
      </div>
    </section>
  );
});
