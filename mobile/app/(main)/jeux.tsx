import React from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Play } from "lucide-react-native";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

const TAP_IMAGE = require("../../assets/games/tap-win.jpg") as ImageSourcePropType;
const ACC_IMAGE =
  require("../../assets/games/accelerator-pro.jpg") as ImageSourcePropType;

const MINI_GAMES = [
  {
    href: "/tap",
    badge: "Classique",
    tag: "Jusqu'à ×50",
    title: "Tap Win",
    subtitle:
      "Enchaînez les pressions pour faire grimper le multiplicateur et encaissez avant le crash.",
    image: TAP_IMAGE,
  },
  {
    href: "/accelerator",
    badge: "Temps réel",
    tag: "Turbo Live",
    title: "Accelerator Pro",
    subtitle:
      "Maintenez l'accélérateur pour pousser l'aiguille dans le rouge et relâchez au bon moment.",
    image: ACC_IMAGE,
  },
] as const;

export default function JeuxScreen() {
  const router = useRouter();

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.pageTitle}>Mini-jeux</Text>

      <View style={styles.grid}>
        {MINI_GAMES.map(({ href, badge, tag, title, subtitle, image }) => (
          <Pressable
            key={href}
            onPress={() => router.push(href)}
            style={({ pressed }) => [
              styles.card,
              pressed && { transform: [{ scale: 0.99 }] },
            ]}
          >
            <View style={styles.mediaBox}>
              <Image source={image} style={styles.image} resizeMode="cover" />

              <LinearGradient
                colors={[
                  "rgba(0,0,0,0.18)",
                  "rgba(0,0,0,0.25)",
                  "rgba(0,0,0,0.86)",
                ]}
                locations={[0, 0.48, 1]}
                style={StyleSheet.absoluteFillObject}
              />

              <View style={styles.topBadgesRow}>
                <View style={styles.darkBadge}>
                  <Text style={styles.darkBadgeText}>{badge}</Text>
                </View>
                <View style={styles.amberBadge}>
                  <Text style={styles.amberBadgeText}>{tag}</Text>
                </View>
              </View>

              <View style={styles.bottomRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{title}</Text>
                  <Text numberOfLines={2} style={styles.cardSub}>
                    {subtitle}
                  </Text>
                </View>

                <View style={styles.playCircle}>
                  <Play
                    size={16}
                    color="#ffffff"
                    fill="#ffffff"
                    strokeWidth={2.2}
                    style={{ marginLeft: 2 }}
                  />
                </View>
              </View>
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: COLORS.deep,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: COLORS.ink,
  },
  grid: {
    marginTop: 14,
    gap: 14,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#020617",
    overflow: "hidden",
  },
  mediaBox: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#020617",
    justifyContent: "space-between",
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  topBadgesRow: {
    paddingHorizontal: 12,
    paddingTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  darkBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  darkBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "#ffffff",
  },
  amberBadge: {
    borderRadius: 999,
    backgroundColor: "rgba(251,191,36,0.95)",
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  amberBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#020617",
  },
  bottomRow: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: -0.3,
  },
  cardSub: {
    marginTop: 2,
    fontSize: 11.5,
    lineHeight: 16,
    color: "rgba(255,255,255,0.85)",
  },
  playCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
});
