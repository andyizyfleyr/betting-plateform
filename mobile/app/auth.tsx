import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowRight, Eye, EyeOff, Sparkles, Zap } from "lucide-react-native";
import { api } from "@/lib/api";
import { cardSurface, colors, triggerHaptic } from "@/theme/tokens";
import { useApp } from "@/context/app-context";

/**
 * Page `/auth` fidèle à `src/app/auth/page.tsx`.
 */
export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { applyUser, refreshPulseNow, hapticsEnabled, toast } = useApp();

  const [tab, setTab] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (overrideEmail?: string, overridePwd?: string) => {
    const cleanEmail = (overrideEmail ?? email).trim().toLowerCase();
    const cleanPwd = overridePwd ?? password;
    if (!cleanEmail || !cleanPwd || loading) return;

    setLoading(true);
    setError(null);
    try {
      const res =
        tab === "login" || overrideEmail
          ? await api.auth.login(cleanEmail, cleanPwd)
          : await api.auth.register(name.trim() || "Joueur", cleanEmail, cleanPwd);

      applyUser(res.user);
      void refreshPulseNow();
      triggerHaptic("success", hapticsEnabled);

      if (res.user.role === "admin") {
        router.replace("/admin");
      } else {
        router.replace("/matchs");
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Identifiants invalides";
      setError(msg);
      toast({ kind: "error", title: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.root, { paddingTop: insets.top + 14 }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(insets.bottom + 24, 32) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandHeader}>
          <Pressable
            onPress={() => router.replace("/matchs")}
            style={styles.brandRow}
          >
            <View style={styles.logoBox}>
              <Zap size={18} color={colors.white} fill={colors.white} strokeWidth={2.3} />
            </View>
            <Text style={styles.logoText}>PULSE</Text>
          </Pressable>
          <Pressable
            onPress={() => router.replace("/matchs")}
            style={styles.guestLink}
          >
            <Text style={styles.guestLinkText}>Explorer sans compte</Text>
          </Pressable>
        </View>

        <View style={styles.heroText}>
          <Text style={styles.h1}>
            {tab === "login" ? "Bon retour" : "Créer un compte"}
          </Text>
          <Text style={styles.subtitle}>
            {tab === "login"
              ? "Connectez-vous pour retrouver votre solde, vos combinés et le Cash Out en direct."
              : "Inscrivez-vous en quelques secondes et profitez de toutes les cotes fixes en direct."}
          </Text>
        </View>

        <View style={[cardSurface.glassCard, styles.formCard]}>
          {/* Segmented Control Connexion / Inscription */}
          <View style={styles.segmentWrap}>
            <Pressable
              onPress={() => {
                setTab("login");
                setError(null);
              }}
              style={[
                styles.segmentBtn,
                tab === "login" && styles.segmentBtnActive,
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  tab === "login" && styles.segmentTextActive,
                ]}
              >
                Connexion
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setTab("register");
                setError(null);
              }}
              style={[
                styles.segmentBtn,
                tab === "register" && styles.segmentBtnActive,
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  tab === "register" && styles.segmentTextActive,
                ]}
              >
                Inscription
              </Text>
            </Pressable>
          </View>

          {tab === "register" && (
            <View style={styles.field}>
              <Text style={styles.label}>Pseudo ou prénom</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Ex: Alex"
                placeholderTextColor={colors.dim}
                style={styles.input}
              />
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.label}>Adresse e-mail</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="vous@exemple.com"
              placeholderTextColor={colors.dim}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Mot de passe</Text>
            <View style={styles.pwdWrap}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={colors.dim}
                secureTextEntry={!showPwd}
                autoCapitalize="none"
                style={styles.pwdInput}
              />
              <Pressable
                onPress={() => setShowPwd((v) => !v)}
                style={styles.eyeBtn}
              >
                {showPwd ? (
                  <EyeOff size={17} color={colors.dim} />
                ) : (
                  <Eye size={17} color={colors.dim} />
                )}
              </Pressable>
            </View>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable
            disabled={loading || !email.trim() || !password}
            onPress={() => void handleSubmit()}
            style={[
              styles.submitBtn,
              (loading || !email.trim() || !password) && { opacity: 0.55 },
            ]}
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <>
                <Text style={styles.submitText}>
                  {tab === "login" ? "Se connecter" : "Créer mon compte"}
                </Text>
                <ArrowRight size={16} color={colors.white} strokeWidth={2.6} />
              </>
            )}
          </Pressable>

          {tab === "login" && (
            <Pressable
              disabled={loading}
              onPress={() => {
                setEmail("alex@pulse.bet");
                setPassword("demo1234");
                void handleSubmit("alex@pulse.bet", "demo1234");
              }}
              style={styles.demoBtn}
            >
              <Sparkles size={14} color={colors.betclicRed} strokeWidth={2.3} />
              <Text style={styles.demoBtnText}>
                Accès rapide compte démo (alex@pulse.bet)
              </Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.footerNote}>
          18+ · Jouer comporte des risques : endettement, isolement, dépendance.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.deep,
  },
  scroll: {
    paddingHorizontal: 18,
    gap: 18,
  },
  brandHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  logoBox: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: colors.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: {
    fontSize: 19,
    fontWeight: "900",
    color: colors.ink,
    letterSpacing: -0.4,
  },
  guestLink: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.edge,
  },
  guestLinkText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.ink,
  },
  heroText: {
    gap: 5,
    marginTop: 6,
  },
  h1: {
    fontSize: 25,
    fontWeight: "900",
    color: colors.ink,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.mist,
  },
  formCard: {
    padding: 16,
    gap: 13,
  },
  segmentWrap: {
    flexDirection: "row",
    backgroundColor: colors.elev,
    borderRadius: 12,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    height: 38,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentBtnActive: {
    backgroundColor: colors.white,
  },
  segmentText: {
    fontSize: 13.5,
    fontWeight: "700",
    color: colors.dim,
  },
  segmentTextActive: {
    color: colors.ink,
    fontWeight: "900",
  },
  field: {
    gap: 5,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.mist,
  },
  input: {
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.elev,
    borderWidth: 1,
    borderColor: colors.edgeSoft,
    paddingHorizontal: 13,
    fontSize: 14,
    color: colors.ink,
  },
  pwdWrap: {
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.elev,
    borderWidth: 1,
    borderColor: colors.edgeSoft,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 13,
    paddingRight: 6,
  },
  pwdInput: {
    flex: 1,
    fontSize: 14,
    color: colors.ink,
  },
  eyeBtn: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: colors.betclicRed,
  },
  submitBtn: {
    height: 48,
    borderRadius: 13,
    backgroundColor: colors.betclicRed,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 2,
  },
  submitText: {
    fontSize: 15,
    fontWeight: "900",
    color: colors.white,
  },
  demoBtn: {
    height: 40,
    borderRadius: 11,
    backgroundColor: "rgba(225, 0, 20, 0.08)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  demoBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.betclicRed,
  },
  footerNote: {
    textAlign: "center",
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.dim,
    paddingHorizontal: 10,
  },
});
