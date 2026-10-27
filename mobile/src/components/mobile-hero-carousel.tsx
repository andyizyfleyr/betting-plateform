import React, { useEffect, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ArrowRight } from "lucide-react-native";
import { colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

interface HeroSlide {
  id: string;
  tag: string;
  title: string;
  subtitle: string;
  cta: string;
  href: string;
  image: number;
  gradient: readonly [string, string, string];
  accent: string;
}

const HERO_SLIDES: HeroSlide[] = [
  {
    id: "yamal-champions",
    tag: "Ligue des Champions",
    title: "Lamine Yamal enflamme les soirées d'Europe",
    subtitle: "Cotes boostées 1X2, buteurs & combinés jusqu'à +20 %",
    cta: "Voir les affiches",
    href: "/matchs/tous",
    image: require("../../assets/hero/lamine-yamal.webp"),
    gradient: ["#0c1222", "#1e1b4b", "#be0011"],
    accent: "#fbbf24",
  },
  {
    id: "virtual-247",
    tag: "24h/24 · Sans interruption",
    title: "Matchs virtuels EN DIRECT toutes les 3 minutes",
    subtitle: "4 stades simultanés, Cash Out instantané & règlement immédiat",
    cta: "Ouvrir le multiplex",
    href: "/matchs/virtuels",
    image: require("../../assets/hero/virtual-matches.webp"),
    gradient: ["#06281e", "#064e3b", "#059669"],
    accent: "#6ee7b7",
  },
  {
    id: "mbappe-laliga",
    tag: "LaLiga · Choc au sommet",
    title: "Kylian Mbappé & le Real Madrid en mission",
    subtitle: "Plus de 18 marchés par match et suivi des stats officielles",
    cta: "Parier maintenant",
    href: "/matchs/tous",
    image: require("../../assets/hero/kylian-mbappe.webp"),
    gradient: ["#111827", "#1f2937", "#dc2626"],
    accent: "#fca5a5",
  },
  {
    id: "gordon-barca",
    tag: "Nouvelle saison 2026-27",
    title: "Anthony Gordon fait vibrer le Camp Nou",
    subtitle: "Pronostiquez les grandes tendances sport & mercato à cote fixe",
    cta: "Voir les prédictions",
    href: "/predictions",
    image: require("../../assets/hero/anthony-gordon-barca.webp"),
    gradient: ["#17153b", "#311042", "#9f1239"],
    accent: "#f9a8d4",
  },
  {
    id: "haaland-pl",
    tag: "Premier League",
    title: "Erling Haaland défie toutes les défenses",
    subtitle: "Composez votre Combiné de 2 à 8 sélections dans le Betslip",
    cta: "Ouvrir le Betslip",
    href: "/betslip",
    image: require("../../assets/hero/erling-haaland.webp"),
    gradient: ["#082f49", "#0c4a6e", "#0284c7"],
    accent: "#7dd3fc",
  },
  {
    id: "saka-arsenal",
    tag: "Mini-jeux Instantanés",
    title: "Bukayo Saka · Vitesse & précision maximale",
    subtitle: "Tap Win & Accelerator Pro avec gains crédités à la seconde",
    cta: "Jouer aux mini-jeux",
    href: "/jeux",
    image: require("../../assets/hero/bukayo-saka.webp"),
    gradient: ["#3b0712", "#7f1d1d", "#e10014"],
    accent: "#fde68a",
  },
  {
    id: "kane-bundesliga",
    tag: "Scores & Résultats",
    title: "Harry Kane et tous les résultats certifiés",
    subtitle: "Consultez l'historique complet des matchs réels et virtuels",
    cta: "Voir les résultats",
    href: "/resultats",
    image: require("../../assets/hero/harry-kane.webp"),
    gradient: ["#18181b", "#27272a", "#991b1b"],
    accent: "#fcd34d",
  },
];

export function MobileHeroCarousel() {
  const router = useRouter();
  const { hapticsEnabled } = useApp();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<HeroSlide>>(null);
  const screenWidth = Dimensions.get("window").width;
  const cardWidth = Math.max(280, screenWidth - 32);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((prev) => {
        const next = (prev + 1) % HERO_SLIDES.length;
        listRef.current?.scrollToOffset({
          offset: next * cardWidth,
          animated: true,
        });
        return next;
      });
    }, 5_200);
    return () => clearInterval(id);
  }, [cardWidth]);

  return (
    <View style={styles.wrap}>
      <FlatList
        ref={listRef}
        data={HERO_SLIDES}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth}
        decelerationRate="fast"
        getItemLayout={(_, i) => ({
          length: cardWidth,
          offset: cardWidth * i,
          index: i,
        })}
        onMomentumScrollEnd={(e) => {
          const next = Math.round(e.nativeEvent.contentOffset.x / cardWidth);
          if (next >= 0 && next < HERO_SLIDES.length) setIndex(next);
        }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              triggerHaptic("light", hapticsEnabled);
              router.push(item.href);
            }}
            style={[styles.slideWrap, { width: cardWidth }]}
          >
            <LinearGradient
              colors={[item.gradient[0], item.gradient[1], item.gradient[2]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.card}
            >
              <View style={styles.textCol}>
                <View style={styles.tagPill}>
                  <Text style={[styles.tagText, { color: item.accent }]}>
                    {item.tag}
                  </Text>
                </View>
                <Text numberOfLines={2} style={styles.title}>
                  {item.title}
                </Text>
                <Text numberOfLines={2} style={styles.subtitle}>
                  {item.subtitle}
                </Text>
                <View style={styles.ctaBtn}>
                  <Text style={styles.ctaText}>{item.cta}</Text>
                  <ArrowRight size={13} color={colors.ink} strokeWidth={2.6} />
                </View>
              </View>

              <Image
                source={item.image}
                style={styles.playerImg}
                contentFit="contain"
                contentPosition="bottom right"
                cachePolicy="memory-disk"
              />
            </LinearGradient>
          </Pressable>
        )}
      />

      <View style={styles.dotsRow}>
        {HERO_SLIDES.map((s, i) => (
          <View
            key={s.id}
            style={[styles.dot, i === index && styles.dotActive]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 10,
  },
  slideWrap: {
    paddingRight: 0,
  },
  card: {
    height: 162,
    borderRadius: 18,
    overflow: "hidden",
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    position: "relative",
  },
  textCol: {
    flex: 1,
    paddingRight: 96,
    zIndex: 2,
  },
  tagPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    marginBottom: 6,
  },
  tagText: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  title: {
    fontSize: 15.5,
    lineHeight: 19.5,
    fontWeight: "900",
    color: colors.white,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 14.5,
    fontWeight: "500",
    color: "rgba(255,255,255,0.82)",
  },
  ctaBtn: {
    marginTop: 9,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.white,
    paddingHorizontal: 11,
    paddingVertical: 5.5,
    borderRadius: 999,
  },
  ctaText: {
    fontSize: 11.5,
    fontWeight: "800",
    color: colors.ink,
  },
  playerImg: {
    position: "absolute",
    right: -4,
    bottom: 0,
    width: 132,
    height: 154,
    zIndex: 1,
  },
  dotsRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  dot: {
    width: 6,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(17, 24, 39, 0.16)",
  },
  dotActive: {
    width: 18,
    backgroundColor: colors.betclicRed,
  },
});
