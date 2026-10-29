import React, { useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  Share, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bookmark, CheckCircle2, Download, MoreVertical, Share2, Trash2, X } from "lucide-react-native";
import { useApp, type ComboSelection } from "@/context/app-context";
import { api, ApiHttpError } from "@/lib/api";
import { normalizeCouponCode } from "@/lib/coupon-code";
import { validateLoadedCoupon } from "@/lib/coupon-load-validation";
import { COLORS } from "@/theme/tokens";

type ModalMode = "load" | "saving" | "saved" | null;

export function BetslipCouponActions({ onClear }: { onClear: () => void }) {
  const { comboLegs, loadComboLegs, bettingLimits, bettingLimitsReady, toast } = useApp();
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<ModalMode>(null);
  const [code, setCode] = useState("");
  const [savedCode, setSavedCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const closeModal = () => {
    if (loading || mode === "saving") return;
    setMode(null);
    setError("");
  };

  const save = async () => {
    if (!comboLegs.length || mode === "saving") return;
    setMenuOpen(false);
    setError("");
    setMode("saving");
    try {
      const snapshot = [...comboLegs];
      const result = await api.saveCoupon(snapshot);
      setSavedCode(result.code);
      setMode("saved");
    } catch (err) {
      setMode(null);
      toast({ kind: "error", title: "Enregistrement impossible", description: err instanceof Error ? err.message : "Veuillez réessayer." });
    }
  };

  const load = async () => {
    const normalized = normalizeCouponCode(code);
    if (loading || !bettingLimitsReady) return;
    if (!normalized) { setError("Saisissez un code de coupon valide."); return; }
    setLoading(true);
    setError("");
    try {
      // Toujours vérifier auprès du serveur : une copie locale peut contenir des marchés clôturés.
      const result = await api.loadCoupon(normalized);
      const problem = validateLoadedCoupon(result.legs, bettingLimits.maxComboLegs);
      if (problem) { setError(problem); return; }
      const apply = () => {
        loadComboLegs(result.legs as ComboSelection[]);
        setCode("");
        setMode(null);
        toast({ kind: "success", title: "Coupon chargé", description: result.skippedClosedCount ? `${result.legs.length} sélection(s) chargée(s), ${result.skippedClosedCount} clôturée(s) ignorée(s).` : `${result.legs.length} sélection(s) chargée(s) dans le Betslip.` });
      };
      if (comboLegs.length) {
        Alert.alert("Remplacer le coupon ?", "Le coupon chargé remplacera les sélections actuelles.", [
          { text: "Annuler", style: "cancel" },
          { text: "Remplacer", onPress: apply },
        ]);
      } else apply();
    } catch (err) {
      setError(err instanceof ApiHttpError ? err.message : "Impossible de charger le coupon. Vérifiez votre connexion et réessayez.");
    } finally {
      setLoading(false);
    }
  };

  const share = async () => {
    try { await Share.share({ message: `Mon code coupon Pulse Bet : ${savedCode} — https://be-plateform.vercel.app/betslip?code=${encodeURIComponent(savedCode)}` }); } catch { /* partage annulé */ }
  };

  return <>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel="Vider le Betslip" disabled={!comboLegs.length} onPress={() => { setMenuOpen(false); onClear(); }} style={({pressed}) => [styles.iconButton, !comboLegs.length && styles.disabled, pressed && styles.pressed]}>
        <Trash2 size={18} color={COLORS.mist} strokeWidth={2} />
      </Pressable>
      <View style={styles.menuAnchor}>
        <Pressable accessibilityRole="button" accessibilityLabel="Options du coupon" accessibilityState={{ expanded: menuOpen }} onPress={() => setMenuOpen(v => !v)} style={({pressed}) => [styles.iconButton, menuOpen && styles.iconActive, pressed && styles.pressed]}>
          <MoreVertical size={20} color={COLORS.ink} strokeWidth={2} />
        </Pressable>
        {menuOpen ? <View style={styles.menu}>
          <Pressable accessibilityRole="button" onPress={() => { setMenuOpen(false); setError(""); setMode("load"); }} style={styles.menuItem}>
            <Download size={17} color={COLORS.ink} /><Text style={styles.menuText}>Charger le coupon de pari</Text>
          </Pressable>
          <View style={styles.menuDivider} />
          <Pressable accessibilityRole="button" accessibilityState={{disabled: !comboLegs.length}} disabled={!comboLegs.length} onPress={() => void save()} style={[styles.menuItem, !comboLegs.length && styles.disabled]}>
            <Bookmark size={17} color={COLORS.ink} /><Text style={styles.menuText}>Enregistrer le coupon de pari</Text>
          </Pressable>
        </View> : null}
      </View>
    </View>
    <Modal visible={mode !== null} transparent animationType={mode === "load" ? "slide" : "fade"} onRequestClose={closeModal} statusBarTranslucent>
      <KeyboardAvoidingView style={[styles.overlay, mode === "load" ? styles.bottomOverlay : styles.centerOverlay]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable accessibilityLabel="Fermer" style={StyleSheet.absoluteFill} onPress={closeModal} />
        {mode === "load" ? <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.modalHeader}><View style={styles.modalHeading}><Text style={styles.title}>Charger le coupon de pari</Text><Text style={styles.description}>Retrouvez les sélections d’un coupon avec son code.</Text></View><Pressable accessibilityLabel="Fermer" onPress={closeModal} style={styles.close}><X size={19} color={COLORS.mist} /></Pressable></View>
          <Text style={styles.label}>Saisissez le code du coupon de pari</Text>
          <TextInput accessibilityLabel="Saisissez le code du coupon de pari" value={code} onChangeText={v => { setCode(v); setError(""); }} placeholder="Ex. BX-84K2" placeholderTextColor={COLORS.dim} autoCapitalize="characters" autoCorrect={false} returnKeyType="done" onSubmitEditing={() => void load()} style={styles.input} />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {!bettingLimitsReady ? <Text style={styles.description}>Chargement des limites du coupon…</Text> : null}
          <Pressable accessibilityRole="button" disabled={!code.trim() || loading || !bettingLimitsReady} onPress={() => void load()} style={[styles.primary, (!code.trim() || loading || !bettingLimitsReady) && styles.disabled]}>{loading ? <ActivityIndicator size="small" color="white" /> : <Text style={styles.primaryText}>Télécharger</Text>}</Pressable>
        </View> : <View style={styles.dialog}>
          {mode === "saving" ? <><ActivityIndicator color={COLORS.betclicRed} /><Text style={styles.title}>Enregistrement du coupon…</Text></> : <>
            <View style={styles.successIcon}><CheckCircle2 size={23} color={COLORS.win} /></View>
            <Text style={styles.title}>Coupon enregistré</Text>
            <Text style={styles.description}>Partagez ce code pour retrouver votre coupon de pari.</Text>
            <Text selectable accessibilityLabel={`Code du coupon ${savedCode}`} style={styles.savedCode}>{savedCode}</Text>
            <Pressable accessibilityRole="button" onPress={() => void share()} style={styles.primary}><Share2 size={16} color="white" /><Text style={styles.primaryText}>Partager le code</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={closeModal} style={styles.secondary}><Text style={styles.secondaryText}>Fermer</Text></Pressable>
          </>}
        </View>}
      </KeyboardAvoidingView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", alignItems: "center", gap: 4, zIndex: 20 },
  iconButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  iconActive: { backgroundColor: COLORS.elev },
  disabled: { opacity: 0.4 },
  pressed: { backgroundColor: COLORS.elev },
  menuAnchor: { position: "relative", zIndex: 30 },
  menu: { position: "absolute", right: 0, top: 41, width: 235, borderRadius: 14, backgroundColor: "white", borderWidth: 1, borderColor: COLORS.edge, padding: 4, elevation: 10, shadowColor: "#000", shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } },
  menuItem: { minHeight: 44, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  menuText: { flex: 1, fontSize: 11, color: COLORS.ink },
  menuDivider: { height: 1, backgroundColor: COLORS.edge, marginHorizontal: 8 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.48)" },
  bottomOverlay: { justifyContent: "flex-end" },
  centerOverlay: { justifyContent: "center", paddingHorizontal: 24 },
  sheet: { backgroundColor: "white", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 10, gap: 12 },
  handle: { height: 4, width: 36, borderRadius: 4, alignSelf: "center", backgroundColor: COLORS.edge },
  modalHeader: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  modalHeading: { flex: 1, gap: 4 },
  title: { color: COLORS.ink, fontSize: 14, fontWeight: "700" },
  description: { color: COLORS.mist, fontSize: 11, lineHeight: 16 },
  close: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  label: { color: COLORS.ink, fontSize: 11 },
  input: { height: 46, borderRadius: 12, borderWidth: 1, borderColor: COLORS.edge, backgroundColor: COLORS.elev, color: COLORS.ink, fontSize: 12, paddingHorizontal: 12 },
  error: { color: COLORS.betclicRed, fontSize: 11 },
  primary: { minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, backgroundColor: COLORS.betclicRed },
  primaryText: { color: "white", fontSize: 11 },
  dialog: { backgroundColor: "white", borderRadius: 20, padding: 20, gap: 12 },
  successIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: COLORS.winSoft, alignItems: "center", justifyContent: "center" },
  savedCode: { borderRadius: 12, backgroundColor: COLORS.elev, color: COLORS.ink, textAlign: "center", overflow: "hidden", padding: 14, fontSize: 18, letterSpacing: 2 },
  secondary: { alignItems: "center", justifyContent: "center", minHeight: 38 },
  secondaryText: { color: COLORS.mist, fontSize: 11 },
});
