"use client";

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, User, Zap } from "lucide-react";
import { PulseLogo } from "@/components/pulse-logo";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import { useApp } from "@/components/providers";
import { api } from "@/lib/api";
import { cn } from "@/lib/format";

type Mode = "login" | "register";

export default function AuthPage() {
  return (
    <Suspense fallback={<PulseFlashLoader className="min-h-dvh" />}>
      <AuthInner />
    </Suspense>
  );
}

function AuthInner() {
  const { user, applyUser, toast } = useApp();
  const router = useRouter();
  const params = useSearchParams();

  const [mode, setMode] = useState<Mode>(() =>
    params.get("mode") === "register" ? "register" : "login"
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  useEffect(() => {
    if (user) {
      router.replace(user.role === "admin" ? "/admin" : "/matchs");
    }
  }, [user, router]);

  const finishLogin = useCallback(
    (loggedUser: Parameters<typeof applyUser>[0], created: boolean) => {
      applyUser(loggedUser);
      const isAdminUser = loggedUser?.role === "admin";
      toast({
        kind: "success",
        title: isAdminUser
          ? "Connexion administrateur"
          : created
            ? "Compte créé"
            : "Connexion réussie",
      });
      if (isAdminUser) {
        router.replace("/admin");
        return;
      }
      const from = params.get("from");
      const safeDest =
        from && from.startsWith("/") && !from.startsWith("/admin") ? from : "/matchs";
      router.push(safeDest);
    },
    [applyUser, params, router, toast]
  );

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (loading || demoLoading) return;
      setError(null);
      setLoading(true);
      try {
        const r =
          mode === "register"
            ? await api.auth.register({ name, email, password })
            : await api.auth.login({ email, password });
        finishLogin(r.user, mode === "register");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Une erreur est survenue");
      } finally {
        setLoading(false);
      }
    },
    [loading, demoLoading, mode, name, email, password, finishLogin]
  );

  const loginDemo = async () => {
    if (loading || demoLoading) return;
    setError(null);
    setDemoLoading(true);
    try {
      const r = await api.auth.login({ email: "demo@pulse.app", password: "demo1234" });
      finishLogin(r.user, false);
    } catch (err) {
      setMode("login");
      setEmail("demo@pulse.app");
      setPassword("demo1234");
      setError(err instanceof Error ? err.message : "Impossible de charger le compte démo");
    } finally {
      setDemoLoading(false);
    }
  };

  if (user) {
    return <PulseFlashLoader className="min-h-dvh" />;
  }

  return (
    <main className="pt-safe pb-safe flex min-h-dvh w-full flex-1 flex-col justify-between px-5 py-6 lg:items-center lg:justify-center lg:px-10 lg:py-12">
      <div className="w-full lg:max-w-[440px] lg:rounded-3xl lg:border lg:border-edge lg:bg-white lg:p-8 lg:shadow-xs">
        {/* En-tête officiel Pulse Bet */}
        <div className="flex items-center gap-2.5">
          <PulseLogo
            size="md"
            variant="light"
            subtitle="Paris sportifs & prédictions"
          />
        </div>

        {/* Titre concis */}
        <div className="mt-6">
          <h1 className="font-display text-[24px] font-bold leading-tight tracking-tight text-ink">
            {mode === "login" ? "Bon retour" : "Créer un compte"}
          </h1>
          <p className="mt-1 text-[13px] text-mist">
            {mode === "login"
              ? "Accédez à vos prédictions, matchs en direct et paris."
              : "250,00 € crédités dès l'inscription pour démarrer."}
          </p>
        </div>

        {/* Sélecteur Connexion / Inscription */}
        <div className="mt-5 grid grid-cols-2 gap-1 rounded-2xl border border-edge bg-elev p-1">
          {(["login", "register"] as const).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={cn(
                  "h-10 rounded-xl font-display text-[13px] transition-colors",
                  active
                    ? "bg-white font-bold text-ink shadow-xs"
                    : "font-medium text-mist"
                )}
              >
                {m === "login" ? "Connexion" : "Inscription"}
              </button>
            );
          })}
        </div>

        {/* Formulaire (inputs en 16px pour éviter le zoom auto sur iOS) */}
        <form onSubmit={submit} className="mt-4 flex flex-col gap-2.5" noValidate>
          {mode === "register" && (
            <label className="glass-card flex h-12 items-center gap-3 rounded-2xl px-3.5 focus-within:border-ink">
              <User className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.1} />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder="Nom d'utilisateur"
                required
                className="h-full w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-dim"
              />
            </label>
          )}

          <label className="glass-card flex h-12 items-center gap-3 rounded-2xl px-3.5 focus-within:border-ink">
            <Mail className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.1} />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="Adresse e-mail"
              required
              className="h-full w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-dim"
            />
          </label>

          <label className="glass-card flex h-12 items-center gap-3 rounded-2xl pl-3.5 pr-1.5 focus-within:border-ink">
            <Lock className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.1} />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPw ? "text" : "password"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="Mot de passe"
              required
              className="h-full w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-dim"
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              aria-label={showPw ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-dim active:bg-elev"
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </label>

          {error && (
            <p className="rounded-xl bg-betclic-red/8 px-3 py-2 text-[12.5px] font-medium text-betclic-red">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || demoLoading}
            className="mt-1.5 flex h-12 items-center justify-center gap-2 rounded-2xl bg-betclic-red font-display text-[14.5px] font-bold text-white transition-opacity active:opacity-90 disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
                Connexion…
              </>
            ) : (
              <>
                {mode === "register" ? "Créer mon compte" : "Se connecter"}
                <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
              </>
            )}
          </button>
        </form>

        {/* Accès rapide démo en 1 tap */}
        <div className="mt-4">
          <button
            type="button"
            onClick={loginDemo}
            disabled={loading || demoLoading}
            className="glass-card flex h-11 w-full items-center justify-center gap-2 rounded-2xl px-4 text-[12.5px] font-semibold text-ink transition-colors active:bg-elev disabled:opacity-60"
          >
            {demoLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-betclic-red" strokeWidth={2.4} />
            ) : (
              <Zap className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.4} />
            )}
            Accès rapide avec le compte démo
          </button>
        </div>
      </div>

      <p className="pt-6 text-center text-[10.5px] leading-relaxed text-dim">
        18+ · Jouer comporte des risques : endettement, isolement, dépendance.
      </p>
    </main>
  );
}
