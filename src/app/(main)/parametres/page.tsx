"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  BadgeCheck,
  Bell,
  ChevronRight,
  Fingerprint,
  Globe,
  HandCoins,
  HelpCircle,
  History,
  Languages,
  LogOut,
  Plus,
  Radio,
  ScrollText,
  ShieldCheck,
  Target,
  Ticket,
  Vibrate,
  Volume2,
  Zap,
} from "lucide-react";
import { api, type ClientBet, type ClientUser } from "@/lib/api";
import { useApp } from "@/components/providers";
import { AnimatedNumber } from "@/components/animated-number";
import { Toggle } from "@/components/toggle";
import { cn, eur, initials, teamHue } from "@/lib/format";

const listAnim = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
};

export default function ParametresPage() {
  const { user, applyUser, toast } = useApp();
  const router = useRouter();
  const [depositing, setDepositing] = useState(false);
  const [bets, setBets] = useState<ClientBet[] | null>(null);

  useEffect(() => {
    api
      .allBets()
      .then((r) => setBets(r.bets))
      .catch(() => setBets([]));
  }, []);

  const stats = useMemo(() => {
    const all = bets ?? [];
    const won = all.filter((b) => b.status === "won");
    const settledBets = all.filter((b) => b.status === "won" || b.status === "lost");
    const gains = won.reduce((s, b) => s + b.potentialWin, 0) + all
      .filter((b) => b.status === "cashed")
      .reduce((s, b) => s + (b.cashOutAmount ?? 0), 0);
    const rate = settledBets.length ? Math.round((won.length / settledBets.length) * 100) : 0;
    return { total: all.length, wins: won.length, gains, rate };
  }, [bets]);

  const patch = async (p: Partial<ClientUser>, label: string) => {
    try {
      const r = await api.patchSettings(p);
      applyUser(r.user);
      toast({ kind: "success", title: label });
    } catch {
      toast({ kind: "error", title: "Impossible d'enregistrer" });
    }
  };

  const deposit = async () => {
    if (depositing) return;
    setDepositing(true);
    try {
      const r = await api.patchSettings({ action: "deposit", amount: 100 });
      applyUser(r.user);
      toast({
        kind: "success",
        title: "Compte rechargé",
        description: "+100,00 € ajoutés à votre solde",
      });
    } catch {
      toast({ kind: "error", title: "Rechargement échoué" });
    } finally {
      setDepositing(false);
    }
  };

  const soon = (label: string) => () =>
    toast({ kind: "info", title: label, description: "Bientôt disponible dans PULSE" });

  const logout = async () => {
    try {
      await api.auth.logout();
    } catch {
      // même en cas d'échec réseau, on revient à l'écran de connexion
    }
    router.push("/auth");
    router.refresh();
  };

  const hue = teamHue(user?.name ?? "Pulse");

  return (
    <div className="px-3 pb-24 pt-5">
      <p className="text-[10px] font-semibold tracking-[0.24em] text-betclic-red">VOTRE COMPTE</p>
      <h1 className="mt-1 font-display text-[30px] font-bold leading-none tracking-tight">
        Réglages
      </h1>

      {/* Profil à bandeau */}
      <motion.section
        {...listAnim}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="glass-card relative mt-4 overflow-hidden rounded-[22px]"
      >
        <div className="relative h-[76px] bg-[linear-gradient(120deg,rgba(225,0,20,0.2),rgba(125,211,252,0.12)_55%,transparent)]">
          <div aria-hidden className="bg-texture absolute inset-0" />
          <p className="absolute right-4 top-3 font-display text-[9px] font-bold tracking-[0.3em] text-ink/40">
            MEMBRE GOLD
          </p>
        </div>
        <div className="relative -mt-8 px-4 pb-4">
          <span
            className="inline-block rounded-[26px] p-[3px]"
            style={{
              background:
                "conic-gradient(from 210deg, var(--color-betclic-red) 0 72%, var(--color-elev) 72% 100%)",
            }}
          >
            <span
              className="grid h-16 w-16 place-items-center rounded-[22px] font-display text-xl font-bold text-white"
              style={{
                background: `linear-gradient(140deg, hsl(${hue} 62% 46%), hsl(${(hue + 40) % 360} 70% 30%))`,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)",
              }}
            >
              {initials(user?.name ?? "PM")}
            </span>
          </span>
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-display text-[18px] font-bold">{user?.name ?? "—"}</p>
              <p className="mt-1 flex items-center gap-1 text-[11px] text-mist">
                <BadgeCheck className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.4} />
                Compte vérifié · Niveau 7
              </p>
            </div>
            <span className="shrink-0 rounded-lg bg-betclic-red/10 px-2.5 py-1.5 text-center">
              <span className="glow-betclic block font-display text-base font-bold leading-none text-betclic-red">
                72%
              </span>
              <span className="mt-1 block text-[8px] font-semibold tracking-[0.14em] text-mist">
                NIV. 8
              </span>
            </span>
          </div>
        </div>
      </motion.section>

      {/* Statistiques réelles */}
      <motion.section
        {...listAnim}
        transition={{ duration: 0.5, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
        className="glass-card mt-2.5 grid grid-cols-3 divide-x divide-edge rounded-[22px] py-3"
      >
        <StatCell label="PARIS" value={String(stats.total)} Icon={Ticket} />
        <StatCell label="GAGNÉS" value={String(stats.wins)} Icon={BadgeCheck} accent />
        <StatCell label="RÉUSSITE" value={stats.total ? `${stats.rate}%` : "—"} Icon={Target} />
      </motion.section>

      {/* Solde */}
      <motion.section
        {...listAnim}
        transition={{ duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        className="relative mt-3 overflow-hidden rounded-[22px] border border-betclic-red/25 bg-gradient-to-br from-betclic-red/[0.12] via-card to-card p-4"
      >
        <div
          aria-hidden
          className="breathe pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full"
          style={{ background: "radial-gradient(closest-side, rgba(225,0,20,0.16), transparent)" }}
        />
        <p className="relative text-[10px] font-semibold tracking-[0.24em] text-mist">
          SOLDE DISPONIBLE
        </p>
        <AnimatedNumber
          value={user?.balance ?? 0}
          format={eur}
          className="relative mt-1 block font-display text-[36px] font-bold tabular-nums tracking-tight text-ink"
        />
        <p className="relative text-[11px] font-medium text-win">
          +{eur(stats.gains)} encaissés depuis le début
        </p>
        <div className="relative mt-4 flex gap-2">
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={deposit}
            disabled={depositing}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[linear-gradient(135deg,#E10014,#FB6962)] py-3 font-display text-[13px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] transition-opacity disabled:opacity-60"
          >
            <Plus className="h-4 w-4" strokeWidth={2.6} />
            {depositing ? "Rechargement…" : "Recharger 100 €"}
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={soon("Retraits")}
            className="glass-card flex flex-1 items-center justify-center rounded-xl py-3 font-display text-[13px] font-semibold text-ink"
          >
            Retirer
          </motion.button>
        </div>
      </motion.section>

      {/* Préférences */}
      <GhostTitle num="01" label="Préférences" delay={0.12} />
      <Group delay={0.14}>
        <SwitchRow
          Icon={<Bell className="h-4 w-4" strokeWidth={2.2} />}
          label="Notifications"
          hint="Scores live et résultats de vos paris"
          checked={user?.notifications ?? true}
          onChange={(v) => patch({ notifications: v }, v ? "Notifications activées" : "Notifications coupées")}
        />
        <SwitchRow
          Icon={<Volume2 className="h-4 w-4" strokeWidth={2.2} />}
          label="Sons"
          hint="Effets sonores de l'application"
          checked={user?.sound ?? false}
          onChange={(v) => patch({ sound: v }, v ? "Sons activés" : "Sons coupés")}
        />
        <SwitchRow
          Icon={<Vibrate className="h-4 w-4" strokeWidth={2.2} />}
          label="Vibrations"
          hint="Retour haptique aux actions"
          checked={user?.haptics ?? true}
          onChange={(v) => patch({ haptics: v }, v ? "Vibrations activées" : "Vibrations coupées")}
        />
        <SwitchRow
          Icon={<Radio className="h-4 w-4" strokeWidth={2.2} />}
          label="Simulation live"
          hint="Matchs en direct qui évoluent en temps réel"
          checked={user?.liveSim ?? true}
          onChange={(v) => patch({ liveSim: v }, v ? "Simulation activée" : "Simulation en pause")}
          last
        />
        <div className="border-t border-edge px-4 py-3.5">
          <div className="flex items-center gap-3">
            <IconBubble>
              <HandCoins className="h-4 w-4" strokeWidth={2.2} />
            </IconBubble>
            <div>
              <p className="font-display text-[13.5px] font-semibold">Format des cotes</p>
              <p className="text-[11px] text-dim">Affichage sur toutes les fiches</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl border border-edge bg-elev p-1">
            {(
              [
                { v: "decimal", label: "Décimal · 1,95" },
                { v: "fractional", label: "Fraction · 19/20" },
              ] as const
            ).map(({ v, label }) => {
              const active = (user?.oddsFormat ?? "decimal") === v;
              return (
                <button
                  key={v}
                  onClick={() => patch({ oddsFormat: v }, "Format des cotes mis à jour")}
                  className={cn(
                    "relative rounded-lg py-2 font-display text-[11.5px] transition-colors",
                    active ? "font-bold text-ink" : "font-medium text-mist"
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="odds-pill"
                      transition={{ type: "spring", stiffness: 480, damping: 38 }}
                      className="absolute inset-0 rounded-lg bg-betclic-red"
                    />
                  )}
                  <span className="relative z-10">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <ChevronRow
          Icon={<Languages className="h-4 w-4" strokeWidth={2.2} />}
          label="Langue"
          value="Français"
          onClick={soon("Version anglaise")}
          last
        />
      </Group>

      {/* Compte */}
      <GhostTitle num="02" label="Compte & sécurité" delay={0.18} />
      <Group delay={0.2}>
        <ChevronRow
          Icon={<ShieldCheck className="h-4 w-4" strokeWidth={2.2} />}
          label="Jeu responsable"
          hint="Limites de dépôt et de mise"
          onClick={soon("Limites de jeu")}
        />
        <ChevronRow
          Icon={<Fingerprint className="h-4 w-4" strokeWidth={2.2} />}
          label="Sécurité"
          hint="Biométrie et code PIN"
          onClick={soon("Sécurité renforcée")}
        />
        <ChevronRow
          Icon={<History className="h-4 w-4" strokeWidth={2.2} />}
          label="Historique des transactions"
          onClick={soon("Historique")}
        />
        <motion.button
          whileTap={{ scale: 0.985 }}
          onClick={logout}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-red-500/10"
        >
          <span className="glass-pill grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-500/15 text-red-400">
            <LogOut className="h-4 w-4" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[13.5px] font-semibold text-red-400">
              Se déconnecter
            </p>
            <p className="truncate text-[11px] text-dim">Quitter votre session PULSE</p>
          </div>
        </motion.button>
      </Group>

      {/* Support */}
      <GhostTitle num="03" label="Support" delay={0.24} />
      <Group delay={0.26}>
        <ChevronRow
          Icon={<HelpCircle className="h-4 w-4" strokeWidth={2.2} />}
          label="Centre d'aide"
          onClick={soon("Centre d'aide")}
        />
        <ChevronRow
          Icon={<ScrollText className="h-4 w-4" strokeWidth={2.2} />}
          label="Conditions d'utilisation"
          onClick={soon("Conditions")}
        />
        <ChevronRow
          Icon={<Globe className="h-4 w-4" strokeWidth={2.2} />}
          label="Joueurs-info-service.fr"
          hint="09 74 75 13 13 · appel gratuit"
          onClick={() =>
            toast({ kind: "info", title: "Joueurs Info Service", description: "09 74 75 13 13 — 7j/7" })
          }
          last
        />
      </Group>

      {/* Pied */}
      <motion.footer
        {...listAnim}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="mt-10 flex flex-col items-center gap-3 text-center"
      >
        <span className="grid h-9 w-9 rotate-45 place-items-center rounded-lg bg-betclic-red/15">
          <Zap className="h-4 w-4 -rotate-45 text-betclic-red" strokeWidth={2.2} />
        </span>
        <div>
          <p className="font-display text-[12px] font-bold tracking-[0.2em] text-mist">
            PULSE BETS · v5.0.0
          </p>
          <p className="mt-1.5 max-w-[280px] text-[10.5px] leading-relaxed text-dim">
            Interdit aux mineurs. Jouer comporte des risques : endettement, isolement, dépendance.
          </p>
        </div>
      </motion.footer>
    </div>
  );
}

function StatCell({
  label,
  value,
  accent,
  Icon,
}: {
  label: string;
  value: string;
  accent?: boolean;
  Icon: typeof Ticket;
}) {
  return (
    <div className="flex flex-col items-center px-2">
      <Icon className={cn("mb-1 h-3.5 w-3.5", accent ? "text-betclic-red" : "text-dim")} strokeWidth={2.2} />
      <p
        className={cn(
          "font-display text-[16px] font-bold tabular-nums",
          accent ? "text-betclic-red" : "text-ink"
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[8.5px] font-semibold tracking-[0.2em] text-dim">{label}</p>
    </div>
  );
}

function GhostTitle({ num, label, delay }: { num: string; label: string; delay: number }) {
  return (
    <motion.div
      {...listAnim}
      transition={{ duration: 0.45, delay }}
      className="mb-2.5 mt-6 flex items-end gap-3 px-1"
    >
      <span aria-hidden className="ghost-num font-display text-[26px] font-bold leading-[0.85]">
        {num}
      </span>
      <h2 className="pb-0.5 font-display text-[12px] font-bold uppercase tracking-[0.22em] text-mist">
        {label}
      </h2>
      <span className="mb-1 h-px flex-1 bg-elev" />
    </motion.div>
  );
}

function Group({ children, delay }: { children: ReactNode; delay: number }) {
  return (
    <motion.div
      {...listAnim}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className="glass-card overflow-hidden rounded-[20px]"
    >
      {children}
    </motion.div>
  );
}

function IconBubble({ children }: { children: ReactNode }) {
  return (
    <span className="glass-pill grid h-9 w-9 shrink-0 place-items-center rounded-full text-betclic-red">
      {children}
    </span>
  );
}

function SwitchRow({
  Icon,
  label,
  hint,
  checked,
  onChange,
  last,
}: {
  Icon: ReactNode;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3 px-4 py-3.5", !last && "border-b border-edge")}>
      <IconBubble>{Icon}</IconBubble>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[13.5px] font-semibold">{label}</p>
        {hint && <p className="truncate text-[11px] text-dim">{hint}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function ChevronRow({
  Icon,
  label,
  hint,
  value,
  onClick,
  last,
}: {
  Icon: ReactNode;
  label: string;
  hint?: string;
  value?: string;
  onClick: () => void;
  last?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-elev/50",
        !last && "border-b border-edge"
      )}
    >
      <IconBubble>{Icon}</IconBubble>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[13.5px] font-semibold">{label}</p>
        {hint && <p className="truncate text-[11px] text-dim">{hint}</p>}
      </div>
      {value && <span className="shrink-0 text-[12px] font-medium text-mist">{value}</span>}
      <ChevronRight className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.2} />
    </motion.button>
  );
}
