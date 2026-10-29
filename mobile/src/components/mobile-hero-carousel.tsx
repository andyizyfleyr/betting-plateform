import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronRight } from "lucide-react-native";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

export type HeroPromoAction =
  | { type: "league"; slug: string; defaultLabel: string }
  | { type: "live" }
  | { type: "combo" }
  | { type: "virtual" }
  | { type: "recharge" };

interface HeroSlide {
  id: string;
  player: string;
  club: string;
  title: string;
  description: string;
  ctaLabel: string;
  action: HeroPromoAction;
  image: ImageSourcePropType;
  solidBg: string;
  fadeMid: string;
  ctaBg: string;
  ctaText: string;
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
    image: require("../../assets/hero/lamine-yamal.webp"),
    solidBg: "#0b1636",
    fadeMid: "rgba(11, 22, 54, 0.72)",
    ctaBg: "#ff3b30",
    ctaText: "#ffffff",
  },
  {
    id: "virtual-multiplex",
    player: "Multiplex IA",
    club: "Matchs Virtuels 24h/24",
    title: "Matchs Virtuels 24h/24",
    description: "4 directs simultanés de 10 min : cotes dynamiques non-stop.",
    ctaLabel: "Voir les virtuels",
    action: { type: "virtual" },
    image: require("../../assets/hero/virtual-matches.webp"),
    solidBg: "#13112b",
    fadeMid: "rgba(19, 17, 43, 0.72)",
    ctaBg: "#8b5cf6",
    ctaText: "#ffffff",
  },
  {
    id: "mbappe-combo",
    player: "Kylian Mbappé",
    club: "Real Madrid",
    title: "Combinés · Boost +50 %",
    description: "Combinez Mbappé et vos sélections au Betslip jusqu'à +50 %.",
    ctaLabel: "Créer un combiné",
    action: { type: "combo" },
    image: require("../../assets/hero/kylian-mbappe.webp"),
    solidBg: "#101828",
    fadeMid: "rgba(16, 24, 40, 0.72)",
    ctaBg: "#f59e0b",
    ctaText: "#111827",
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
    image: require("../../assets/hero/anthony-gordon-barca.webp"),
    solidBg: "#2b0b1e",
    fadeMid: "rgba(43, 11, 30, 0.72)",
    ctaBg: "#10b981",
    ctaText: "#ffffff",
  },
  {
    id: "haaland-epl",
    player: "Erling Haaland",
    club: "Manchester City",
    title: "Premier League · Buts",
    description: "Haaland empile les buts avec City : Total & Les 2 marquent.",
    ctaLabel: "Premier League",
    action: { type: "league", slug: "eng.1", defaultLabel: "Premier League" },
    image: require("../../assets/hero/erling-haaland.webp"),
    solidBg: "#082f49",
    fadeMid: "rgba(8, 47, 73, 0.72)",
    ctaBg: "#38bdf8",
    ctaText: "#082f49",
  },
  {
    id: "saka-live",
    player: "Bukayo Saka",
    club: "Arsenal",
    title: "Directs · Cotes Live",
    description: "Bukayo Saka et les chocs en cours : cotes ajustées au réel.",
    ctaLabel: "Voir le direct",
    action: { type: "live" },
    image: require("../../assets/hero/bukayo-saka.webp"),
    solidBg: "#3b0810",
    fadeMid: "rgba(59, 8, 16, 0.72)",
    ctaBg: "#ffffff",
    ctaText: "#7f1d1d",
  },
  {
    id: "kane-bundesliga",
    player: "Harry Kane",
    club: "Bayern Munich",
    title: "Bundesliga · Chocs",
    description: "Harry Kane affole les compteurs : 19 marchés par match.",
    ctaLabel: "Voir Bundesliga",
    action: { type: "league", slug: "ger.1", defaultLabel: "Bundesliga" },
    image: require("../../assets/hero/harry-kane.webp"),
    solidBg: "#2d0712",
    fadeMid: "rgba(45, 7, 18, 0.72)",
    ctaBg: "#fbbf24",
    ctaText: "#111827",
  },
];

