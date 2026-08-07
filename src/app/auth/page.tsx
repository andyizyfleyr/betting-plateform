"use client";

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Eye, EyeOff, Loader2, Mail, ShieldCheck, User, Zap } from "lucide-react";
import { useApp } from "@/components/providers";
import { api } from "@/lib/api";
import { cn } from "@/lib/format";

type Mode = "login" | "register";

const spring = { type: "spring", stiffness: 480, damping: 38 } as const;

export default function AuthPage() {
  return (
    <Suspense fallback={null}>
      <AuthInner />
    </Suspense>
  );
}

function AuthInner() {
  const { user, applyUser, toast } = useApp();
  const router = useRouter();
  const params = useSearchParams();

  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      router.replace("/matchs");
    }
  }, [user, router]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (loading) return;
      setError(null);
      setLoading(true);
      try {
        const r =
          mode === "register"
            ? await api.auth.register({ name, email, password })
            : await api.auth.login({ email, password });
        applyUser(r.user);
        toast({
          kind: "success",
          title: mode === "register" ? "Compte créé" : "Bienvenue sur PULSE",
          description: "Vous êtes connecté",
        });
        const from = params.get("from");
        router.push(from && from.startsWith("/") ? from : "/matchs");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Une erreur est survenue");
      } finally {
        setLoading(false);
      }
    },
    [loading, mode, name, email, password, params, router, applyUser, toast]
  );

  return (
    <main className="flex flex-1 flex-col px-5 pb-10 pt-8">
      {/* Marque */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <span className="relative grid h-8 w-8 rotate-45 place-items-center rounded-lg bg-betclic-red shadow-[0_6px_24px_-4px_rgba(225,0,20,0.55)]">
            <Zap className="h-4 w-4 -rotate-45 fill-white text-white" strokeWidth={2.4} />
          </span>
          <div>
            <p className="font-display text-[17px] font-bold leading-none tracking-tight text-ink">
              PULSE
            </p>
            <p className="mt-0.5 font-display text-[8px] font-bold tracking-[0.3em] text-mist">
              PARIS SPORTIFS
            </p>
          </div>
        </div>
        <span className="glass-pill rounded-full px-2.5 py-1 font-display text-[9px] font-bold tracking-[0.2em] text-betclic-red">
          JWT · SECURISÉ
        </span>
      </motion.div>

      {/* Titre */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
        className="mt-8"
      >
        <p className="text-[10px] font-semibold tracking-[0.26em] text-betclic-red">
          {mode === "login" ? "BIENVENUE" : "REJOINDRE LA PLATEFORME"}
        </p>
        <h1 className="mt-1.5 font-display text-[30px] font-bold leading-[1.05] tracking-tight">
          {mode === "login" ? (
            <>
              Content de
              <br />
              te revoir
            </>
          ) : (
            <>
              Crée ton
              <br />
              compte PULSE
            </>
          )}
        </h1>
        <p className="mt-2 text-[12.5px] leading-relaxed text-mist">
          {mode === "login"
            ? "Connecte-toi pour retrouver tes paris, ton solde et tes matchs en direct."
            : "Reçois 250,00 € de bonus et mets en jeu tes premières prédictions."}
        </p>
      </motion.div>

      {/* Onglets */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        className="glass-card mt-7 grid grid-cols-2 gap-1 rounded-xl p-1"
      >
        {(["login", "register"] as Mode[]).map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={cn(
                "relative rounded-lg py-2.5 font-display text-[12.5px] font-semibold transition-colors",
                active ? "text-white" : "text-mist"
              )}
            >
              {active && (
                <motion.span
                  layoutId="auth-pill"
                  transition={spring}
                  className="absolute inset-0 rounded-lg bg-betclic-red shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
                />
              )}
              <span className="relative z-10">
                {m === "login" ? "Connexion" : "Inscription"}
              </span>
            </button>
          );
        })}
      </motion.div>

      {/* Formulaire */}
      <motion.form
        key={mode}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        onSubmit={submit}
        className="mt-6 flex flex-col gap-3"
        noValidate
      >
        {mode === "register" && (
          <FieldWrap>
            <FieldIcon>
              <User className="h-[18px] w-[18px] text-betclic-red" strokeWidth={2.2} />
            </FieldIcon>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Nom d'utilisateur"
              className="h-[52px] flex-1 bg-transparent pl-1 text-[14px] text-ink outline-none placeholder:text-dim"
            />
          </FieldWrap>
        )}

        <FieldWrap>
          <FieldIcon>
            <Mail className="h-[18px] w-[18px] text-betclic-red" strokeWidth={2.2} />
          </FieldIcon>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
              placeholder="Adresse e-mail"
              className="h-[52px] flex-1 bg-transparent pl-1 text-[14px] text-ink outline-none placeholder:text-dim"
          />
        </FieldWrap>

        <FieldWrap>
          <FieldIcon>
            <ShieldCheck className="h-[18px] w-[18px] text-betclic-red" strokeWidth={2.2} />
          </FieldIcon>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type={showPw ? "text" : "password"}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="Mot de passe"
              className="h-[52px] flex-1 bg-transparent pl-1 text-[14px] text-ink outline-none placeholder:text-dim"
          />
          <button
            type="button"
            onClick={() => setShowPw((s) => !s)}
            aria-label={showPw ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            className="grid h-9 w-9 place-items-center text-dim transition-colors hover:text-mist"
          >
            {showPw ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
          </button>
        </FieldWrap>

        <AnimatePresence mode="wait">
          {error && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden px-1 text-[12px] font-medium text-betclic-red"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <motion.button
          type="submit"
          whileTap={{ scale: 0.97 }}
          disabled={loading}
          className={cn(
            "mt-1 flex h-[52px] items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#E10014,#FB6962)] font-display text-[14px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_14px_30px_-12px_rgba(225,0,20,0.5)] transition-opacity disabled:opacity-60"
          )}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
              Veuillez patienter…
            </>
          ) : (
            <>
              {mode === "register" ? "Créer mon compte" : "Se connecter"}
              <ArrowRight className="h-4 w-4" strokeWidth={2.6} />
            </>
          )}
        </motion.button>
      </motion.form>

      {/* Compte démo */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.22 }}
        onClick={() => {
          setMode("login");
          setEmail("demo@pulse.app");
          setPassword("demo1234");
          setError(null);
        }}
        className="mt-5 flex items-center justify-center gap-1.5 text-[12px] font-medium text-dim transition-colors hover:text-mist"
      >
        <Zap className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.4} />
        Essayer avec le compte démo : <span className="font-semibold text-mist">demo@pulse.app / demo1234</span>
      </motion.button>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.28 }}
        className="mt-auto pt-10 text-center text-[10px] leading-relaxed text-dim"
      >
        Interdit aux mineurs. Jouer comporte des risques : endettement, isolement, dépendance.
      </motion.p>
    </main>
  );
}

function FieldWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass-card flex items-center gap-3 rounded-xl py-0 pl-3 pr-2 focus-within:border-betclic-red/40">
      {children}
    </div>
  );
}

function FieldIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-elev">
      {children}
    </span>
  );
}