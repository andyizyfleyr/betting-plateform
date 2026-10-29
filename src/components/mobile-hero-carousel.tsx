"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type HeroPromoAction =
  | { type: "league"; slug: string; defaultLabel: string }
  | { type: "virtual" }
  | { type: "live" }
  | { type: "combo" }
  | { type: "recharge" };

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
  /** Couleur de fond unie côté texte (gauche) */
  solidBg: string;
  /** Couleur intermédiaire pour le fondu doux vers la photo à droite */
  fadeMid: string;
  /** Style du bouton d'appel à l'action */
  ctaClassName: string;
}

const HERO_SLIDES: HeroSlide[] = [
  {
    id: "yamal-laliga",
    player: "Lamine Yamal",
    club: "FC Barcelone",
    title: "LaLiga · Chocs & Cotes",
    description: "Lamine Yamal enflamme le Barça : pariez en 1x2 et Total.",
    ctaLabel: "Voir LaLiga",
    action: { type: "league", slug: "esp.1", defaultLabel: "LaLiga" },
    image: "/images/hero/lamine-yamal.webp",
    objectPosition: "56% 18%",
    solidBg: "#0b1636",
    fadeMid: "rgba(11, 22, 54, 0.72)",
    ctaClassName: "bg-[#ff3b30] text-white shadow-[0_4px_12px_rgba(255,59,48,0.35)]",
  },
  {
    id: "virtual-multiplex",
    player: "Multiplex IA",
    club: "Matchs Virtuels 24h/24",
    title: "Matchs Virtuels 24h/24",
    description: "4 directs simultanés de 10 min : cotes dynamiques non-stop.",
    ctaLabel: "Voir les virtuels",
    action: { type: "virtual" },
    image: "/images/hero/virtual-matches.webp",
    objectPosition: "62% 24%",
    solidBg: "#13112b",
    fadeMid: "rgba(19, 17, 43, 0.72)",
    ctaClassName: "bg-[#8b5cf6] text-white shadow-[0_4px_12px_rgba(139,92,246,0.38)]",
  },
  {
    id: "mbappe-combo",
    player: "Kylian Mbappé",
    club: "Real Madrid",
    title: "Combinés · Boost +50 %",
    description: "Combinez Mbappé et vos sélections au Betslip jusqu'à +50 %.",
    ctaLabel: "Créer un combiné",
    action: { type: "combo" },
    image: "/images/hero/kylian-mbappe.webp",
    objectPosition: "52% 16%",
    solidBg: "#101828",
    fadeMid: "rgba(16, 24, 40, 0.72)",
    ctaClassName: "bg-[#f59e0b] text-[#111827] shadow-[0_4px_12px_rgba(245,158,11,0.34)]",
  },
  {
    id: "gordon-ucl",
    player: "Anthony Gordon",
    club: "FC Barcelone",
    title: "Ligue des Champions",
    description: "Gordon brille sous le maillot du Barça : affiches d'Europe.",
    ctaLabel: "Ligue des Champions",
    action: {
      type: "league",
      slug: "uefa.champions",
      defaultLabel: "Ligue des Champions",
    },
    image: "/images/hero/anthony-gordon-barca.webp",
    objectPosition: "50% 14%",
    solidBg: "#2b0b1e",
    fadeMid: "rgba(43, 11, 30, 0.72)",
    ctaClassName: "bg-[#10b981] text-white shadow-[0_4px_12px_rgba(16,185,129,0.35)]",
  },
  {
    id: "haaland-epl",
    player: "Erling Haaland",
    club: "Manchester City",
    title: "Premier League · Buts",
    description: "Haaland empile les buts avec City : Total & Les 2 marquent.",
    ctaLabel: "Premier League",
    action: { type: "league", slug: "eng.1", defaultLabel: "Premier League" },
    image: "/images/hero/erling-haaland.webp",
    objectPosition: "52% 16%",
    solidBg: "#082f49",
    fadeMid: "rgba(8, 47, 73, 0.72)",
    ctaClassName: "bg-[#38bdf8] text-[#082f49] shadow-[0_4px_12px_rgba(56,189,248,0.32)]",
  },
  {
    id: "saka-live",
    player: "Bukayo Saka",
    club: "Arsenal",
    title: "Directs · Cotes Live",
    description: "Bukayo Saka et les chocs en cours : cotes ajustées au réel.",
    ctaLabel: "Voir le direct",
    action: { type: "live" },
    image: "/images/hero/bukayo-saka.webp",
    objectPosition: "56% 16%",
    solidBg: "#3b0810",
    fadeMid: "rgba(59, 8, 16, 0.72)",
    ctaClassName: "bg-white text-[#7f1d1d] shadow-[0_4px_12px_rgba(0,0,0,0.22)]",
  },
  {
    id: "kane-bundesliga",
    player: "Harry Kane",
    club: "Bayern Munich",
    title: "Bundesliga · Chocs",
    description: "Harry Kane affole les compteurs : 19 marchés par match.",
    ctaLabel: "Voir Bundesliga",
    action: { type: "league", slug: "ger.1", defaultLabel: "Bundesliga" },
    image: "/images/hero/harry-kane.webp",
    objectPosition: "48% 14%",
    solidBg: "#2d0712",
    fadeMid: "rgba(45, 7, 18, 0.72)",
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
      className="pb-2 lg:hidden"
    >
      <div className="overflow-hidden rounded-2xl shadow-xs">
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
              style={{ backgroundColor: slide.solidBg }}
              className="relative h-[118px] w-full shrink-0 snap-center overflow-hidden select-none"
            >
              {/* Scène visuelle dédiée à droite (47 % de la largeur) : joueur dégagé, net et sans superposition de texte */}
              <div className="pointer-events-none absolute inset-y-0 right-0 w-[47%] overflow-hidden">
                <Image
                  src={slide.image}
                  alt={`${slide.player} — ${slide.club}`}
                  fill
                  sizes="(max-width: 1024px) 50vw, 220px"
                  priority={idx === 0}
                  style={{ objectPosition: slide.objectPosition }}
                  className="object-cover"
                />
                {/* Fondu latéral doux sur le seul bord gauche de la photo pour fusionner avec le bloc texte */}
                <div
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-8"
                  style={{
                    background: `linear-gradient(90deg, ${slide.solidBg} 0%, ${slide.fadeMid} 52%, transparent 100%)`,
                  }}
                />
              </div>

              {/* Colonne texte & CTA strictement cantonnée à gauche (55 %) */}
              <div className="relative z-10 flex h-full w-[55%] flex-col justify-between py-2.5 pl-3.5 pr-1">
                <div className="min-w-0 space-y-0.5">
                  <h2 className="truncate text-[11.5px] font-bold leading-tight tracking-[-0.01em] text-white">
                    {slide.title}
                  </h2>
                  <p className="line-clamp-2 text-[10px] font-medium leading-[1.28] text-white/85">
                    {slide.description}
                  </p>
                </div>

                <div className="flex items-center">
                  {slide.action.type === "virtual" ? (
                    <Link
                      href="/matchs/virtuels"
                      onClick={pauseAutoplay}
                      className={`inline-flex h-[24px] max-w-full items-center gap-1 rounded-full px-2.5 text-[10px] font-medium tracking-[0.01em] transition-transform active:scale-95 ${slide.ctaClassName}`}
                    >
                      <span className="truncate">{slide.ctaLabel}</span>
                      <ChevronRight className="h-3 w-3 shrink-0 stroke-[2.2]" />
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        pauseAutoplay();
                        onAction(slide.action);
                      }}
                      className={`inline-flex h-[24px] max-w-full items-center gap-1 rounded-full px-2.5 text-[10px] font-medium tracking-[0.01em] transition-transform active:scale-95 ${slide.ctaClassName}`}
                    >
                      <span className="truncate">{slide.ctaLabel}</span>
                      <ChevronRight className="h-3 w-3 shrink-0 stroke-[2.2]" />
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      {/* Pagination externe ultra-compacte sous le slide pour ne rien masquer sur l'image */}
      <div className="mt-1.5 flex items-center justify-center gap-1.5">
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
                isActive ? "w-4 bg-betclic-red" : "w-1.5 bg-ink/20 hover:bg-ink/35"
              }`}
            />
          );
        })}
      </div>
    </section>
  );
}
