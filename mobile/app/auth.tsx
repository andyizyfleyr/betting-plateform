import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
} from "lucide-react-native";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import { PulseLogo } from "@/components/pulse-logo";
import { useApp } from "@/context/app-context";
import { api, ApiHttpError, type ClientUser } from "@/lib/api";
import {
  COUNTRIES,
  getCountryConfig,
  getCurrencyConfig,
} from "@/lib/countries";
import { usePathname, useRouter, useSearchParams } from "@/lib/router";
import { COLORS, triggerHaptic } from "@/theme/tokens";

type AuthView = "login" | "register" | "forgot";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isValidEmail(raw: string): boolean {
  const clean = raw.trim();
  return clean.length >= 5 && clean.length <= 160 && EMAIL_RE.test(clean);
}

function sanitizeRedirectPath(from: string | null | undefined): string {
  if (!from) return "/matchs";
  const clean = from.trim();
  if (
    !clean.startsWith("/") ||
    clean.startsWith("//") ||
    clean.startsWith("/auth") ||
    clean.startsWith("/admin")
  ) {
    return "/matchs";
  }
  return clean;
}

function evaluatePasswordStrength(pw: string) {
  const hasMinLength = pw.length >= 8;
  const hasLetter = /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(pw);
  const hasDigitOrSymbol = /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw);
  const hasMixedCase =
    /[a-zà-öø-ÿ]/.test(pw) && /[A-ZÀ-ÖØ-Þ]/.test(pw);
  const isValid =
    hasMinLength && hasLetter && hasDigitOrSymbol && pw.length <= 128;

  if (!pw) {
    return {
      score: 0,
      label: "Trop court",
      hasMinLength: false,
      hasLetter: false,
      hasDigitOrSymbol: false,
      isValid: false,
    };
  }
  if (!hasMinLength) {
    return {
      score: 1,
      label: "Trop court",
      hasMinLength,
      hasLetter,
      hasDigitOrSymbol,
      isValid,
    };
  }

  let pts = 1;
  if (hasLetter && hasDigitOrSymbol) pts += 1;
  if (hasMixedCase) pts += 1;
  if (pw.length >= 12 || /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw)) {
    pts += 1;
  }
  const score = Math.min(4, Math.max(1, pts));
  const label =
    score <= 1
      ? "Faible"
      : score === 2
        ? "Moyen"
        : score === 3
          ? "Bon"
          : "Robuste";

  return {
    score,
    label,
    hasMinLength,
    hasLetter,
    hasDigitOrSymbol,
    isValid,
  };
}

function buildMobileAuthHref(
  target: AuthView,
  opts: { from?: string | null; email?: string }
): string {
  const base =
    target === "register"
      ? "/auth/inscription"
      : target === "forgot"
        ? "/auth/mot-de-passe-oublie"
        : "/auth/connexion";
  const parts: string[] = [];
  if (opts.from && opts.from.startsWith("/") && !opts.from.startsWith("/auth")) {
    parts.push(`from=${encodeURIComponent(opts.from)}`);
  }
  if (opts.email && opts.email.trim()) {
    parts.push(`email=${encodeURIComponent(opts.email.trim())}`);
  }
  return parts.length > 0 ? `${base}?${parts.join("&")}` : base;
}

