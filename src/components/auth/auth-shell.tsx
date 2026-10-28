"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  User,
  Wallet,
} from "lucide-react";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import { PulseLogo } from "@/components/pulse-logo";
import { useApp } from "@/components/providers";
import { api, type ClientUser } from "@/lib/api";
import {
  evaluatePasswordStrength,
  isValidAuthEmail,
  sanitizeRedirectPath,
} from "@/lib/auth-validation";
import { cn } from "@/lib/format";

export type AuthView = "login" | "register" | "forgot";

export function AuthPageContainer({
  initialView,
  autoResolveFromQuery = false,
}: {
  initialView: AuthView;
  autoResolveFromQuery?: boolean;
}) {
  return (
    <Suspense fallback={<PulseFlashLoader className="min-h-dvh" />}>
      <AuthShellInner
        initialView={initialView}
        autoResolveFromQuery={autoResolveFromQuery}
      />
    </Suspense>
  );
}

function buildAuthHref(
  target: AuthView,
  opts: { from?: string | null; email?: string }
): string {
  const base =
    target === "register"
      ? "/auth/inscription"
      : target === "forgot"
        ? "/auth/mot-de-passe-oublie"
        : "/auth/connexion";
  const sp = new URLSearchParams();
  if (opts.from && opts.from.startsWith("/") && !opts.from.startsWith("/auth")) {
    sp.set("from", opts.from);
  }
  if (opts.email && opts.email.trim()) {
    sp.set("email", opts.email.trim());
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

const EDITORIAL_COPY: Record<
  AuthView,
  { kicker: string; title: string; subtitle: string }
> = {
  login: {
    kicker: "ESPACE JOUEUR SÉCURISÉ",
    title: "Vos paris sportifs et prédictions en temps réel.",
    subtitle:
      "Retrouvez vos tickets actifs, suivez l'évolution des cotes seconde par seconde et pilotez vos Cash Out sans latence.",
  },
  register: {
    kicker: "OUVERTURE DE COMPTE GRATUITE",
    title: "Rejoignez Pulse Bet en moins d'une minute.",
    subtitle:
      "Créez votre compte joueur vérifié pour accéder aux 19 marchés par affiche, aux combinés boostés et aux retraits suivis.",
  },
  forgot: {
    kicker: "PROTECTION DU COMPTE",
    title: "Récupérez votre accès joueur en toute sécurité.",
    subtitle:
      "Vérification par code à usage unique à 6 chiffres et révocation immédiate des anciennes sessions actives.",
  },
};

const TRUST_PILLARS = [
  {
    Icon: TrendingUp,
    title: "19 marchés & Cash Out live",
    desc: "Cotes actualisées en continu sur le football officiel et virtuel 24h/24.",
  },
  {
    Icon: Wallet,
    title: "Portefeuille & retraits tracés",
    desc: "Historique intégral des dépôts, mises et règlements sur votre solde réel.",
  },
  {
    Icon: ShieldCheck,
    title: "Chiffrement & session protégée",
    desc: "Authentification signée, anti-rejeu sur chaque ticket et révocation instantanée.",
  },
] as const;

function StrengthBar({ score, label }: { score: number; label: string }) {
  const toneText =
    score >= 4
      ? "text-win"
      : score === 3
        ? "text-emerald-600"
        : score === 2
          ? "text-amber-600"
          : "text-betclic-red";
  const barActive =
    score >= 4
      ? "bg-win"
      : score === 3
        ? "bg-emerald-500"
        : score === 2
          ? "bg-amber-500"
          : "bg-betclic-red";

  return (
    <div className="mt-2 space-y-1.5 px-0.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-dim">Sécurité du mot de passe</span>
        <span className={cn("font-display font-bold", toneText)}>{label}</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {[1, 2, 3, 4].map((idx) => (
          <span
            key={idx}
            className={cn(
              "h-1.5 rounded-full transition-colors duration-200",
              idx <= score ? barActive : "bg-edge"
            )}
          />
        ))}
      </div>
    </div>
  );
}

function RuleChip({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
        ok ? "bg-win/10 text-win" : "bg-elev text-dim"
      )}
    >
      <Check className="h-3 w-3 shrink-0" strokeWidth={ok ? 2.8 : 2} />
      {text}
    </span>
  );
}

