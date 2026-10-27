import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Bookmark, Check, Download, Share2 } from "lucide-react-native";
import { useApp, type ComboSelection } from "@/context/app-context";
import { api, ApiHttpError } from "@/lib/api";
import {
  cacheCouponLocally,
  getLocalCachedCoupon,
  normalizeCouponCode,
} from "@/lib/coupon-code";
import { COLORS } from "@/theme/tokens";

export function CouponCodeBox({
  dark = false,
  compact = false,
  variant,
}: {
  dark?: boolean;
  compact?: boolean;
  variant?: string;
  autoCheckUrlCode?: boolean;
}) {
  const isCompact = compact || variant === "inline";
  const { comboLegs, loadComboLegs, toast } = useApp();
  const [inputCode, setInputCode] = useState("");
  const [savedCode, setSavedCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingCode, setLoadingCode] = useState(false);

  const handleSave = async () => {
    if (comboLegs.length === 0 || saving) return;
    setSaving(true);
    try {
      const res = await api.saveCoupon(comboLegs);
      setSavedCode(res.code);
      await cacheCouponLocally(res.code, comboLegs);
      toast({
        kind: "success",
        title: `Code coupon : ${res.code}`,
        description: "Partagez ce code à vos amis pour charger votre sélection.",
      });
    } catch (err) {
      toast({
        kind: "error",
        title: "Enregistrement indisponible",
        description:
          err instanceof ApiHttpError ? err.message : "Veuillez réessayer.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleShareCode = async () => {
    if (!savedCode) return;
    try {
      await Share.share({
        message: `Mon code coupon PULSE : ${savedCode} — https://be-plateform.vercel.app/betslip?code=${encodeURIComponent(savedCode)}`,
      });
    } catch {
      /* annulé */
    }
  };

  const handleLoad = async () => {
    const norm = normalizeCouponCode(inputCode);
    if (!norm || loadingCode) return;
    setLoadingCode(true);
    try {
      const res = await api.loadCoupon(norm);
      if (Array.isArray(res.legs) && res.legs.length > 0) {
        loadComboLegs(res.legs as ComboSelection[]);
        await cacheCouponLocally(res.code, res.legs);
        setInputCode("");
        toast({
          kind: "success",
          title: `Coupon ${res.code} chargé`,
          description: res.skippedClosedCount
            ? `${res.legs.length} sélection(s) ajoutée(s) (${res.skippedClosedCount} clôturée(s) ignorée(s)).`
            : `${res.legs.length} sélection(s) ajoutée(s) au Betslip.`,
        });
        return;
      }
      throw new Error("Vide");
    } catch {
      const local = await getLocalCachedCoupon(norm);
      if (local && local.length > 0) {
        loadComboLegs(local as ComboSelection[]);
        setInputCode("");
        toast({
          kind: "success",
          title: `Coupon ${norm} chargé`,
          description: `${local.length} sélection(s) restaurée(s).`,
        });
      } else {
        toast({
          kind: "error",
          title: "Code coupon introuvable",
          description: "Vérifiez le code saisi (ex. BX-84K2).",
        });
      }
    } finally {
      setLoadingCode(false);
    }
  };

  return (
    <View
      style={[
        styles.card,
        dark ? styles.cardDark : styles.cardLight,
        compact || isCompact ? { padding: 10 } : undefined,
      ]}
    >
      {comboLegs.length > 0 ? (
        <View style={styles.saveRow}>
          <Pressable
            disabled={saving}
            onPress={handleSave}
            style={[
              styles.saveBtn,
              dark ? styles.saveBtnDark : styles.saveBtnLight,
            ]}
          >
            {saving ? (
              <ActivityIndicator
                size="small"
                color={dark ? "#ffffff" : COLORS.ink}
              />
            ) : savedCode ? (
              <Check size={14} color={COLORS.win} strokeWidth={2.6} />
            ) : (
              <Bookmark
                size={14}
                color={dark ? "#ffffff" : COLORS.ink}
                strokeWidth={2.2}
              />
            )}
            <Text
              style={[
                styles.saveBtnText,
                dark && { color: "#ffffff" },
              ]}
            >
              {savedCode ? savedCode : "Enregistrer le code coupon"}
            </Text>
          </Pressable>

          {savedCode ? (
            <Pressable onPress={handleShareCode} style={styles.shareBtn}>
              <Share2 size={14} color="#ffffff" strokeWidth={2.3} />
              <Text style={styles.shareBtnText}>Partager</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.loadRow}>
        <TextInput
          value={inputCode}
          onChangeText={setInputCode}
          placeholder="Code coupon (ex. BX-84K2)"
          placeholderTextColor={
            dark ? "rgba(255,255,255,0.42)" : COLORS.dim
          }
          autoCapitalize="characters"
          autoCorrect={false}
          style={[
            styles.input,
            dark ? styles.inputDark : styles.inputLight,
          ]}
        />
        <Pressable
          disabled={!inputCode.trim() || loadingCode}
          onPress={handleLoad}
          style={[
            styles.loadBtn,
            (!inputCode.trim() || loadingCode) && { opacity: 0.5 },
          ]}
        >
          {loadingCode ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Download size={13.5} color="#ffffff" strokeWidth={2.4} />
              <Text style={styles.loadBtnText}>Charger</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    padding: 12,
    gap: 8,
    borderWidth: 1,
  },
  cardLight: {
    backgroundColor: "#ffffff",
    borderColor: COLORS.edge,
  },
  cardDark: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.12)",
  },
  saveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  saveBtn: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  saveBtnLight: {
    backgroundColor: COLORS.elev,
  },
  saveBtnDark: {
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  saveBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.ink,
  },
  shareBtn: {
    height: 36,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: COLORS.betclicRed,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  shareBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#ffffff",
  },
  loadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    paddingHorizontal: 11,
    fontSize: 13,
    fontWeight: "600",
    borderWidth: 1,
  },
  inputLight: {
    backgroundColor: COLORS.elev,
    borderColor: COLORS.edge,
    color: COLORS.ink,
  },
  inputDark: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.14)",
    color: "#ffffff",
  },
  loadBtn: {
    height: 38,
    borderRadius: 10,
    paddingHorizontal: 13,
    backgroundColor: COLORS.outerSpace,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  loadBtnText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#ffffff",
  },
});
