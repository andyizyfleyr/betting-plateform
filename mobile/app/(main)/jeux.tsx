import React from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "@/lib/router";
import { ArrowLeft, Play } from "@/components/icons";
import { cardSurface, colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

const GAMES = [
  {
    id: "tap-win",
    title: "Tap Win",
    subtitle: "Frappez pour faire grimper le multiplicateur et encaissez avant l'explosion",
    href: "/tap",
    image: require("../../assets/games/tap-win.jpg"),
  },
  {
    id: "accelerator-pro",
    title: "Accelerator Pro",
    subtitle: "Maintenez l'accélérateur enfoncé, surveillez la jauge et encaissez vos gains",
    href: "/accelerator",
    image: require("../../assets/games/accelerator-pro.jpg"),
  },
] as const;

/**
 * Page `/jeux` épurée fidèle à `src/app/(main)/jeux/page.tsx`.
 */
export default function JeuxScreen() {
  const router = useRouter();
  const { hapticsEnabled } = useApp();

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.topRow}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={18} color={colors.ink} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.pageTitle}>Mini-jeux</Text>
      </View>

      {GAMES.map((g) => (
        <Pressable
          key={g.id}
          onPress={() => {
            triggerHaptic("light", hapticsEnabled);
            router.push(g.href);
          }}
          style={[cardSurface.glassCard, styles.gameCard]}
        >
          <Image
            source={g.image}
            style={styles.banner}
            resizeMode="cover"
          />
          <View style={styles.cardBody}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.gameTitle}>{g.title}</Text>
              <Text numberOfLines={2} style={styles.gameSub}>
                {g.subtitle}
              </Text>
            </View>
            <View style={styles.playBtn}>
              <Play size={14} color={colors.white} fill={colors.white} />
              <Text style={styles.playText}>Jouer</Text>
            </View>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.deep },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28, gap: 12 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.edge,
    alignItems: "center",
    justifyContent: "center",
  },
  pageTitle: { fontSize: 18, fontWeight: "900", color: colors.ink },
  gameCard: { overflow: "hidden" },
  banner: { width: "100%", height: 158 },
  cardBody: {
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  gameTitle: { fontSize: 16, fontWeight: "900", color: colors.ink },
  gameSub: { fontSize: 12, lineHeight: 16.5, color: colors.mist },
  playBtn: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.betclicRed,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  playText: { fontSize: 12.5, fontWeight: "900", color: colors.white },
});
