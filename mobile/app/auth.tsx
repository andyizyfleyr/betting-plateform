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
import { ArrowLeft, Eye, EyeOff, Zap } from "lucide-react-native";
import { useApp } from "@/context/app-context";
import { api, ApiHttpError } from "@/lib/api";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

export default function AuthScreen() {
  const router = useRouter();
  const { applyUser, refreshPulseNow, toast } = useApp();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setErrorMsg("Veuillez renseigner votre e-mail et votre mot de passe.");
      return;
    }
    if (mode === "register" && name.trim().length < 2) {
      setErrorMsg("Indiquez votre prénom ou pseudo (2 caractères min.).");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const res =
        mode === "login"
          ? await api.auth.login({ email: cleanEmail, password })
          : await api.auth.register({
              name: name.trim(),
              email: cleanEmail,
              password,
            });
      applyUser(res.user);
      void refreshPulseNow();
      toast({
        kind: "success",
        title:
          mode === "login"
            ? `Bon retour, ${res.user.name} !`
            : `Bienvenue sur PULSE, ${res.user.name} !`,
      });
      // Contrainte stricte : connexion admin -> /admin
      if (res.user.role === "admin") {
        router.replace("/admin");
      } else {
        router.replace("/matchs");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof ApiHttpError
          ? err.message
          : "Connexion impossible. Vérifiez vos identifiants."
      );
    } finally {
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
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            onPress={() => router.replace("/matchs")}
            style={styles.backLink}
          >
            <ArrowLeft size={16} color={COLORS.mist} strokeWidth={2.3} />
            <Text style={styles.backText}>Retour aux matchs</Text>
          </Pressable>

          <View style={styles.card}>
            <View style={styles.brandRow}>
              <View style={styles.brandIcon}>
                <Zap size={18} color="#ffffff" fill="#ffffff" strokeWidth={2.5} />
              </View>
              <Text style={styles.brandName}>PULSE</Text>
            </View>

            <Text style={styles.heading}>
              {mode === "login"
                ? "Connectez-vous à votre compte"
                : "Créez votre compte joueur"}
            </Text>

            <View style={styles.segmented}>
              <Pressable
                onPress={() => {
                  setMode("login");
                  setErrorMsg(null);
                }}
                style={[
                  styles.segBtn,
                  mode === "login" && styles.segBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.segText,
                    mode === "login" && styles.segTextActive,
                  ]}
                >
                  Connexion
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setMode("register");
                  setErrorMsg(null);
                }}
                style={[
                  styles.segBtn,
                  mode === "register" && styles.segBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.segText,
                    mode === "register" && styles.segTextActive,
                  ]}
                >
                  Inscription
                </Text>
              </Pressable>
            </View>

            <View style={styles.fields}>
              {mode === "register" ? (
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Pseudo / Nom</Text>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="Ex. Alexandre"
                    placeholderTextColor={COLORS.dim}
                    style={styles.input}
                  />
                </View>
              ) : null}

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Adresse e-mail</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="vous@exemple.com"
                  placeholderTextColor={COLORS.dim}
                  style={styles.input}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Mot de passe</Text>
                <View style={styles.pwdWrap}>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPwd}
                    autoCapitalize="none"
                    placeholder="••••••••"
                    placeholderTextColor={COLORS.dim}
                    style={styles.pwdInput}
                  />
                  <Pressable
                    hitSlop={8}
                    onPress={() => setShowPwd((v) => !v)}
                  >
                    {showPwd ? (
                      <EyeOff size={17} color={COLORS.dim} strokeWidth={2.1} />
                    ) : (
                      <Eye size={17} color={COLORS.dim} strokeWidth={2.1} />
                    )}
                  </Pressable>
                </View>
              </View>
            </View>

            {errorMsg ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            ) : null}

            <Pressable
              disabled={loading}
              onPress={handleSubmit}
              style={[styles.submitBtn, loading && { opacity: 0.65 }]}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.submitText}>
                  {mode === "login" ? "Se connecter" : "Créer mon compte"}
                </Text>
              )}
            </Pressable>
          </View>
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
  scroll: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 16,
  },
  backLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  backText: {
    fontSize: 13.5,
    fontWeight: "700",
    color: COLORS.mist,
  },
  card: {
    borderRadius: 22,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: COLORS.edge,
    padding: 20,
    gap: 15,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  brandIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: {
    fontSize: 20,
    fontWeight: "900",
    color: COLORS.ink,
    letterSpacing: -0.5,
  },
  heading: {
    fontSize: 16.5,
    fontWeight: "800",
    color: COLORS.ink,
  },
  segmented: {
    height: 42,
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    padding: 3,
    flexDirection: "row",
  },
  segBtn: {
    flex: 1,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  segBtnActive: {
    backgroundColor: "#ffffff",
  },
  segText: {
    fontSize: 13.5,
    fontWeight: "700",
    color: COLORS.mist,
  },
  segTextActive: {
    color: COLORS.ink,
  },
  fields: {
    gap: 11,
  },
  fieldGroup: {
    gap: 5,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.mist,
  },
  input: {
    height: 46,
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    borderWidth: 1,
    borderColor: COLORS.edge,
    paddingHorizontal: 13,
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.ink,
  },
  pwdWrap: {
    height: 46,
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    borderWidth: 1,
    borderColor: COLORS.edge,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
  },
  pwdInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.ink,
  },
  errorBox: {
    borderRadius: 12,
    backgroundColor: "rgba(225, 0, 20, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(225, 0, 20, 0.24)",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  errorText: {
    fontSize: 12.5,
    fontWeight: "600",
    color: COLORS.betclicRed,
  },
  submitBtn: {
    height: 48,
    borderRadius: 13,
    backgroundColor: COLORS.betclicRed,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: {
    fontSize: 14.5,
    fontWeight: "800",
    color: "#ffffff",
  },
});