export default function AuthScreen() {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const {
    user,
    applyUser,
    toast,
    hapticsEnabled,
    countryCode,
    setGuestCountryCode,
  } = useApp();

  const resolvedView: AuthView = useMemo(() => {
    if (pathname === "/auth/inscription") return "register";
    if (pathname === "/auth/mot-de-passe-oublie") return "forgot";
    if (pathname === "/auth/connexion") return "login";
    const mode = params.get("mode");
    if (mode === "register" || mode === "signup" || mode === "inscription") {
      return "register";
    }
    if (mode === "forgot" || mode === "reset") {
      return "forgot";
    }
    return "login";
  }, [pathname, params]);

  const fromParam = params.get("from");
  const safeDest = useMemo(() => sanitizeRedirectPath(fromParam), [fromParam]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState(() => params.get("email")?.trim() ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");

  const selectedCountryCfg = useMemo(
    () => getCountryConfig(countryCode),
    [countryCode]
  );
  const selectedCurrencyCfg = useMemo(
    () => getCurrencyConfig(selectedCountryCfg.currency),
    [selectedCountryCfg.currency]
  );
  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => {
      const cur = getCurrencyConfig(c.currency);
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.currency.toLowerCase().includes(q) ||
        cur.symbol.toLowerCase().includes(q) ||
        cur.name.toLowerCase().includes(q) ||
        c.region.toLowerCase().includes(q) ||
        ((c.currency === "XOF" || c.currency === "XAF") && "fcfa".includes(q))
      );
    });
  }, [countrySearch]);

  const [forgotStep, setForgotStep] = useState<"request" | "verify">("request");
  const [otpCode, setOtpCode] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailRef = useRef<TextInput | null>(null);
  const passwordRef = useRef<TextInput | null>(null);
  const confirmPasswordRef = useRef<TextInput | null>(null);
  const otpInputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    if (user) {
      router.replace(user.role === "admin" ? "/admin" : safeDest);
    }
  }, [user, router, safeDest]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1_000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  const pwStrength = useMemo(
    () => evaluatePasswordStrength(password),
    [password]
  );

  const passwordsMatch =
    confirmPassword.length > 0 && password === confirmPassword;
  const passwordsMismatch =
    confirmPassword.length > 0 && password !== confirmPassword;

  const switchView = useCallback(
    (next: AuthView, pushEntry = false) => {
      setError(null);
      setInfoMessage(null);
      triggerHaptic("light", hapticsEnabled);
      const href = buildMobileAuthHref(next, { from: fromParam, email });
      if (pushEntry) {
        router.push(href);
      } else {
        router.replace(href);
      }
    },
    [email, fromParam, hapticsEnabled, router]
  );

  const completeAuth = useCallback(
    (loggedUser: ClientUser, kind: "login" | "register" | "reset") => {
      applyUser(loggedUser);
      triggerHaptic("success", hapticsEnabled);
      const isAdminUser = loggedUser.role === "admin";
      toast({
        kind: "success",
        title: isAdminUser
          ? "Connexion administrateur"
          : kind === "register"
            ? `Bienvenue sur Pulse Bet, ${loggedUser.name}`
            : kind === "reset"
              ? "Mot de passe mis à jour"
              : `Bon retour, ${loggedUser.name}`,
      });
      router.replace(isAdminUser ? "/admin" : safeDest);
    },
    [applyUser, hapticsEnabled, router, safeDest, toast]
  );

  const submitLogin = async () => {
    if (loading) return;
    setError(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) {
      triggerHaptic("warning", hapticsEnabled);
      setError("Veuillez saisir une adresse e-mail valide.");
      return;
    }
    if (!password) {
      triggerHaptic("warning", hapticsEnabled);
      setError("Veuillez saisir votre mot de passe.");
      return;
    }

    setLoading(true);
    try {
      const r = await api.auth.login({
        email: cleanEmail,
        password,
        rememberMe,
      });
      completeAuth(r.user, "login");
    } catch (err) {
      triggerHaptic("error", hapticsEnabled);
      setError(
        err instanceof ApiHttpError || err instanceof Error
          ? err.message
          : "Impossible de vous connecter."
      );
      setLoading(false);
    }
  };

  const submitRegister = async () => {
    if (loading) return;
    setError(null);

    const cleanName = name.trim().replace(/\s+/g, " ");
    const cleanEmail = email.trim().toLowerCase();

    if (cleanName.length < 2) {
      triggerHaptic("warning", hapticsEnabled);
      setError("Veuillez indiquer un nom ou pseudonyme (2 caractères minimum).");
      return;
    }
    if (!isValidEmail(cleanEmail)) {
      triggerHaptic("warning", hapticsEnabled);
      setError("Veuillez saisir une adresse e-mail valide.");
      return;
    }
    if (!pwStrength.isValid) {
      triggerHaptic("warning", hapticsEnabled);
      setError(
        "Le mot de passe doit contenir au moins 8 caractères dont une lettre et un chiffre."
      );
      return;
    }
    if (password !== confirmPassword) {
      triggerHaptic("warning", hapticsEnabled);
      setError("La confirmation du mot de passe ne correspond pas.");
      return;
    }
    if (!acceptedTerms) {
      triggerHaptic("warning", hapticsEnabled);
      setError(
        "Veuillez certifier avoir 18 ans révolus et accepter le règlement Pulse Bet."
      );
      return;
    }

    setLoading(true);
    try {
      const r = await api.auth.register({
        name: cleanName,
        email: cleanEmail,
        password,
        countryCode: selectedCountryCfg.code,
        acceptedTerms: true,
      });
      completeAuth(r.user, "register");
    } catch (err) {
      triggerHaptic("error", hapticsEnabled);
      setError(
        err instanceof ApiHttpError || err instanceof Error
          ? err.message
          : "Création du compte impossible."
      );
      setLoading(false);
    }
  };

  const requestResetCode = async (isResend = false) => {
    if (loading) return;
    setError(null);
    setInfoMessage(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) {
      triggerHaptic("warning", hapticsEnabled);
      setError("Veuillez saisir une adresse e-mail valide.");
      return;
    }

    setLoading(true);
    try {
      const r = await api.auth.forgotPassword(cleanEmail);
      triggerHaptic("success", hapticsEnabled);
      setForgotStep("verify");
      setResendCooldown(60);
      setInfoMessage(
        isResend
          ? `Un nouveau code de sécurité (valable ${r.expiresInMinutes} min) a été généré.`
          : `Si un compte est associé à ${cleanEmail}, un code à 6 chiffres (valable ${r.expiresInMinutes} min) a été envoyé.`
      );
      setTimeout(() => otpInputRef.current?.focus(), 80);
    } catch (err) {
      triggerHaptic("error", hapticsEnabled);
      setError(
        err instanceof ApiHttpError || err instanceof Error
          ? err.message
          : "Impossible d'envoyer le code de vérification."
      );
    } finally {
      setLoading(false);
    }
  };

  const submitResetVerify = async () => {
    if (loading) return;
    setError(null);

    const cleanCode = otpCode.replace(/\D/g, "").slice(0, 6);
    if (cleanCode.length !== 6) {
      triggerHaptic("warning", hapticsEnabled);
      setError("Veuillez saisir les 6 chiffres du code de vérification.");
      return;
    }
    if (!pwStrength.isValid) {
      triggerHaptic("warning", hapticsEnabled);
      setError(
        "Le nouveau mot de passe doit contenir au moins 8 caractères dont une lettre et un chiffre."
      );
      return;
    }
    if (password !== confirmPassword) {
      triggerHaptic("warning", hapticsEnabled);
      setError("La confirmation du nouveau mot de passe ne correspond pas.");
      return;
    }

    setLoading(true);
    try {
      const r = await api.auth.resetPassword({
        email: email.trim().toLowerCase(),
        code: cleanCode,
        password,
      });
      completeAuth(r.user, "reset");
    } catch (err) {
      triggerHaptic("error", hapticsEnabled);
      setError(
        err instanceof ApiHttpError || err instanceof Error
          ? err.message
          : "Impossible de réinitialiser le mot de passe."
      );
      setLoading(false);
    }
  };

  if (user) {
    return (
      <View style={styles.loaderWrap}>
        <PulseFlashLoader />
      </View>
    );
  }

  const strengthColor =
    pwStrength.score >= 4
      ? COLORS.win
      : pwStrength.score === 3
        ? COLORS.emerald
        : pwStrength.score === 2
          ? COLORS.amber
          : COLORS.betclicRed;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Barre supérieure marque + retour */}
          <View style={styles.topBar}>
            <Pressable
              onPress={() => router.replace("/matchs")}
              style={({ pressed }) => [pressed && { opacity: 0.8 }]}
            >
              <PulseLogo size="sm" variant="light" />
            </Pressable>

            {resolvedView === "forgot" ? (
              <Pressable
                onPress={() => switchView("login")}
                style={({ pressed }) => [
                  styles.backPill,
                  pressed && styles.backPillPressed,
                ]}
              >
                <ArrowLeft size={14} color={COLORS.mist} strokeWidth={2.4} />
                <Text style={styles.backPillText}>Connexion</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => router.replace("/matchs")}
                style={({ pressed }) => [
                  styles.backPill,
                  pressed && styles.backPillPressed,
                ]}
              >
                <ArrowLeft size={14} color={COLORS.mist} strokeWidth={2.4} />
                <Text style={styles.backPillText}>Matchs</Text>
              </Pressable>
            )}
          </View>

          {/* Carte centrale 1:1 Web < lg */}
          <View style={styles.cardWrap}>
            <View style={styles.card}>
              {resolvedView !== "forgot" ? (
                <>
                  {/* Sélecteur Connexion / Inscription */}
                  <View style={styles.tabSwitch}>
                    {(["login", "register"] as const).map((m) => {
                      const active = resolvedView === m;
                      return (
                        <Pressable
                          key={m}
                          onPress={() => switchView(m)}
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

                  <View style={styles.headingBlock}>
                    <Text style={styles.h1}>
                      {resolvedView === "login"
                        ? "Connexion à votre compte"
                        : "Créer un compte joueur"}
                    </Text>
                    <Text style={styles.subtitle}>
                      {resolvedView === "login"
                        ? "Accédez à vos paris en direct, vos prédictions et votre portefeuille."
                        : "Inscription gratuite pour parier sur les matchs officiels et virtuels."}
                    </Text>
                  </View>
                </>
              ) : (
                <View>
                  <View style={styles.forgotBadgeRow}>
                    <View style={styles.forgotIconBox}>
                      <KeyRound
                        size={20}
                        color={COLORS.betclicRed}
                        strokeWidth={2.2}
                      />
                    </View>
                    <View style={styles.stepPill}>
                      <Text style={styles.stepPillText}>
                        {forgotStep === "request"
                          ? "Étape 1 sur 2"
                          : "Étape 2 sur 2"}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.h1, { marginTop: 14 }]}>
                    {forgotStep === "request"
                      ? "Mot de passe oublié"
                      : "Vérification de sécurité"}
                  </Text>
                  <Text style={styles.subtitle}>
                    {forgotStep === "request"
                      ? "Saisissez l'adresse e-mail de votre compte pour recevoir un code à 6 chiffres."
                      : "Entrez le code à 6 chiffres reçu puis définissez votre nouveau mot de passe."}
                  </Text>
                </View>
              )}

              {/* ═══ VUE 1 : CONNEXION ═══ */}
              {resolvedView === "login" ? (
                <View style={styles.form}>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Adresse e-mail</Text>
                    <View
                      style={[
                        styles.inputBox,
                        focusedField === "login-email" && styles.inputBoxFocused,
                      ]}
                    >
                      <Mail size={16} color={COLORS.dim} strokeWidth={2.1} />
                      <TextInput
                        ref={emailRef}
                        value={email}
                        onChangeText={(v) => {
                          setEmail(v);
                          if (error) setError(null);
                        }}
                        onFocus={() => setFocusedField("login-email")}
                        onBlur={() => setFocusedField(null)}
                        placeholder="vous@exemple.com"
                        placeholderTextColor={COLORS.dim}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                        onSubmitEditing={() => passwordRef.current?.focus()}
                        style={styles.input}
                      />
                    </View>
                  </View>

                  <View style={styles.fieldGroup}>
                    <View style={styles.labelRow}>
                      <Text style={styles.label}>Mot de passe</Text>
                      <Pressable
                        hitSlop={8}
                        onPress={() => switchView("forgot", true)}
                      >
                        <Text style={styles.forgotLink}>
                          Mot de passe oublié ?
                        </Text>
                      </Pressable>
                    </View>
                    <View
                      style={[
                        styles.inputBox,
                        focusedField === "login-pw" && styles.inputBoxFocused,
                      ]}
                    >
                      <Lock size={16} color={COLORS.dim} strokeWidth={2.1} />
                      <TextInput
                        ref={passwordRef}
                        value={password}
                        onChangeText={(v) => {
                          setPassword(v);
                          if (error) setError(null);
                        }}
                        onFocus={() => setFocusedField("login-pw")}
                        onBlur={() => setFocusedField(null)}
                        placeholder="Votre mot de passe"
                        placeholderTextColor={COLORS.dim}
                        secureTextEntry={!showPass}
                        autoCapitalize="none"
                        returnKeyType="go"
                        onSubmitEditing={() => void submitLogin()}
                        style={styles.input}
                      />
                      <Pressable
                        hitSlop={10}
                        onPress={() => setShowPass((s) => !s)}
                        style={styles.eyeBtn}
                      >
                        {showPass ? (
                          <EyeOff size={16} color={COLORS.dim} strokeWidth={2.1} />
                        ) : (
                          <Eye size={16} color={COLORS.dim} strokeWidth={2.1} />
                        )}
                      </Pressable>
                    </View>
                  </View>

                  <Pressable
                    onPress={() => setRememberMe((v) => !v)}
                    style={styles.rememberRow}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        rememberMe && styles.checkboxChecked,
                      ]}
                    >
                      {rememberMe ? (
                        <Check size={13} color="#ffffff" strokeWidth={3} />
                      ) : null}
                    </View>
                    <Text style={styles.rememberText}>
                      Rester connecté sur cet appareil (30 jours)
                    </Text>
                  </Pressable>

                  {error ? (
                    <View style={styles.errorBox}>
                      <AlertCircle
                        size={15}
                        color={COLORS.betclicRed}
                        strokeWidth={2.2}
                        style={{ marginTop: 1 }}
                      />
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  ) : null}

                  <Pressable
                    disabled={loading}
                    onPress={() => void submitLogin()}
                    style={({ pressed }) => [
                      styles.submitBtn,
                      loading && { opacity: 0.6 },
                      pressed && !loading && { transform: [{ scale: 0.99 }] },
                    ]}
                  >
                    {loading ? (
                      <>
                        <ActivityIndicator size="small" color="#ffffff" />
                        <Text style={styles.submitText}>
                          Connexion en cours…
                        </Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.submitText}>Se connecter</Text>
                        <ArrowRight size={16} color="#ffffff" strokeWidth={2.5} />
                      </>
                    )}
                  </Pressable>

                  <View style={styles.switchPromptRow}>
                    <Text style={styles.switchPromptText}>
                      Nouveau sur Pulse Bet ?{" "}
                    </Text>
                    <Pressable hitSlop={8} onPress={() => switchView("register")}>
                      <Text style={styles.switchPromptLink}>
                        Ouvrir un compte
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {/* ═══ VUE 2 : INSCRIPTION ═══ */}
              {resolvedView === "register" ? (
                <View style={styles.form}>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Nom complet ou pseudonyme</Text>
                    <View
                      style={[
                        styles.inputBox,
                        focusedField === "reg-name" && styles.inputBoxFocused,
                      ]}
                    >
                      <User size={16} color={COLORS.dim} strokeWidth={2.1} />
                      <TextInput
                        value={name}
                        onChangeText={(v) => {
                          setName(v);
                          if (error) setError(null);
                        }}
                        onFocus={() => setFocusedField("reg-name")}
                        onBlur={() => setFocusedField(null)}
                        placeholder="Ex. Karim Mensah"
                        placeholderTextColor={COLORS.dim}
                        autoCapitalize="words"
                        maxLength={40}
                        returnKeyType="next"
                        onSubmitEditing={() => emailRef.current?.focus()}
                        style={styles.input}
                      />
                    </View>
                  </View>

                  <View style={styles.fieldGroup}>
                    <View style={styles.countryLabelRow}>
                      <Text style={styles.label}>
                        Pays de résidence & devise officielle
                      </Text>
                      <View style={styles.countryLockInline}>
                        <Lock size={10} color={COLORS.dim} strokeWidth={2.2} />
                        <Text style={styles.countryLockText}>
                          Fixé à l&apos;inscription
                        </Text>
                      </View>
                    </View>

                    <Pressable
                      onPress={() => {
                        triggerHaptic("light", hapticsEnabled);
                        setCountryPickerOpen((o) => !o);
                      }}
                      style={[
                        styles.countryTrigger,
                        countryPickerOpen && styles.inputBoxFocused,
                      ]}
                    >
                      <View style={styles.countryTriggerLeft}>
                        <Text style={styles.countryFlag}>
                          {selectedCountryCfg.flag}
                        </Text>
                        <View style={{ flex: 1 }}>
                          <Text numberOfLines={1} style={styles.countryName}>
                            {selectedCountryCfg.name}
                          </Text>
                          <Text numberOfLines={1} style={styles.countrySub}>
                            {selectedCurrencyCfg.name}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.countryTriggerRight}>
                        <View style={styles.currencyBadgePill}>
                          <Text style={styles.currencyBadgePillText}>
                            {selectedCurrencyCfg.code} · {selectedCurrencyCfg.symbol}
                          </Text>
                        </View>
                        <ChevronDown
                          size={15}
                          color={COLORS.dim}
                          strokeWidth={2.1}
                        />
                      </View>
                    </Pressable>

                    {countryPickerOpen ? (
                      <View style={styles.countryDropdown}>
                        <View style={styles.countrySearchBox}>
                          <Search
                            size={14}
                            color={COLORS.dim}
                            strokeWidth={2.1}
                          />
                          <TextInput
                            value={countrySearch}
                            onChangeText={setCountrySearch}
                            placeholder="Pays ou devise (ex. Bénin, XOF, Canada…)"
                            placeholderTextColor={COLORS.dim}
                            autoCorrect={false}
                            style={styles.countrySearchInput}
                          />
                        </View>
                        <ScrollView
                          nestedScrollEnabled
                          keyboardShouldPersistTaps="handled"
                          style={styles.countryScroll}
                        >
                          {filteredCountries.length === 0 ? (
                            <Text style={styles.countryEmpty}>
                              Aucun pays trouvé.
                            </Text>
                          ) : (
                            filteredCountries.map((c) => {
                              const cur = getCurrencyConfig(c.currency);
                              const active = c.code === selectedCountryCfg.code;
                              return (
                                <Pressable
                                  key={c.code}
                                  onPress={() => {
                                    triggerHaptic("light", hapticsEnabled);
                                    setGuestCountryCode(c.code);
                                    setCountryPickerOpen(false);
                                    setCountrySearch("");
                                    if (error) setError(null);
                                  }}
                                  style={[
                                    styles.countryItem,
                                    active && styles.countryItemActive,
                                  ]}
                                >
                                  <View style={styles.countryTriggerLeft}>
                                    <Text style={styles.countryItemFlag}>
                                      {c.flag}
                                    </Text>
                                    <View style={{ flex: 1 }}>
                                      <Text
                                        numberOfLines={1}
                                        style={styles.countryItemName}
                                      >
                                        {c.name}
                                      </Text>
                                      <Text
                                        numberOfLines={1}
                                        style={styles.countrySub}
                                      >
                                        {c.region} · {cur.name}
                                      </Text>
                                    </View>
                                  </View>
                                  <View style={styles.countryTriggerRight}>
                                    <View
                                      style={[
                                        styles.countryCurChip,
                                        active && styles.countryCurChipActive,
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          styles.countryCurChipText,
                                          active && { color: "#ffffff" },
                                        ]}
                                      >
                                        {cur.code} ({cur.symbol})
                                      </Text>
                                    </View>
                                    {active ? (
                                      <Check
                                        size={14}
                                        color={COLORS.betclicRed}
                                        strokeWidth={2.5}
                                      />
                                    ) : null}
                                  </View>
                                </Pressable>
                              );
                            })
                          )}
                        </ScrollView>
                      </View>
                    ) : null}

                    <View style={styles.countryHintRow}>
                      <Globe
                        size={11}
                        color={COLORS.betclicRed}
                        strokeWidth={2.1}
                      />
                      <Text style={styles.countryHintText}>
                        Solde, mises et retraits affichés en{" "}
                        <Text style={{ color: COLORS.ink }}>
                          {selectedCurrencyCfg.name} ({selectedCurrencyCfg.symbol})
                        </Text>
                        .
                      </Text>
                    </View>
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Adresse e-mail</Text>
                    <View
                      style={[
                        styles.inputBox,
                        focusedField === "reg-email" && styles.inputBoxFocused,
                      ]}
                    >
                      <Mail size={16} color={COLORS.dim} strokeWidth={2.1} />
                      <TextInput
                        ref={emailRef}
                        value={email}
                        onChangeText={(v) => {
                          setEmail(v);
                          if (error) setError(null);
                        }}
                        onFocus={() => setFocusedField("reg-email")}
                        onBlur={() => setFocusedField(null)}
                        placeholder="vous@exemple.com"
                        placeholderTextColor={COLORS.dim}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                        onSubmitEditing={() => passwordRef.current?.focus()}
                        style={styles.input}
                      />
                      {isValidEmail(email) ? (
                        <CheckCircle2
                          size={16}
                          color={COLORS.win}
                          strokeWidth={2.3}
                        />
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Mot de passe</Text>
                    <View
                      style={[
                        styles.inputBox,
                        focusedField === "reg-pw" && styles.inputBoxFocused,
                      ]}
                    >
                      <Lock size={16} color={COLORS.dim} strokeWidth={2.1} />
                      <TextInput
                        ref={passwordRef}
                        value={password}
                        onChangeText={(v) => {
                          setPassword(v);
                          if (error) setError(null);
                        }}
                        onFocus={() => setFocusedField("reg-pw")}
                        onBlur={() => setFocusedField(null)}
                        placeholder="Minimum 8 caractères"
                        placeholderTextColor={COLORS.dim}
                        secureTextEntry={!showPass}
                        autoCapitalize="none"
                        returnKeyType="next"
                        onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                        style={styles.input}
                      />
                      <Pressable
                        hitSlop={10}
                        onPress={() => setShowPass((s) => !s)}
                        style={styles.eyeBtn}
                      >
                        {showPass ? (
                          <EyeOff size={16} color={COLORS.dim} strokeWidth={2.1} />
                        ) : (
                          <Eye size={16} color={COLORS.dim} strokeWidth={2.1} />
                        )}
                      </Pressable>
                    </View>

                    {password.length > 0 ? (
                      <View style={styles.strengthWrap}>
                        <View style={styles.strengthHeader}>
                          <Text style={styles.strengthTitle}>
                            Sécurité du mot de passe
                          </Text>
                          <Text
                            style={[
                              styles.strengthLabel,
                              { color: strengthColor },
                            ]}
                          >
                            {pwStrength.label}
                          </Text>
                        </View>
                        <View style={styles.strengthBars}>
                          {[1, 2, 3, 4].map((idx) => (
                            <View
                              key={idx}
                              style={[
                                styles.strengthSegment,
                                {
                                  backgroundColor:
                                    idx <= pwStrength.score
                                      ? strengthColor
                                      : COLORS.edge,
                                },
                              ]}
                            />
                          ))}
                        </View>
                      </View>
                    ) : null}

                    <View style={styles.rulesRow}>
                      {[
                        { ok: pwStrength.hasMinLength, text: "8+ caractères" },
                        { ok: pwStrength.hasLetter, text: "1 lettre" },
                        {
                          ok: pwStrength.hasDigitOrSymbol,
                          text: "1 chiffre ou symbole",
                        },
                      ].map((rule) => (
                        <View
                          key={rule.text}
                          style={[
                            styles.ruleChip,
                            rule.ok && styles.ruleChipOk,
                          ]}
                        >
                          <Check
                            size={11}
                            color={rule.ok ? COLORS.win : COLORS.dim}
                            strokeWidth={rule.ok ? 2.8 : 2}
                          />
                          <Text
                            style={[
                              styles.ruleChipText,
                              rule.ok && styles.ruleChipTextOk,
                            ]}
                          >
                            {rule.text}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Confirmer le mot de passe</Text>
                    <View
                      style={[
                        styles.inputBox,
                        focusedField === "reg-cpw" && styles.inputBoxFocused,
                        passwordsMismatch && styles.inputBoxError,
                      ]}
                    >
                      <Lock size={16} color={COLORS.dim} strokeWidth={2.1} />
                      <TextInput
                        ref={confirmPasswordRef}
                        value={confirmPassword}
                        onChangeText={(v) => {
                          setConfirmPassword(v);
                          if (error) setError(null);
                        }}
                        onFocus={() => setFocusedField("reg-cpw")}
                        onBlur={() => setFocusedField(null)}
                        placeholder="Répétez le mot de passe"
                        placeholderTextColor={COLORS.dim}
                        secureTextEntry={!showConfirmPass}
                        autoCapitalize="none"
                        returnKeyType="done"
                        onSubmitEditing={() => void submitRegister()}
                        style={styles.input}
                      />
                      {passwordsMatch ? (
                        <CheckCircle2
                          size={16}
                          color={COLORS.win}
                          strokeWidth={2.3}
                        />
                      ) : null}
                      <Pressable
                        hitSlop={10}
                        onPress={() => setShowConfirmPass((s) => !s)}
                        style={styles.eyeBtn}
                      >
                        {showConfirmPass ? (
                          <EyeOff size={16} color={COLORS.dim} strokeWidth={2.1} />
                        ) : (
                          <Eye size={16} color={COLORS.dim} strokeWidth={2.1} />
                        )}
                      </Pressable>
                    </View>
                  </View>

                  {/* Attestation 18+ & Conditions générales */}
                  <Pressable
                    onPress={() => {
                      setAcceptedTerms((v) => !v);
                      if (error) setError(null);
                    }}
                    style={[
                      styles.termsBox,
                      acceptedTerms && styles.termsBoxActive,
                    ]}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        { marginTop: 2 },
                        acceptedTerms && styles.checkboxChecked,
                      ]}
                    >
                      {acceptedTerms ? (
                        <Check size={13} color="#ffffff" strokeWidth={3} />
                      ) : null}
                    </View>
                    <Text style={styles.termsText}>
                      <Text style={styles.termsBold}>18+</Text> · Je certifie être
                      majeur et j’accepte le règlement des paris ainsi que la
                      politique de jeu responsable Pulse Bet.
                    </Text>
                  </Pressable>

                  {error ? (
                    <View style={styles.errorBox}>
                      <AlertCircle
                        size={15}
                        color={COLORS.betclicRed}
                        strokeWidth={2.2}
                        style={{ marginTop: 1 }}
                      />
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  ) : null}

                  <Pressable
                    disabled={loading}
                    onPress={() => void submitRegister()}
                    style={({ pressed }) => [
                      styles.submitBtn,
                      loading && { opacity: 0.6 },
                      pressed && !loading && { transform: [{ scale: 0.99 }] },
                    ]}
                  >
                    {loading ? (
                      <>
                        <ActivityIndicator size="small" color="#ffffff" />
                        <Text style={styles.submitText}>
                          Création du compte…
                        </Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.submitText}>Ouvrir mon compte</Text>
                        <ArrowRight size={16} color="#ffffff" strokeWidth={2.5} />
                      </>
                    )}
                  </Pressable>

                  <View style={styles.switchPromptRow}>
                    <Text style={styles.switchPromptText}>
                      Vous avez déjà un compte ?{" "}
                    </Text>
                    <Pressable hitSlop={8} onPress={() => switchView("login")}>
                      <Text style={styles.switchPromptLink}>Se connecter</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {/* ═══ VUE 3 : MOT DE PASSE OUBLIÉ (2 ÉTAPES) ═══ */}
              {resolvedView === "forgot" && forgotStep === "request" ? (
                <View style={styles.form}>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Adresse e-mail du compte</Text>
                    <View
                      style={[
                        styles.inputBox,
                        focusedField === "forgot-email" &&
                          styles.inputBoxFocused,
                      ]}
                    >
                      <Mail size={16} color={COLORS.dim} strokeWidth={2.1} />
                      <TextInput
                        value={email}
                        onChangeText={(v) => {
                          setEmail(v);
                          if (error) setError(null);
                        }}
                        onFocus={() => setFocusedField("forgot-email")}
                        onBlur={() => setFocusedField(null)}
                        placeholder="vous@exemple.com"
                        placeholderTextColor={COLORS.dim}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="send"
                        onSubmitEditing={() => void requestResetCode(false)}
                        style={styles.input}
                      />
                    </View>
                  </View>

                  {error ? (
                    <View style={styles.errorBox}>
                      <AlertCircle
                        size={15}
                        color={COLORS.betclicRed}
                        strokeWidth={2.2}
                        style={{ marginTop: 1 }}
                      />
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  ) : null}

                  <Pressable
                    disabled={loading}
                    onPress={() => void requestResetCode(false)}
                    style={({ pressed }) => [
                      styles.submitBtn,
                      loading && { opacity: 0.6 },
                      pressed && !loading && { transform: [{ scale: 0.99 }] },
                    ]}
                  >
                    {loading ? (
                      <>
                        <ActivityIndicator size="small" color="#ffffff" />
                        <Text style={styles.submitText}>Envoi du code…</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.submitText}>
                          Recevoir le code à 6 chiffres
                        </Text>
                        <ArrowRight size={16} color="#ffffff" strokeWidth={2.5} />
                      </>
                    )}
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      if (isValidEmail(email)) {
                        setError(null);
                        setForgotStep("verify");
                        setTimeout(() => otpInputRef.current?.focus(), 80);
                      } else {
                        setError("Renseignez d'abord votre adresse e-mail.");
                      }
                    }}
                    style={styles.alreadyCodeBtn}
                  >
                    <Text style={styles.alreadyCodeText}>
                      J’ai déjà un code de vérification
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {resolvedView === "forgot" && forgotStep === "verify" ? (
                <View style={styles.form}>
                  <View style={styles.emailSummaryCard}>
                    <View style={styles.emailSummaryRow}>
                      <Text numberOfLines={1} style={styles.emailSummaryAddress}>
                        {email.trim().toLowerCase()}
                      </Text>
                      <Pressable
                        hitSlop={8}
                        onPress={() => {
                          setForgotStep("request");
                          setOtpCode("");
                          setError(null);
                          setInfoMessage(null);
                        }}
                      >
                        <Text style={styles.forgotLink}>Modifier</Text>
                      </Pressable>
                    </View>
                    {infoMessage ? (
                      <Text style={styles.emailSummaryInfo}>{infoMessage}</Text>
                    ) : null}
                  </View>

                  <View style={styles.fieldGroup}>
                    <View style={styles.labelRow}>
                      <Text style={styles.label}>Code à 6 chiffres</Text>
                      <Pressable
                        disabled={resendCooldown > 0 || loading}
                        onPress={() => void requestResetCode(true)}
                        style={styles.resendBtn}
                      >
                        <RefreshCw
                          size={12}
                          color={
                            resendCooldown > 0 ? COLORS.dim : COLORS.betclicRed
                          }
                          strokeWidth={2.4}
                        />
                        <Text
                          style={[
                            styles.forgotLink,
                            resendCooldown > 0 && { color: COLORS.dim },
                          ]}
                        >
                          {resendCooldown > 0
                            ? `Renvoyer (${resendCooldown}s)`
                            : "Renvoyer le code"}
                        </Text>
                      </Pressable>
                    </View>

                    <Pressable
                      onPress={() => otpInputRef.current?.focus()}
                      style={styles.otpContainer}
                    >
                      <View style={styles.otpBoxesRow}>
                        {[0, 1, 2, 3, 4, 5].map((idx) => {
                          const ch = otpCode[idx] ?? "";
                          const activeSlot =
                            focusedField === "otp" &&
                            (otpCode.length === idx ||
                              (otpCode.length === 6 && idx === 5));
                          return (
                            <View
                              key={idx}
                              style={[
                                styles.otpBox,
                                ch ? styles.otpBoxFilled : null,
                                activeSlot ? styles.otpBoxActive : null,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.otpChar,
                                  !ch && { color: COLORS.dim },
                                ]}
                              >
                                {ch || "•"}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                      <TextInput
                        ref={otpInputRef}
                        value={otpCode}
                        onFocus={() => setFocusedField("otp")}
                        onBlur={() => setFocusedField(null)}
                        onChangeText={(v) => {
                          setOtpCode(v.replace(/\D/g, "").slice(0, 6));
                          if (error) setError(null);
                        }}
                        keyboardType="number-pad"
                        textContentType="oneTimeCode"
                        maxLength={6}
                        style={styles.otpHiddenInput}
                      />
                    </Pressable>
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Nouveau mot de passe</Text>
                    <View
                      style={[
                        styles.inputBox,
                        focusedField === "reset-pw" && styles.inputBoxFocused,
                      ]}
                    >
                      <Lock size={16} color={COLORS.dim} strokeWidth={2.1} />
                      <TextInput
                        value={password}
                        onChangeText={(v) => {
                          setPassword(v);
                          if (error) setError(null);
                        }}
                        onFocus={() => setFocusedField("reset-pw")}
                        onBlur={() => setFocusedField(null)}
                        placeholder="Minimum 8 caractères"
                        placeholderTextColor={COLORS.dim}
                        secureTextEntry={!showPass}
                        autoCapitalize="none"
                        returnKeyType="next"
                        onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                        style={styles.input}
                      />
                      <Pressable
                        hitSlop={10}
                        onPress={() => setShowPass((s) => !s)}
                        style={styles.eyeBtn}
                      >
                        {showPass ? (
                          <EyeOff size={16} color={COLORS.dim} strokeWidth={2.1} />
                        ) : (
                          <Eye size={16} color={COLORS.dim} strokeWidth={2.1} />
                        )}
                      </Pressable>
                    </View>

                    {password.length > 0 ? (
                      <View style={styles.strengthWrap}>
                        <View style={styles.strengthHeader}>
                          <Text style={styles.strengthTitle}>
                            Sécurité du mot de passe
                          </Text>
                          <Text
                            style={[
                              styles.strengthLabel,
                              { color: strengthColor },
                            ]}
                          >
                            {pwStrength.label}
                          </Text>
                        </View>
                        <View style={styles.strengthBars}>
                          {[1, 2, 3, 4].map((idx) => (
                            <View
                              key={idx}
                              style={[
                                styles.strengthSegment,
                                {
                                  backgroundColor:
                                    idx <= pwStrength.score
                                      ? strengthColor
                                      : COLORS.edge,
                                },
                              ]}
                            />
                          ))}
                        </View>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>
                      Confirmer le nouveau mot de passe
                    </Text>
                    <View
                      style={[
                        styles.inputBox,
                        focusedField === "reset-cpw" && styles.inputBoxFocused,
                        passwordsMismatch && styles.inputBoxError,
                      ]}
                    >
                      <Lock size={16} color={COLORS.dim} strokeWidth={2.1} />
                      <TextInput
                        ref={confirmPasswordRef}
                        value={confirmPassword}
                        onChangeText={(v) => {
                          setConfirmPassword(v);
                          if (error) setError(null);
                        }}
                        onFocus={() => setFocusedField("reset-cpw")}
                        onBlur={() => setFocusedField(null)}
                        placeholder="Répétez le mot de passe"
                        placeholderTextColor={COLORS.dim}
                        secureTextEntry={!showConfirmPass}
                        autoCapitalize="none"
                        returnKeyType="done"
                        onSubmitEditing={() => void submitResetVerify()}
                        style={styles.input}
                      />
                      {passwordsMatch ? (
                        <CheckCircle2
                          size={16}
                          color={COLORS.win}
                          strokeWidth={2.3}
                        />
                      ) : null}
                      <Pressable
                        hitSlop={10}
                        onPress={() => setShowConfirmPass((s) => !s)}
                        style={styles.eyeBtn}
                      >
                        {showConfirmPass ? (
                          <EyeOff size={16} color={COLORS.dim} strokeWidth={2.1} />
                        ) : (
                          <Eye size={16} color={COLORS.dim} strokeWidth={2.1} />
                        )}
                      </Pressable>
                    </View>
                  </View>

                  {error ? (
                    <View style={styles.errorBox}>
                      <AlertCircle
                        size={15}
                        color={COLORS.betclicRed}
                        strokeWidth={2.2}
                        style={{ marginTop: 1 }}
                      />
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  ) : null}

                  <Pressable
                    disabled={loading}
                    onPress={() => void submitResetVerify()}
                    style={({ pressed }) => [
                      styles.submitBtn,
                      loading && { opacity: 0.6 },
                      pressed && !loading && { transform: [{ scale: 0.99 }] },
                    ]}
                  >
                    {loading ? (
                      <>
                        <ActivityIndicator size="small" color="#ffffff" />
                        <Text style={styles.submitText}>Mise à jour…</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.submitText}>
                          Réinitialiser et me connecter
                        </Text>
                        <ArrowRight size={16} color="#ffffff" strokeWidth={2.5} />
                      </>
                    )}
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>

          {/* Pied de page sécurité & jeu responsable */}
          <View style={styles.footer}>
            <View style={styles.tlsBadgeRow}>
              <ShieldCheck size={13} color={COLORS.win} strokeWidth={2.3} />
              <Text style={styles.tlsText}>
                Connexion chiffrée TLS · Session protégée Pulse Bet
              </Text>
            </View>
            <Text style={styles.footerDisclaimer}>
              <Text style={styles.footerBold}>18+</Text> · Jouer comporte des
              risques : endettement, isolement, dépendance. Aide : 09 74 75 13 13.
            </Text>
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
  flex: {
    flex: 1,
  },
  loaderWrap: {
    flex: 1,
    backgroundColor: COLORS.deep,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 14,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  backPill: {
    height: 36,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  backPillPressed: {
    backgroundColor: COLORS.elev,
  },
  backPillText: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.ink,
  },
  cardWrap: {
    marginVertical: 16,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 12,
    shadowColor: "#111827",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  tabSwitch: {
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
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.mist,
  },
  tabBtnTextActive: {
    fontWeight: "500",
    color: COLORS.ink,
  },
  headingBlock: {
    marginTop: 18,
  },
  h1: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: COLORS.ink,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 11,
    color: COLORS.mist,
    lineHeight: 19,
  },
  forgotBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  forgotIconBox: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: COLORS.redSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  stepPill: {
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  stepPillText: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.mist,
  },
  form: {
    marginTop: 18,
    gap: 14,
  },
  fieldGroup: {
    gap: 6,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  label: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.ink,
  },
  forgotLink: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.betclicRed,
  },
  inputBox: {
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "rgba(244, 245, 247, 0.55)",
    paddingLeft: 14,
    paddingRight: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  inputBoxFocused: {
    borderColor: COLORS.ink,
    backgroundColor: "#ffffff",
  },
  inputBoxError: {
    borderColor: "rgba(225, 0, 20, 0.55)",
  },
  input: {
    flex: 1,
    fontSize: 12,
    color: COLORS.ink,
    paddingVertical: 0,
  },
  eyeBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 2,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    borderColor: COLORS.betclicRed,
    backgroundColor: COLORS.betclicRed,
  },
  rememberText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.mist,
  },
  strengthWrap: {
    marginTop: 4,
    gap: 5,
    paddingHorizontal: 2,
  },
  strengthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  strengthTitle: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.dim,
  },
  strengthLabel: {
    fontSize: 10,
    fontWeight: "500",
  },
  strengthBars: {
    flexDirection: "row",
    gap: 6,
  },
  strengthSegment: {
    flex: 1,
    height: 6,
    borderRadius: 999,
  },
  rulesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingTop: 2,
  },
  ruleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  ruleChipOk: {
    backgroundColor: COLORS.winSoft,
  },
  ruleChipText: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.dim,
  },
  ruleChipTextOk: {
    color: COLORS.win,
    fontWeight: "500",
  },
  termsBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "rgba(244, 245, 247, 0.45)",
    padding: 12,
  },
  termsBoxActive: {
    borderColor: "rgba(17, 24, 39, 0.25)",
    backgroundColor: COLORS.elev,
  },
  termsText: {
    flex: 1,
    fontSize: 10.5,
    lineHeight: 17,
    color: COLORS.mist,
  },
  termsBold: {
    fontWeight: "500",
    color: COLORS.ink,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.redBorder,
    backgroundColor: COLORS.redSoft,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.betclicRed,
    lineHeight: 17,
  },
  submitBtn: {
    marginTop: 2,
    height: 48,
    borderRadius: 16,
    backgroundColor: COLORS.betclicRed,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: COLORS.betclicRed,
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  submitText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#ffffff",
  },
  switchPromptRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    paddingTop: 4,
  },
  switchPromptText: {
    fontSize: 11,
    color: COLORS.mist,
  },
  switchPromptLink: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.ink,
    textDecorationLine: "underline",
  },
  alreadyCodeBtn: {
    alignItems: "center",
    paddingVertical: 4,
  },
  alreadyCodeText: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.mist,
  },
  emailSummaryCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: COLORS.elev,
    padding: 12,
    gap: 4,
  },
  emailSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  emailSummaryAddress: {
    flex: 1,
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.ink,
  },
  emailSummaryInfo: {
    fontSize: 10.5,
    lineHeight: 16,
    color: COLORS.mist,
  },
  resendBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  otpContainer: {
    position: "relative",
  },
  otpBoxesRow: {
    flexDirection: "row",
    gap: 8,
  },
  otpBox: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "rgba(244, 245, 247, 0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  otpBoxFilled: {
    borderColor: "rgba(17, 24, 39, 0.35)",
    backgroundColor: "#ffffff",
  },
  otpBoxActive: {
    borderColor: COLORS.ink,
    borderWidth: 1.5,
    backgroundColor: "#ffffff",
  },
  otpChar: {
    fontSize: 14.5,
    fontWeight: "500",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  otpHiddenInput: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.01,
    color: "transparent",
  },
  footer: {
    paddingTop: 8,
    alignItems: "center",
    gap: 6,
  },
  tlsBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  tlsText: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.dim,
  },
  footerDisclaimer: {
    textAlign: "center",
    fontSize: 10,
    color: COLORS.dim,
    lineHeight: 15,
  },
  footerBold: {
    fontWeight: "500",
    color: COLORS.mist,
  },
  countryLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  countryLockInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  countryLockText: {
    fontSize: 9.5,
    color: COLORS.dim,
  },
  countryTrigger: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "rgba(241,243,247,0.55)",
    paddingHorizontal: 13,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  countryTriggerLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  countryTriggerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  countryFlag: {
    fontSize: 17,
  },
  countryName: {
    fontSize: 12,
    fontWeight: "500",
    color: COLORS.ink,
  },
  countrySub: {
    fontSize: 9.5,
    color: COLORS.dim,
    marginTop: 1,
  },
  currencyBadgePill: {
    borderRadius: 8,
    backgroundColor: "rgba(225,0,20,0.10)",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  currencyBadgePillText: {
    fontSize: 9.5,
    fontWeight: "500",
    color: COLORS.betclicRed,
  },
  countryDropdown: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    overflow: "hidden",
    marginTop: 4,
  },
  countrySearchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    height: 38,
    backgroundColor: "rgba(241,243,247,0.55)",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.edge,
  },
  countrySearchInput: {
    flex: 1,
    fontSize: 11.5,
    color: COLORS.ink,
    paddingVertical: 0,
  },
  countryScroll: {
    maxHeight: 210,
  },
  countryEmpty: {
    paddingVertical: 14,
    textAlign: "center",
    fontSize: 11,
    color: COLORS.dim,
  },
  countryItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.edge,
  },
  countryItemActive: {
    backgroundColor: "rgba(225,0,20,0.06)",
  },
  countryItemFlag: {
    fontSize: 15,
  },
  countryItemName: {
    fontSize: 11.5,
    fontWeight: "500",
    color: COLORS.ink,
  },
  countryCurChip: {
    borderRadius: 6,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  countryCurChipActive: {
    backgroundColor: COLORS.betclicRed,
  },
  countryCurChipText: {
    fontSize: 9.5,
    fontWeight: "500",
    color: COLORS.mist,
  },
  countryHintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 2,
  },
  countryHintText: {
    flex: 1,
    fontSize: 10,
    color: COLORS.dim,
  },
});