export function MobileHeroCarousel({
  onAction,
}: {
  onAction: (action: HeroPromoAction) => void;
}) {
  const router = useRouter();
  const scrollRef = useRef<ScrollView | null>(null);
  const pauseUntilRef = useRef<number>(0);
  const activeIdxRef = useRef<number>(0);
  const [slideWidth, setSlideWidth] = useState<number>(0);
  const [activeIndex, setActiveIndex] = useState<number>(0);

  const pauseAutoplay = useCallback(() => {
    pauseUntilRef.current = Date.now() + 7500;
  }, []);

  const scrollToSlide = useCallback(
    (index: number) => {
      if (slideWidth <= 0) return;
      const clamped =
        ((index % HERO_SLIDES.length) + HERO_SLIDES.length) %
        HERO_SLIDES.length;
      scrollRef.current?.scrollTo({ x: clamped * slideWidth, animated: true });
      activeIdxRef.current = clamped;
      setActiveIndex(clamped);
    },
    [slideWidth]
  );

  useEffect(() => {
    if (slideWidth <= 0) return;
    const timer = setInterval(() => {
      if (Date.now() < pauseUntilRef.current) return;
      const next = (activeIdxRef.current + 1) % HERO_SLIDES.length;
      scrollRef.current?.scrollTo({ x: next * slideWidth, animated: true });
      activeIdxRef.current = next;
      setActiveIndex(next);
    }, 4800);
    return () => clearInterval(timer);
  }, [slideWidth]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0) setSlideWidth(w);
  }, []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (slideWidth <= 0) return;
      const idx = Math.round(e.nativeEvent.contentOffset.x / slideWidth);
      if (idx >= 0 && idx < HERO_SLIDES.length && idx !== activeIdxRef.current) {
        activeIdxRef.current = idx;
        setActiveIndex(idx);
      }
    },
    [slideWidth]
  );

  return (
    <View style={styles.section}>
      <View onLayout={onLayout} style={styles.frame}>
        {slideWidth > 0 ? (
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onTouchStart={pauseAutoplay}
          >
            {HERO_SLIDES.map((slide) => (
              <View
                key={slide.id}
                style={[
                  styles.slide,
                  { width: slideWidth, backgroundColor: slide.solidBg },
                ]}
              >
                <View pointerEvents="none" style={styles.photoBox}>
                  <Image
                    source={slide.image}
                    resizeMode="cover"
                    style={styles.photo}
                  />
                  <LinearGradient
                    colors={[slide.solidBg, slide.fadeMid, "transparent"]}
                    locations={[0, 0.52, 1]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={styles.photoFade}
                  />
                </View>

                <View style={styles.copyCol}>
                  <View style={styles.copyTop}>
                    <Text numberOfLines={1} style={styles.title}>
                      {slide.title}
                    </Text>
                    <Text numberOfLines={2} style={styles.desc}>
                      {slide.description}
                    </Text>
                  </View>

                  <View style={styles.ctaRow}>
                    <Pressable
                      onPress={() => {
                        pauseAutoplay();
                        if (slide.action.type === "virtual") {
                          router.push("/matchs/virtuels");
                        } else {
                          onAction(slide.action);
                        }
                      }}
                      style={[styles.ctaBtn, { backgroundColor: slide.ctaBg }]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[styles.ctaText, { color: slide.ctaText }]}
                      >
                        {slide.ctaLabel}
                      </Text>
                      <ChevronRight
                        size={12}
                        color={slide.ctaText}
                        strokeWidth={2.6}
                      />
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={[styles.slide, { backgroundColor: "#0b1636" }]} />
        )}
      </View>

      <View style={styles.dotsRow}>
        {HERO_SLIDES.map((slide, idx) => {
          const isActive = idx === activeIndex;
          return (
            <Pressable
              key={slide.id}
              hitSlop={6}
              onPress={() => {
                pauseAutoplay();
                scrollToSlide(idx);
              }}
              style={[styles.dot, isActive ? styles.dotActive : styles.dotIdle]}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingBottom: 8,
  },
  frame: {
    borderRadius: 16,
    overflow: "hidden",
  },
  slide: {
    height: 118,
    position: "relative",
    overflow: "hidden",
  },
  photoBox: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: "47%",
    overflow: "hidden",
  },
  photo: {
    width: "100%",
    height: "120%",
    marginTop: -4,
  },
  photoFade: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: 32,
  },
  copyCol: {
    width: "55%",
    height: "100%",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 4,
    zIndex: 2,
  },
  copyTop: {
    gap: 2,
  },
  title: {
    fontSize: 11.5,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: "#ffffff",
  },
  desc: {
    fontSize: 10,
    fontWeight: "500",
    lineHeight: 13.5,
    color: "rgba(255, 255, 255, 0.85)",
  },
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  ctaBtn: {
    height: 26,
    borderRadius: 999,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: "100%",
  },
  ctaText: {
    fontSize: 10,
    fontWeight: "500",
    flexShrink: 1,
  },
  dotsRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  dot: {
    height: 6,
    borderRadius: 999,
  },
  dotActive: {
    width: 16,
    backgroundColor: COLORS.betclicRed,
  },
  dotIdle: {
    width: 6,
    backgroundColor: "rgba(17, 24, 39, 0.20)",
  },
});
