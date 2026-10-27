import React from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowLeft, Play } from "lucide-react-native";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

const GAMES = [
  {
    id: "tap",
    href: "/tap",
    title: "Tap & Win",
    subtitle: "Frappez l'or à chaque impulsion · Encaissez avant le crash",
    badge: "INSTANTANÉ",
    image: require("../../assets/games/tap-win.jpg"),
  },
  {
    id: "accelerator",
    href: "/accelerator",
    title: "Accelerator Pro",
    subtitle: "Jauge de risque ×1,01 – ×2,00 · Maintenez pour accélérer",
    badge: "PRO",
    image: require("../../assets/games/accelerator-pro.jpg"),
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
      <View style={styles.navBar}>
        <Pressable
          onPress={() => router.back("/parametres")}
          style={styles.backBtn}
        >
          <ArrowLeft size={17} color={COLORS.ink} strokeWidth={2.3} />
        </Pressable>
        <Text style={styles.pageTitle}>Jeux instantanés</Text>
      </View>

      <View style={styles.grid}>
        {GAMES.map((g) => (
          <Pressable
            key={g.id}
            onPress={() => router.push(g.href)}
            style={styles.card}
          >
            <View style={styles.imageBox}>
              <Image
                source={g.image}
                resizeMode="cover"
                style={styles.image}
              />
              <LinearGradient
                colors={["transparent", "rgba(2, 6, 23, 0.88)"]}
                locations={[0.25, 1]}
                style={StyleSheet.absoluteFillObject}
              />
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{g.badge}</Text>
              </View>
              <View style={styles.overlayBottom}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.gameTitle}>{g.title}</Text>
                  <Text numberOfLines={2} style={styles.gameSub}>
                    {g.subtitle}
                  </Text>
                </View>
                <View style={styles.playBtn}>
                  <Play
                    size={15}
                    color="#ffffff"
                    fill="#ffffff"
                    strokeWidth={2.2}
                  />
                  <Text style={styles.playText}>Jouer</Text>
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
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 26,
    gap: 12,
  },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.ink,
  },
  grid: {
    gap: 14,
  },
  card: {
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: COLORS.edge,
  },
  imageBox: {
    width: "100%",
    aspectRatio: 16 / 9.6,
    position: "relative",
    justifyContent: "flex-end",
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  badge: {
    position: "absolute",
    top: 12,
    left: 12,
    borderRadius: 999,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: 0.5,
  },
  overlayBottom: {
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 10,
  },
  gameTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#ffffff",
  },
  gameSub: {
    fontSize: 12,
    fontWeight: "500",
    color: "rgba(255, 255, 255, 0.82)",
    marginTop: 2,
  },
  playBtn: {
    height: 38,
    borderRadius: 999,
    backgroundColor: COLORS.betclicRed,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  playText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#ffffff",
  },
});
