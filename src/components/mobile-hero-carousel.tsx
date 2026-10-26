"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronRight } from "lucide-react";

export type HeroPromoAction =
  | "focus_matches"
  | "open_live"
  | "open_combo"
  | "filter_favorites"
  | "open_recharge";

interface HeroSlide {
  id: string;
  player: string;
  club: string;
  title: string;
  description: string;
  ctaLabel: string;
  action: HeroPromoAction;
  image: string;
  objectPosition: string;
  /** Dégradé principal côté texte (gauche → droite) pour lisibilité parfaite */
  backdropGradient: string;
  /** Couleur du bouton d'appel à l'action */
  ctaClassName: string;
}

const HERO_SLIDES: HeroSlide[] = [
  {
    id: "yamal-barca",
    player: "Lamine Yamal",
    club: "FC Barcelone",
    title: "Cotes boostées sur les chocs",
    description: "Lamine Yamal enflamme le Barça : pariez en 1x2 et Total buts.",
    ctaLabel: "Parier maintenant",
    action: "focus_matches",
    image: "/images/hero/lamine-yamal.webp",
    objectPosition: "62% 20%",
    backdropGradient:
      "linear-gradient(96deg, #0b1636 0%, #132352 46%, rgba(19, 35, 82, 0.58) 72%, rgba(11, 22, 54, 0.14) 100%)",
    ctaClassName: "bg-[#ff3b30] text-white shadow-[0_4px_12px_rgba(255,59,48,0.35)]",
  },
  {
    id: "mbappe-real",
    player: "Kylian Mbappé",
    club: "Real Madrid",
    title: "Pari combiné · Gains boostés",
    description: "Combinez Mbappé, Real Madrid et LDC au Betslip jusqu'à +50 %.",
    ctaLabel: "Créer un combiné",
    action: "open_combo",
    image: "/images/hero/kylian-mbappe.webp",
    objectPosition: "60% 18%",
    backdropGradient:
      "linear-gradient(96deg, #101828 0%, #1d2939 46%, rgba(29, 41, 57, 0.58) 72%, rgba(16, 24, 40, 0.14) 100%)",
    ctaClassName: "bg-[#f59e0b] text-[#111827] shadow-[0_4px_12px_rgba(245,158,11,0.34)]",
  },
  {
    id: "gordon-barca",
    player: "Anthony Gordon",
    club: "FC Barcelone",
    title: "Anthony Gordon · Liga & LDC",
    description: "Gordon brille sous le maillot du Barça : cotes ajustées au réel.",
    ctaLabel: "Voir le direct",
    action: "open_live",
    image: "/images/hero/anthony-gordon-barca.webp",
    objectPosition: "52% 16%",
    backdropGradient:
      "linear-gradient(96deg, #2b0b1e 0%, #4a1230 46%, rgba(74, 18, 48, 0.58) 72%, rgba(43, 11, 30, 0.14) 100%)",
    ctaClassName: "bg-[#10b981] text-white shadow-[0_4px_12px_rgba(16,185,129,0.35)]",
  },
  {
    id: "haaland-city",
    player: "Erling Haaland",
    club: "Manchester City",
    title: "Premier League · Plus de 2,5",
    description: "Haaland empile les buts avec City : lignes Total & Les 2 marquent.",
    ctaLabel: "Voir les favoris",
    action: "filter_favorites",
    image: "/images/hero/erling-haaland.webp",
    objectPosition: "55% 18%",
    backdropGradient:
      "linear-gradient(96deg, #082f49 0%, #0c4a6e 46%, rgba(12, 74, 110, 0.58) 72%, rgba(8, 47, 73, 0.14) 100%)",
    ctaClassName: "bg-[#38bdf8] text-[#082f49] shadow-[0_4px_12px_rgba(56,189,248,0.32)]",
  },
  {
    id: "saka-arsenal",
    player: "Bukayo Saka",
    club: "Arsenal",
    title: "Chocs Premier League & LDC",
    description: "Bukayo Saka et Arsenal à l'affiche : 19 marchés par match.",
    ctaLabel: "Voir les affiches",
    action: "focus_matches",
    image: "/images/hero/bukayo-saka.webp",
    objectPosition: "52% 18%",
    backdropGradient:
      "linear-gradient(96deg, #3b0810 0%, #69111f 46%, rgba(105, 17, 31, 0.58) 72%, rgba(59, 8, 16, 0.14) 100%)",
    ctaClassName: "bg-white text-[#7f1d1d] shadow-[0_4px_12px_rgba(0,0,0,0.22)]",
  },
  {
    id: "kane-bayern",
    player: "Harry Kane",
    club: "Bayern Munich",
    title: "Dépôt rapide · Mise immédiate",
    description: "Harry Kane et le Bayern en feu : rechargez en quelques secondes.",
    ctaLabel: "Recharger",
    action: "open_recharge",
    image: "/images/hero/harry-kane.webp",
    objectPosition: "50% 16%",
    backdropGradient:
      "linear-gradient(96deg, #2d0712 0%, #581023 46%, rgba(88, 16, 35, 0.58) 72%, rgba(45, 7, 18, 0.14) 100%)",
    ctaClassName: "bg-[#fbbf24] text-[#111827] shadow-[0_4px_12px_rgba(251,191,36,0.34)]",
  },
];

