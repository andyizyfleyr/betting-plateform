import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Copy, Download, Share2 } from "lucide-react-native";
import { api } from "@/lib/api";
import { colors } from "@/theme/tokens";
import { makeComboUid, useApp } from "@/context/app-context";

/**
 * Boîte de partage / chargement de code coupon (`PLS-XXXXXX`) pour le Betslip.
 */
export function CouponCodeBox({
  defaultStake,
  onLoadedStake,
}: {
  defaultStake: number;
  onLoadedStake?: (stake: number) => void;
}) {
  const { comboLegs, replaceComboLegs, toast } = useApp();
  const [inputCode, setInputCode] = useState("");
  const [savedCode, setSavedCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLoad = async () => {
    const clean = inputCode.trim().toUpperCase();
    if (!clean || loading) return;
    setLoading(true);
    try {
      const res = await api.coupons.load(clean);
      const openLegs = res.legs.filter((l) => !l.closed);
      if (openLegs.length === 0) {
        toast({
          kind: "error",
          title: "Sélections expirées",
          subtitle: "Tous les événements de ce code sont déjà clôturés.",
        });
        return;
      }
      replaceComboLegs(
        openLegs.map((l) => ({
          uid: makeComboUid(
            l.kind,
            l.kind === "sport" ? (l.matchId ?? 0) : (l.questionId ?? 0),
            l.market,
            l.selection
          ),
          kind: l.kind,
          matchId: l.matchId,
          questionId: l.questionId,
          title: l.title,
          league: l.league,
          homeTeam: l.homeTeam,
          awayTeam: l.awayTeam,
          homeLogo: l.homeLogo ?? null,
          awayLogo: l.awayLogo ?? null,
          market: l.market,
          selection: l.selection,
          selectionLabel: l.selectionLabel,
          odds: l.liveOdds || l.odds,
          startsAt: l.startsAt ?? null,
          isLive: l.isLive,
        }))
      );
      if (res.defaultStake > 0) onLoadedStake?.(res.defaultStake);
      setInputCode("");
      toast({
        kind: "success",
        title: `Coupon ${res.code} chargé`,
        subtitle: `${openLegs.length} sélection${openLegs.length > 1 ? "s" : ""} importée${openLegs.length > 1 ? "s" : ""}`,
      });
    } catch (err) {
      toast({
        kind: "error",
        title: "Code coupon introuvable",
        subtitle: err instanceof Error ? err.message : "Vérifiez le code saisi",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (comboLegs.length === 0 || loading) return;
    setLoading(true);
    try {
      const res = await api.coupons.save(comboLegs, defaultStake);
      setSavedCode(res.code);
      await Clipboard.setStringAsync(res.code);
      toast({
        kind: "success",
        title: `Code ${res.code} copié`,
        subtitle: "Partagez ce code pour transmettre votre sélection",
      });
    } catch (err) {
      toast({
        kind: "error",
        title: "Impossible de générer le code",
        subtitle: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <TextInput
          value={inputCode}
          onChangeText={setInputCode}
          placeholder="Code coupon (ex: PLS-8K2M)"
          placeholderTextColor={colors.dim}
          autoCapitalize="characters"
          style={styles.input}
        />
        <Pressable
          onPress={handleLoad}
          disabled={!inputCode.trim() || loading}
          style={[
            styles.loadBtn,
            (!inputCode.trim() || loading) && { opacity: 0.5 },
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <>
              <Download size={13.5} color={colors.white} strokeWidth={2.4} />
              <Text style={styles.loadBtnText}>Charger</Text>
            </>
          )}
        </Pressable>
      </View>

      {comboLegs.length > 0 && (
        <View style={styles.shareBar}>
          {savedCode ? (
            <Pressable
              onPress={async () => {
                await Clipboard.setStringAsync(savedCode);
                toast({ kind: "info", title: `Code ${savedCode} copié` });
              }}
              style={styles.codePill}
            >
              <Text style={styles.codePillText}>{savedCode}</Text>
              <Copy size={13} color={colors.betclicRed} strokeWidth={2.4} />
            </Pressable>
          ) : (
            <Pressable onPress={handleGenerate} style={styles.genBtn}>
              <Share2 size={13.5} color={colors.ink} strokeWidth={2.3} />
              <Text style={styles.genBtnText}>
                Générer un code coupon partageable
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.edge,
    padding: 11,
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.elev,
    paddingHorizontal: 11,
    fontSize: 13,
    fontWeight: "700",
    color: colors.ink,
  },
  loadBtn: {
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.ink,
  },
  loadBtnText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: colors.white,
  },
  shareBar: {
    paddingTop: 4,
  },
  genBtn: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 9,
    backgroundColor: colors.elev,
  },
  genBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.ink,
  },
  codePill: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 9,
    backgroundColor: "rgba(225, 0, 20, 0.09)",
  },
  codePillText: {
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.6,
    color: colors.betclicRed,
  },
});
