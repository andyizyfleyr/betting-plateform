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
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  User,
  Zap,
} from "lucide-react-native";
import { useApp } from "@/context/app-context";
import { api, ApiHttpError } from "@/lib/api";
import { useRouter, useSearchParams } from "@/lib/router";
import { COLORS, triggerHaptic } from "@/theme/tokens";

export default function AuthScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { applyUser, toast, hapticsEnabled } = useApp();

  const [mode, setMode] = useState<"login" | "register">(
    params.get("mode") === "register" ? "register" : "login"
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      const r =
        mode === "login"
          ? await api.auth.login(email.trim(), password)
          : await api.auth.register(name.trim(), email.trim(), password);
      applyUser(r.user);
      triggerHaptic("success", hapticsEnabled);
      toast({
        kind: "success",
        title:
          mode === "login"
            ? `Bon retour, ${r.user.name}`
            : `Bienvenue ${r.user.name}`,
        description:
          mode === "register"
            ? "250,00 € ont été crédités sur votre solde."
            : undefined,
      });
      router.replace(r.user.role === "admin" ? "/admin" : "/matchs");
    } catch (err) {
      setError(
        err instanceof ApiHttpError || err instanceof Error
          ? err.message
          : "Connexion impossible"
      );
      setLoading(false);
    }
  };

  const quickDemo = async () => {
    setError(null);
    setLoading(true);
    try {
      const r = await api.auth.login("demo@pulse.app", "demo1234");
      applyUser(r.user);
      triggerHaptic("success", hapticsEnabled);
      toast({ kind: "success", title: "Connecté au compte démo" });
      router.replace(r.user.role === "admin" ? "/admin" : "/matchs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connexion impossible");
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View>
            {/* En-tête identique à src/app/auth/page.tsx */}
            <View style={styles.brandRow}>
              <View style={styles.brandIcon}>
                <Zap size={18} color="#ffffff" fill="#ffffff" strokeWidth={2.2} />
              </View>
              <View>
                <Text style={styles.brandTitle}>PULSE</Text>
                <Text style={styles.brandSubtitle}>
                  Paris sportifs & prédictions
                </Text>
              </View>
            </View>

            <View style={styles.headingBlock}>
              <Text style={styles.h1}>
                {mode === "login" ? "Bon retour" : "Créer un compte"}
              </Text>
              <Text style={styles.subtitle}>
                {mode === "login"
                  ? "Accédez à vos prédictions, matchs en direct et paris."
                  : "250,00 € crédités dès l'inscription pour démarrer."}
              </Text>
            </View>

            {/* Sélecteur Connexion / Inscription */}
            <View style={styles.tabSwitch}>
              {(["login", "register"] as const).map((m) => {
                const active = mode === m;
                return (
                  <Pressable
                    key={m}
                    onPress={() => {
                      setMode(m);
                      setError(null);
                    }}
                    style={[styles.tabBtn, active && styles.tabBtnActive]}
                  >
                    <Text
                      style={[
                        styles.tabBtnText,
                        active && styles.tabBtnTextActive,
                      ]}
                    >
                      {m === "login" ? "Connexion" : "Inscription"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Formulaire */}
            <View style={styles.form}>
              {mode === "register" ? (
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Prénom ou pseudo</Text>
                  <View style={styles.inputBox}>
                    <User size={16} color={COLORS.dim} strokeWidth={2.1} />
                    <TextInput
                      value={name}
                      onChangeText={setName}
                      placeholder="Alex Martin"
                      placeholderTextColor={COLORS.dim}
                      autoCapitalize="words"
                      style={styles.input}
                    />
                  </View>
                </View>
              ) : null}

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Adresse e-mail</Text>
                <View style={styles.inputBox}>
                  <Mail size={16} color={COLORS.dim} strokeWidth={2.1} />
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="vous@exemple.fr"
                    placeholderTextColor={COLORS.dim}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                  />
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Mot de passe</Text>
                <View style={styles.inputBox}>
                  <Lock size={16} color={COLORS.dim} strokeWidth={2.1} />
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder={
                      mode === "register" ? "Au moins 4 caractères" : "••••••••"
                    }
                    placeholderTextColor={COLORS.dim}
                    secureTextEntry={!showPass}
                    autoCapitalize="none"
                    onSubmitEditing={submit}
                    style={styles.input}
                  />
                  <Pressable
                    hitSlop={10}
                    onPress={() => setShowPass((s) => !s)}
                  >
                    {showPass ? (
                      <EyeOff size={16} color={COLORS.dim} strokeWidth={2.1} />
                    ) : (
                      <Eye size={16} color={COLORS.dim} strokeWidth={2.1} />
                    )}
                  </Pressable>
                </View>
              </View>

              {error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <Pressable
                disabled={loading}
                onPress={submit}
                style={({ pressed }) => [
                  styles.submitBtn,
                  loading && { opacity: 0.6 },
                  pressed && !loading && { transform: [{ scale: 0.99 }] },
                ]}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <Text style={styles.submitText}>
                      {mode === "login" ? "Se connecter" : "Créer mon compte"}
                    </Text>
                    <ArrowRight size={16} color="#ffffff" strokeWidth={2.4} />
                  </>
                )}
              </Pressable>
            </View>

            {/* Accès rapide avec le compte démo */}
            <Pressable
              disabled={loading}
              onPress={quickDemo}
              style={({ pressed }) => [
                styles.demoBtn,
                loading && { opacity: 0.6 },
                pressed && { backgroundColor: COLORS.elev },
              ]}
            >
              <Zap size={16} color={COLORS.betclicRed} strokeWidth={2.2} />
              <Text style={styles.demoBtnText}>
                Accès rapide avec le compte démo
              </Text>
            </Pressable>
          </View>

          <Text style={styles.footerDisclaimer}>
            18+ · Jouer comporte des risques : endettement, isolement,
            dépendance.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.deep,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: COLORS.ink,
    lineHeight: 20,
  },
  brandSubtitle: {
    fontSize: 11,
    color: COLORS.dim,
  },
  headingBlock: {
    marginTop: 24,
  },
  h1: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: COLORS.ink,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13.5,
    color: COLORS.mist,
    lineHeight: 19,
  },
  tabSwitch: {
    marginTop: 20,
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: COLORS.elev,
    padding: 4,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBtnActive: {
    backgroundColor: "#ffffff",
    shadowColor: "#111827",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.mist,
  },
  tabBtnTextActive: {
    color: COLORS.ink,
  },
  form: {
    marginTop: 20,
    gap: 14,
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontSize: 11.5,
    fontWeight: "500",
    color: COLORS.mist,
  },
  inputBox: {
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 14.5,
    color: COLORS.ink,
    paddingVertical: 0,
  },
  errorBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(225, 0, 20, 0.30)",
    backgroundColor: "rgba(225, 0, 20, 0.08)",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: {
    fontSize: 12.5,
    color: COLORS.betclicRed,
  },
  submitBtn: {
    marginTop: 4,
    height: 48,
    borderRadius: 16,
    backgroundColor: COLORS.betclicRed,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  submitText: {
    fontSize: 14.5,
    fontWeight: "700",
    color: "#ffffff",
  },
  demoBtn: {
    marginTop: 12,
    height: 44,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  demoBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.ink,
  },
  footerDisclaimer: {
    marginTop: 24,
    textAlign: "center",
    fontSize: 11,
    color: COLORS.dim,
    lineHeight: 16,
  },
});