interface MobileHeroCarouselProps {
  onAction: (action: HeroPromoAction) => void;
}

export function MobileHeroCarousel({ onAction }: MobileHeroCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pauseUntilRef = useRef<number>(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const scrollToSlide = useCallback((index: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const clamped = ((index % HERO_SLIDES.length) + HERO_SLIDES.length) % HERO_SLIDES.length;
    el.scrollTo({
      left: clamped * el.clientWidth,
      behavior: "smooth",
    });
    setActiveIndex(clamped);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || el.clientWidth <= 0) return;
    const nextIdx = Math.round(el.scrollLeft / el.clientWidth);
    if (nextIdx >= 0 && nextIdx < HERO_SLIDES.length) {
      setActiveIndex((prev) => (prev === nextIdx ? prev : nextIdx));
    }
  }, []);

  const pauseAutoplay = useCallback(() => {
    pauseUntilRef.current = Date.now() + 7500;
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      if (Date.now() < pauseUntilRef.current) return;
      const el = scrollerRef.current;
      if (!el || el.clientWidth <= 0) return;
      const current = Math.round(el.scrollLeft / el.clientWidth);
      const next = (current + 1) % HERO_SLIDES.length;
      el.scrollTo({
        left: next * el.clientWidth,
        behavior: "smooth",
      });
    }, 4800);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <section
      aria-label="Promotions à la une"
      className="px-3 pt-2.5 pb-0.5 lg:hidden"
    >
      <div className="relative overflow-hidden rounded-2xl shadow-xs">
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          onTouchStart={pauseAutoplay}
          onPointerDown={pauseAutoplay}
          className="flex snap-x snap-mandatory overflow-x-auto no-scrollbar scroll-smooth"
        >
          {HERO_SLIDES.map((slide, idx) => (
            <article
              key={slide.id}
              className="relative h-[118px] w-full shrink-0 snap-center overflow-hidden select-none bg-[#0b1636]"
            >
              {/* Photo plein cadre focalisée sur la moitié droite */}
              <Image
                src={slide.image}
                alt={`${slide.player} — ${slide.club}`}
                fill
                sizes="(max-width: 1024px) 100vw, 420px"
                priority={idx === 0}
                style={{ objectPosition: slide.objectPosition }}
                className="pointer-events-none object-cover"
              />

              {/* Voile dégradé pour garantir un contraste net du texte à gauche */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{ background: slide.backdropGradient }}
              />

              {/* Contenu texte compact + bouton d'appel à l'action */}
              <div className="relative z-10 flex h-full w-[72%] flex-col justify-between px-3.5 py-2.5">
                <div className="min-w-0 space-y-0.5">
                  <h2 className="truncate text-[14px] font-extrabold leading-tight tracking-[-0.01em] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
                    {slide.title}
                  </h2>
                  <p className="line-clamp-2 text-[11px] font-medium leading-[1.3] text-white/85">
                    {slide.description}
                  </p>
                </div>

                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      pauseAutoplay();
                      onAction(slide.action);
                    }}
                    className={`inline-flex h-[26px] items-center gap-1 rounded-full px-3 text-[11px] font-bold tracking-[0.01em] transition-transform active:scale-95 ${slide.ctaClassName}`}
                  >
                    <span>{slide.ctaLabel}</span>
                    <ChevronRight className="h-3 w-3 stroke-[2.6]" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        {/* Indicateurs de pagination discrets intégrés en bas à droite */}
        <div className="pointer-events-auto absolute right-3 bottom-2 z-20 flex items-center gap-1 rounded-full bg-black/30 px-1.5 py-1">
          {HERO_SLIDES.map((slide, idx) => {
            const isActive = idx === activeIndex;
            return (
              <button
                key={slide.id}
                type="button"
                aria-label={`Aller à la bannière ${idx + 1} (${slide.player} · ${slide.club})`}
                onClick={() => {
                  pauseAutoplay();
                  scrollToSlide(idx);
                }}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  isActive ? "w-4 bg-white" : "w-1.5 bg-white/45 hover:bg-white/70"
                }`}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