function AuthShellInner({
  initialView,
  autoResolveFromQuery,
}: {
  initialView: AuthView;
  autoResolveFromQuery: boolean;
}) {
  const { user, applyUser, toast } = useApp();
  const router = useRouter();
  const params = useSearchParams();

  const resolvedView: AuthView = useMemo(() => {
    if (!autoResolveFromQuery) return initialView;
    const m = params.get("mode");
    if (m === "register" || m === "signup" || m === "inscription") {
      return "register";
    }
    if (m === "forgot" || m === "reset") {
      return "forgot";
    }
    return "login";
  }, [autoResolveFromQuery, initialView, params]);

  const fromParam = params.get("from");
  const safeDest = useMemo(() => sanitizeRedirectPath(fromParam), [fromParam]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState(() => params.get("email")?.trim() ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // États spécifiques « Mot de passe oublié »
  const [forgotStep, setForgotStep] = useState<"request" | "verify">("request");
  const [otpCode, setOtpCode] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [otpFocused, setOtpFocused] = useState(false);
  const otpInputRef = useRef<HTMLInputElement | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  const completeAuth = useCallback(
    (loggedUser: ClientUser, kind: "login" | "register" | "reset") => {
      applyUser(loggedUser);
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
      if (isAdminUser) {
        router.replace("/admin");
        return;
      }
      router.replace(safeDest);
    },
    [applyUser, router, safeDest, toast]
  );

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!isValidAuthEmail(cleanEmail)) {
      setError("Veuillez saisir une adresse e-mail valide.");
      return;
    }
    if (!password) {
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
      setError(
        err instanceof Error ? err.message : "Impossible de vous connecter."
      );
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);

    const cleanName = name.trim().replace(/\s+/g, " ");
    const cleanEmail = email.trim().toLowerCase();

    if (cleanName.length < 2) {
      setError("Veuillez indiquer un nom ou pseudonyme (2 caractères minimum).");
      return;
    }
    if (!isValidAuthEmail(cleanEmail)) {
      setError("Veuillez saisir une adresse e-mail valide.");
      return;
    }
    if (!pwStrength.isValid) {
      setError(
        "Le mot de passe doit contenir au moins 8 caractères dont une lettre et un chiffre."
      );
      return;
    }
    if (password !== confirmPassword) {
      setError("La confirmation du mot de passe ne correspond pas.");
      return;
    }
    if (!acceptedTerms) {
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
        acceptedTerms: true,
      });
      completeAuth(r.user, "register");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Création du compte impossible."
      );
      setLoading(false);
    }
  };

  const requestResetCode = async (isResend = false) => {
    if (loading) return;
    setError(null);
    setInfoMessage(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!isValidAuthEmail(cleanEmail)) {
      setError("Veuillez saisir une adresse e-mail valide.");
      return;
    }

    setLoading(true);
    try {
      const r = await api.auth.forgotPassword({ email: cleanEmail });
      setForgotStep("verify");
      setResendCooldown(60);
      setInfoMessage(
        isResend
          ? `Un nouveau code de sécurité (valable ${r.expiresInMinutes} min) a été généré.`
          : `Si un compte est associé à ${cleanEmail}, un code à 6 chiffres (valable ${r.expiresInMinutes} min) a été envoyé.`
      );
      setTimeout(() => otpInputRef.current?.focus(), 60);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Impossible d'envoyer le code de vérification."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleForgotRequestSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await requestResetCode(false);
  };

  const handleResetVerifySubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);

    const cleanCode = otpCode.replace(/\D/g, "").slice(0, 6);
    if (cleanCode.length !== 6) {
      setError("Veuillez saisir les 6 chiffres du code de vérification.");
      return;
    }
    if (!pwStrength.isValid) {
      setError(
        "Le nouveau mot de passe doit contenir au moins 8 caractères dont une lettre et un chiffre."
      );
      return;
    }
    if (password !== confirmPassword) {
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
      setError(
        err instanceof Error
          ? err.message
          : "Impossible de réinitialiser le mot de passe."
      );
      setLoading(false);
    }
  };

  if (user) {
    return <PulseFlashLoader className="min-h-dvh" />;
  }

  const editorial = EDITORIAL_COPY[resolvedView];
  const loginHref = buildAuthHref("login", { from: fromParam, email });
  const registerHref = buildAuthHref("register", { from: fromParam, email });
  const forgotHref = buildAuthHref("forgot", { from: fromParam, email });

  return (
    <div className="flex min-h-dvh w-full flex-1 flex-col bg-deep lg:grid lg:grid-cols-[minmax(420px,45%)_1fr] xl:grid-cols-[minmax(480px,44%)_1fr]">
      {/* ─── Panneau éditorial gauche (Desktop lg+) ─── */}
      <aside className="relative hidden overflow-hidden bg-[#090D16] text-white lg:flex lg:flex-col lg:justify-between lg:p-10 xl:p-12">
        {/* Halos subtils rouge Pulse Bet + trame architecturale */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-betclic-red/22 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-28 right-0 h-72 w-72 rounded-full bg-betclic-red/14 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* Barre supérieure marque */}
        <div className="relative z-10 flex items-center justify-between gap-4">
          <Link
            href="/matchs"
            className="inline-flex items-center transition-opacity hover:opacity-90"
          >
            <PulseLogo
              size="lg"
              variant="dark"
              subtitle="Paris sportifs & Prédictions"
            />
          </Link>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-3 py-1 font-display text-[11px] font-bold tracking-wide text-white/90">
            <span className="live-dot h-2 w-2 rounded-full bg-betclic-red" />
            Live 24h/24
          </span>
        </div>

        {/* Bloc éditorial central */}
        <div className="relative z-10 my-auto py-8">
          <p className="font-display text-[11px] font-extrabold uppercase tracking-[0.14em] text-betclic-red">
            {editorial.kicker}
          </p>
          <h2 className="mt-2.5 max-w-[440px] font-display text-[32px] font-extrabold leading-[1.12] tracking-tight text-white xl:text-[36px]">
            {editorial.title}
          </h2>
          <p className="mt-3 max-w-[430px] text-[14px] leading-relaxed text-slate-300/90">
            {editorial.subtitle}
          </p>

          <div className="mt-8 space-y-2.5 max-w-[440px]">
            {TRUST_PILLARS.map(({ Icon, title, desc }) => (
              <div
                key={title}
                className="flex items-start gap-3.5 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 backdrop-blur-xs"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-betclic-red/18 text-betclic-red">
                  <Icon className="h-4.5 w-4.5" strokeWidth={2.2} />
                </span>
                <div className="min-w-0">
                  <p className="font-display text-[13.5px] font-bold text-white">
                    {title}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-slate-400">
                    {desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bandeau réglementaire bas */}
        <div className="relative z-10 flex items-center gap-3 border-t border-white/10 pt-5">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/8 font-display text-[11px] font-black text-white">
            18+
          </span>
          <p className="text-[11.5px] leading-relaxed text-slate-400">
            Jouer comporte des risques : endettement, isolement, dépendance. Pour
            être aidé, appelez le{" "}
            <span className="font-semibold text-white">09 74 75 13 13</span>{" "}
            (appel non surtaxé).
          </p>
        </div>
      </aside>

      {/* ─── Colonne formulaire (Mobile < lg 1:1 Android & Desktop droite) ─── */}
      <main className="pt-safe pb-safe flex min-h-dvh w-full flex-col justify-between px-4 py-4 sm:px-6 sm:py-6 lg:px-10 lg:py-8">
        {/* Barre haute navigation */}
        <header className="flex items-center justify-between gap-3">
          <Link
            href="/matchs"
            className="inline-flex items-center active:opacity-80 lg:invisible"
          >
            <PulseLogo size="sm" variant="light" />
          </Link>

          {resolvedView === "forgot" ? (
            <Link
              href={loginHref}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-edge bg-white px-3.5 font-display text-[12.5px] font-bold text-ink shadow-2xs transition-colors hover:bg-elev active:scale-[0.99]"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-mist" strokeWidth={2.4} />
              <span>Connexion</span>
            </Link>
          ) : (
            <Link
              href="/matchs"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-edge bg-white px-3.5 font-display text-[12.5px] font-bold text-ink shadow-2xs transition-colors hover:bg-elev active:scale-[0.99]"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-mist" strokeWidth={2.4} />
              <span className="lg:hidden">Matchs</span>
              <span className="hidden lg:inline">Retour aux matchs</span>
            </Link>
          )}
        </header>

        {/* Carte centrale d'authentification */}
        <div className="my-auto py-4 lg:py-6">
          <div className="mx-auto w-full rounded-3xl border border-edge bg-white p-5 shadow-[0_2px_12px_rgba(17,24,39,0.04)] sm:p-6 lg:max-w-[468px] lg:p-8 lg:shadow-[0_16px_44px_-16px_rgba(17,24,39,0.09)]">
            {resolvedView !== "forgot" ? (
              <>
                {/* Sélecteur de page dédiée Connexion / Inscription */}
                <nav
                  aria-label="Authentification"
                  className="grid grid-cols-2 gap-1 rounded-2xl border border-edge bg-elev p-1"
                >
                  <Link
                    href={loginHref}
                    replace
                    aria-current={resolvedView === "login" ? "page" : undefined}
                    className={cn(
                      "flex h-10 items-center justify-center rounded-xl font-display text-[13px] transition-all",
                      resolvedView === "login"
                        ? "bg-white font-bold text-ink shadow-xs"
                        : "font-semibold text-mist hover:text-ink"
                    )}
                  >
                    Connexion
                  </Link>
                  <Link
                    href={registerHref}
                    replace
                    aria-current={resolvedView === "register" ? "page" : undefined}
                    className={cn(
                      "flex h-10 items-center justify-center rounded-xl font-display text-[13px] transition-all",
                      resolvedView === "register"
                        ? "bg-white font-bold text-ink shadow-xs"
                        : "font-semibold text-mist hover:text-ink"
                    )}
                  >
                    Inscription
                  </Link>
                </nav>

                <div className="mt-5">
                  <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-ink sm:text-[24px]">
                    {resolvedView === "login"
                      ? "Connexion à votre compte"
                      : "Créer un compte joueur"}
                  </h1>
                  <p className="mt-1 text-[13px] leading-relaxed text-mist">
                    {resolvedView === "login"
                      ? "Accédez à vos paris en direct, vos prédictions et votre portefeuille."
                      : "Inscription gratuite pour parier sur les matchs officiels et virtuels."}
                  </p>
                </div>
              </>
            ) : (
              /* En-tête dédié Mot de passe oublié */
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="grid h-10 w-10 place-items-center rounded-2xl bg-betclic-red/10 text-betclic-red">
                    <KeyRound className="h-5 w-5" strokeWidth={2.2} />
                  </span>
                  <span className="rounded-full bg-elev px-2.5 py-1 font-display text-[11px] font-bold text-mist">
                    {forgotStep === "request" ? "Étape 1 sur 2" : "Étape 2 sur 2"}
                  </span>
                </div>
                <h1 className="mt-4 font-display text-[22px] font-extrabold leading-tight tracking-tight text-ink sm:text-[24px]">
                  {forgotStep === "request"
                    ? "Mot de passe oublié"
                    : "Vérification de sécurité"}
                </h1>
                <p className="mt-1 text-[13px] leading-relaxed text-mist">
                  {forgotStep === "request"
                    ? "Saisissez l'adresse e-mail de votre compte pour recevoir un code à 6 chiffres."
                    : "Entrez le code à 6 chiffres reçu puis définissez votre nouveau mot de passe."}
                </p>
              </div>
            )}

            {/* ═══ VUE 1 : CONNEXION ═══ */}
            {resolvedView === "login" && (
              <form
                onSubmit={handleLoginSubmit}
                className="mt-5 flex flex-col gap-3.5"
                noValidate
              >
                <div className="space-y-1.5">
                  <label
                    htmlFor="login-email"
                    className="block text-[12px] font-semibold text-ink"
                  >
                    Adresse e-mail
                  </label>
                  <div className="flex h-12 items-center gap-3 rounded-2xl border border-edge bg-deep/45 px-3.5 transition-colors focus-within:border-ink focus-within:bg-white">
                    <Mail className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.1} />
                    <input
                      id="login-email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (error) setError(null);
                      }}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="vous@exemple.com"
                      required
                      className="h-full w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-dim"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="login-password"
                      className="text-[12px] font-semibold text-ink"
                    >
                      Mot de passe
                    </label>
                    <Link
                      href={forgotHref}
                      className="font-display text-[12px] font-bold text-betclic-red transition-opacity hover:opacity-80"
                    >
                      Mot de passe oublié ?
                    </Link>
                  </div>
                  <div className="flex h-12 items-center gap-3 rounded-2xl border border-edge bg-deep/45 pl-3.5 pr-1.5 transition-colors focus-within:border-ink focus-within:bg-white">
                    <Lock className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.1} />
                    <input
                      id="login-password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (error) setError(null);
                      }}
                      type={showPw ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="Votre mot de passe"
                      required
                      className="h-full w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-dim"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((s) => !s)}
                      aria-label={
                        showPw ? "Masquer le mot de passe" : "Afficher le mot de passe"
                      }
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-dim transition-colors hover:bg-elev hover:text-ink active:bg-elev"
                    >
                      {showPw ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  role="checkbox"
                  aria-checked={rememberMe}
                  onClick={() => setRememberMe((v) => !v)}
                  className="flex items-center gap-2.5 py-0.5 text-left"
                >
                  <span
                    className={cn(
                      "grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors",
                      rememberMe
                        ? "border-betclic-red bg-betclic-red text-white"
                        : "border-edge bg-white text-transparent"
                    )}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                  <span className="text-[12.5px] font-medium text-mist">
                    Rester connecté sur cet appareil (30 jours)
                  </span>
                </button>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-2xl border border-betclic-red/25 bg-betclic-red/8 px-3.5 py-2.5 text-[12.5px] font-medium text-betclic-red"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-betclic-red font-display text-[14.5px] font-bold text-white shadow-[0_6px_18px_-4px_rgba(225,0,20,0.42)] transition-all hover:bg-betclic-red-deep active:scale-[0.99] disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
                      <span>Connexion en cours…</span>
                    </>
                  ) : (
                    <>
                      <span>Se connecter</span>
                      <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                    </>
                  )}
                </button>

                <p className="pt-1 text-center text-[12.5px] text-mist">
                  Nouveau sur Pulse Bet ?{" "}
                  <Link
                    href={registerHref}
                    replace
                    className="font-display font-bold text-ink underline decoration-edge underline-offset-4 hover:text-betclic-red"
                  >
                    Ouvrir un compte
                  </Link>
                </p>
              </form>
            )}

            {/* ═══ VUE 2 : INSCRIPTION ═══ */}
            {resolvedView === "register" && (
              <form
                onSubmit={handleRegisterSubmit}
                className="mt-5 flex flex-col gap-3.5"
                noValidate
              >
                <div className="space-y-1.5">
                  <label
                    htmlFor="reg-name"
                    className="block text-[12px] font-semibold text-ink"
                  >
                    Nom complet ou pseudonyme
                  </label>
                  <div className="flex h-12 items-center gap-3 rounded-2xl border border-edge bg-deep/45 px-3.5 transition-colors focus-within:border-ink focus-within:bg-white">
                    <User className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.1} />
                    <input
                      id="reg-name"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (error) setError(null);
                      }}
                      autoComplete="name"
                      maxLength={40}
                      placeholder="Ex. Karim Mensah"
                      required
                      className="h-full w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-dim"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="reg-email"
                    className="block text-[12px] font-semibold text-ink"
                  >
                    Adresse e-mail
                  </label>
                  <div className="flex h-12 items-center gap-3 rounded-2xl border border-edge bg-deep/45 px-3.5 transition-colors focus-within:border-ink focus-within:bg-white">
                    <Mail className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.1} />
                    <input
                      id="reg-email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (error) setError(null);
                      }}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="vous@exemple.com"
                      required
                      className="h-full w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-dim"
                    />
                    {isValidAuthEmail(email) && (
                      <CheckCircle2
                        className="h-4 w-4 shrink-0 text-win"
                        strokeWidth={2.3}
                      />
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="reg-password"
                    className="block text-[12px] font-semibold text-ink"
                  >
                    Mot de passe
                  </label>
                  <div className="flex h-12 items-center gap-3 rounded-2xl border border-edge bg-deep/45 pl-3.5 pr-1.5 transition-colors focus-within:border-ink focus-within:bg-white">
                    <Lock className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.1} />
                    <input
                      id="reg-password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (error) setError(null);
                      }}
                      type={showPw ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Minimum 8 caractères"
                      required
                      className="h-full w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-dim"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((s) => !s)}
                      aria-label={
                        showPw ? "Masquer le mot de passe" : "Afficher le mot de passe"
                      }
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-dim transition-colors hover:bg-elev hover:text-ink active:bg-elev"
                    >
                      {showPw ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  {password.length > 0 && (
                    <StrengthBar
                      score={pwStrength.score}
                      label={pwStrength.label}
                    />
                  )}

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <RuleChip ok={pwStrength.hasMinLength} text="8+ caractères" />
                    <RuleChip ok={pwStrength.hasLetter} text="1 lettre" />
                    <RuleChip
                      ok={pwStrength.hasDigitOrSymbol}
                      text="1 chiffre ou symbole"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="reg-confirm-password"
                    className="block text-[12px] font-semibold text-ink"
                  >
                    Confirmer le mot de passe
                  </label>
                  <div
                    className={cn(
                      "flex h-12 items-center gap-3 rounded-2xl border bg-deep/45 pl-3.5 pr-1.5 transition-colors focus-within:bg-white",
                      passwordsMismatch
                        ? "border-betclic-red/50 focus-within:border-betclic-red"
                        : "border-edge focus-within:border-ink"
                    )}
                  >
                    <Lock className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.1} />
                    <input
                      id="reg-confirm-password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        if (error) setError(null);
                      }}
                      type={showConfirmPw ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Répétez le mot de passe"
                      required
                      className="h-full w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-dim"
                    />
                    {passwordsMatch && (
                      <CheckCircle2
                        className="h-4 w-4 shrink-0 text-win"
                        strokeWidth={2.3}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setShowConfirmPw((s) => !s)}
                      aria-label={
                        showConfirmPw
                          ? "Masquer la confirmation"
                          : "Afficher la confirmation"
                      }
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-dim transition-colors hover:bg-elev hover:text-ink active:bg-elev"
                    >
                      {showConfirmPw ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Attestation 18+ & Conditions générales */}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={acceptedTerms}
                  onClick={() => {
                    setAcceptedTerms((v) => !v);
                    if (error) setError(null);
                  }}
                  className={cn(
                    "flex items-start gap-3 rounded-2xl border p-3 text-left transition-colors",
                    acceptedTerms
                      ? "border-ink/25 bg-elev/55"
                      : "border-edge bg-deep/35 hover:bg-elev/40"
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors",
                      acceptedTerms
                        ? "border-betclic-red bg-betclic-red text-white"
                        : "border-edge bg-white text-transparent"
                    )}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                  <span className="text-[12px] leading-snug text-mist">
                    <strong className="font-display font-bold text-ink">18+</strong> ·
                    Je certifie être majeur et j&apos;accepte le règlement des paris
                    ainsi que la politique de jeu responsable Pulse Bet.
                  </span>
                </button>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-2xl border border-betclic-red/25 bg-betclic-red/8 px-3.5 py-2.5 text-[12.5px] font-medium text-betclic-red"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-0.5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-betclic-red font-display text-[14.5px] font-bold text-white shadow-[0_6px_18px_-4px_rgba(225,0,20,0.42)] transition-all hover:bg-betclic-red-deep active:scale-[0.99] disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
                      <span>Création du compte…</span>
                    </>
                  ) : (
                    <>
                      <span>Ouvrir mon compte</span>
                      <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                    </>
                  )}
                </button>

                <p className="pt-1 text-center text-[12.5px] text-mist">
                  Vous avez déjà un compte ?{" "}
                  <Link
                    href={loginHref}
                    replace
                    className="font-display font-bold text-ink underline decoration-edge underline-offset-4 hover:text-betclic-red"
                  >
                    Se connecter
                  </Link>
                </p>
              </form>
            )}

            {/* ═══ VUE 3 : MOT DE PASSE OUBLIÉ (2 ÉTAPES) ═══ */}
            {resolvedView === "forgot" && forgotStep === "request" && (
              <form
                onSubmit={handleForgotRequestSubmit}
                className="mt-5 flex flex-col gap-3.5"
                noValidate
              >
                <div className="space-y-1.5">
                  <label
                    htmlFor="forgot-email"
                    className="block text-[12px] font-semibold text-ink"
                  >
                    Adresse e-mail du compte
                  </label>
                  <div className="flex h-12 items-center gap-3 rounded-2xl border border-edge bg-deep/45 px-3.5 transition-colors focus-within:border-ink focus-within:bg-white">
                    <Mail className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.1} />
                    <input
                      id="forgot-email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (error) setError(null);
                      }}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="vous@exemple.com"
                      required
                      className="h-full w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-dim"
                    />
                  </div>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-2xl border border-betclic-red/25 bg-betclic-red/8 px-3.5 py-2.5 text-[12.5px] font-medium text-betclic-red"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-betclic-red font-display text-[14.5px] font-bold text-white shadow-[0_6px_18px_-4px_rgba(225,0,20,0.42)] transition-all hover:bg-betclic-red-deep active:scale-[0.99] disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
                      <span>Envoi du code…</span>
                    </>
                  ) : (
                    <>
                      <span>Recevoir le code à 6 chiffres</span>
                      <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (isValidAuthEmail(email)) {
                      setError(null);
                      setForgotStep("verify");
                    } else {
                      setError("Renseignez d'abord votre adresse e-mail.");
                    }
                  }}
                  className="text-center font-display text-[12px] font-bold text-mist hover:text-ink"
                >
                  J&apos;ai déjà un code de vérification
                </button>
              </form>
            )}

            {resolvedView === "forgot" && forgotStep === "verify" && (
              <form
                onSubmit={handleResetVerifySubmit}
                className="mt-5 flex flex-col gap-3.5"
                noValidate
              >
                {/* Bandeau récapitulatif e-mail + renvoi */}
                <div className="rounded-2xl border border-edge bg-elev/65 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-semibold text-ink">
                      {email.trim().toLowerCase()}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setForgotStep("request");
                        setOtpCode("");
                        setError(null);
                        setInfoMessage(null);
                      }}
                      className="shrink-0 font-display text-[11.5px] font-bold text-betclic-red hover:underline"
                    >
                      Modifier
                    </button>
                  </div>
                  {infoMessage && (
                    <p className="mt-1 text-[11.5px] leading-snug text-mist">
                      {infoMessage}
                    </p>
                  )}
                </div>

                {/* Saisie du code à 6 chiffres */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="reset-otp-input"
                      className="text-[12px] font-semibold text-ink"
                    >
                      Code à 6 chiffres
                    </label>
                    <button
                      type="button"
                      disabled={resendCooldown > 0 || loading}
                      onClick={() => void requestResetCode(true)}
                      className="inline-flex items-center gap-1 font-display text-[11.5px] font-bold text-betclic-red disabled:text-dim"
                    >
                      <RefreshCw className="h-3 w-3" strokeWidth={2.4} />
                      {resendCooldown > 0
                        ? `Renvoyer (${resendCooldown}s)`
                        : "Renvoyer le code"}
                    </button>
                  </div>

                  <div className="relative">
                    <div className="grid grid-cols-6 gap-2">
                      {[0, 1, 2, 3, 4, 5].map((idx) => {
                        const ch = otpCode[idx] ?? "";
                        const isActiveSlot =
                          otpFocused &&
                          (otpCode.length === idx ||
                            (otpCode.length === 6 && idx === 5));
                        return (
                          <div
                            key={idx}
                            className={cn(
                              "grid h-12 place-items-center rounded-xl border font-display text-[19px] font-extrabold tabular-nums transition-colors",
                              isActiveSlot
                                ? "border-ink bg-white text-ink ring-2 ring-ink/10"
                                : ch
                                  ? "border-ink/35 bg-white text-ink"
                                  : "border-edge bg-deep/45 text-dim"
                            )}
                          >
                            {ch || "•"}
                          </div>
                        );
                      })}
                    </div>
                    <input
                      ref={otpInputRef}
                      id="reset-otp-input"
                      value={otpCode}
                      onFocus={() => setOtpFocused(true)}
                      onBlur={() => setOtpFocused(false)}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                        setOtpCode(digits);
                        if (error) setError(null);
                      }}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      aria-label="Code de sécurité à 6 chiffres"
                      className="absolute inset-0 h-full w-full cursor-text opacity-0 text-[16px]"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="reset-new-password"
                    className="block text-[12px] font-semibold text-ink"
                  >
                    Nouveau mot de passe
                  </label>
                  <div className="flex h-12 items-center gap-3 rounded-2xl border border-edge bg-deep/45 pl-3.5 pr-1.5 transition-colors focus-within:border-ink focus-within:bg-white">
                    <Lock className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.1} />
                    <input
                      id="reset-new-password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (error) setError(null);
                      }}
                      type={showPw ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Minimum 8 caractères"
                      required
                      className="h-full w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-dim"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((s) => !s)}
                      aria-label={
                        showPw ? "Masquer le mot de passe" : "Afficher le mot de passe"
                      }
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-dim transition-colors hover:bg-elev hover:text-ink"
                    >
                      {showPw ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  {password.length > 0 && (
                    <StrengthBar
                      score={pwStrength.score}
                      label={pwStrength.label}
                    />
                  )}
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="reset-confirm-password"
                    className="block text-[12px] font-semibold text-ink"
                  >
                    Confirmer le nouveau mot de passe
                  </label>
                  <div
                    className={cn(
                      "flex h-12 items-center gap-3 rounded-2xl border bg-deep/45 pl-3.5 pr-1.5 transition-colors focus-within:bg-white",
                      passwordsMismatch
                        ? "border-betclic-red/50 focus-within:border-betclic-red"
                        : "border-edge focus-within:border-ink"
                    )}
                  >
                    <Lock className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.1} />
                    <input
                      id="reset-confirm-password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        if (error) setError(null);
                      }}
                      type={showConfirmPw ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Répétez le mot de passe"
                      required
                      className="h-full w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-dim"
                    />
                    {passwordsMatch && (
                      <CheckCircle2
                        className="h-4 w-4 shrink-0 text-win"
                        strokeWidth={2.3}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setShowConfirmPw((s) => !s)}
                      aria-label={
                        showConfirmPw
                          ? "Masquer la confirmation"
                          : "Afficher la confirmation"
                      }
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-dim transition-colors hover:bg-elev hover:text-ink"
                    >
                      {showConfirmPw ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-2xl border border-betclic-red/25 bg-betclic-red/8 px-3.5 py-2.5 text-[12.5px] font-medium text-betclic-red"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-betclic-red font-display text-[14.5px] font-bold text-white shadow-[0_6px_18px_-4px_rgba(225,0,20,0.42)] transition-all hover:bg-betclic-red-deep active:scale-[0.99] disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
                      <span>Mise à jour…</span>
                    </>
                  ) : (
                    <>
                      <span>Réinitialiser et me connecter</span>
                      <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Pied de page sécurité & jeu responsable */}
        <footer className="mx-auto w-full max-w-[468px] space-y-2 pt-3 text-center">
          <div className="inline-flex items-center justify-center gap-1.5 text-[11px] font-medium text-dim">
            <ShieldCheck className="h-3.5 w-3.5 text-win" strokeWidth={2.3} />
            <span>Connexion chiffrée TLS · Session protégée Pulse Bet</span>
          </div>
          <p className="text-[10.5px] leading-relaxed text-dim lg:hidden">
            <strong className="font-display font-bold text-mist">18+</strong> ·
            Jouer comporte des risques : endettement, isolement, dépendance. Aide
            : 09 74 75 13 13.
          </p>
        </footer>
      </main>
    </div>
  );
}
