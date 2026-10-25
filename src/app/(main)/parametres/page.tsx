"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  ChevronRight,
  HandCoins,
  Loader2,
  LogOut,
  PhoneCall,
  Plus,
  Radio,
  ShieldCheck,
  Vibrate,
  Volume2,
} from "lucide-react";
import { api, type ClientBet, type ClientUser } from "@/lib/api";
import { useApp } from "@/components/providers";
import { AnimatedNumber } from "@/components/animated-number";
import { Toggle } from "@/components/toggle";
import { cn, eur, initials, teamHue } from "@/lib/format";

export default function ParametresPage() {
  const { user, applyUser, toast, openRecharge, betsVersion } = useApp();
  const router = useRouter();
  const [bets, setBets] = useState<ClientBet[] | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .allBets()
      .then((r) => {
        if (active) setBets(r.bets);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [betsVersion]);

  // Retour de paiement (Stripe/PayPal) via les params d'URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flow = params.get("deposit");

    if (flow === "cancelled") {
      toast({ kind: "info", title: "Paiement annulé" });
      window.history.replaceState({}, "", "/parametres");
      return;
    }

    if (flow === "stripe") {
      const ref = params.get("ref");
      toast({ kind: "info", title: "Confirmation du paiement…" });
      let tries = 0;
      const tick = async () => {
        if (!ref) return;
        try {
          const s = await api.payments.status(ref);
          if (s.credited) {
            const r = await api.settings();
            applyUser(r.user);
            toast({ kind: "success", title: "Solde rechargé" });
            window.history.replaceState({}, "", "/parametres");
            return;
          }
        } catch {
          /* nouvelle tentative */
        }
        tries += 1;
        if (tries < 8) window.setTimeout(tick, 1500);
        else
          toast({
            kind: "info",
            title: "Vérification en cours",
            description: "Actualisez dans quelques secondes",
          });
      };
      void tick();
      return;
    }

    if (flow === "paypal") {
      const orderId = params.get("token");
      if (orderId) {
        (async () => {
          toast({ kind: "info", title: "Validation du paiement…" });
          try {
            const r = await api.payments.capturePayPal(orderId);
            if (r.user) applyUser(r.user);
            toast({ kind: "success", title: "Solde rechargé" });
          } catch {
            toast({ kind: "error", title: "Paiement non confirmé" });
          }
          window.history.replaceState({}, "", "/parametres");
        })();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const all = bets ?? [];
    const won = all.filter((b) => b.status === "won");
    const settledBets = all.filter((b) => b.status === "won" || b.status === "lost");
    const gains =
      won.reduce((s, b) => s + b.potentialWin, 0) +
      all
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

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api.auth.logout();
    } catch {
      /* déconnexion locale même en cas d'erreur réseau */
    }
    applyUser(null);
    router.push("/auth");
    router.refresh();
    setLoggingOut(false);
  };

  const hue = teamHue(user?.name ?? "Pulse");

  return (
    <div className="px-4 pb-8 pt-4">
      <h1 className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
        Compte
      </h1>
      <p className="text-[12px] text-mist">Profil, solde et préférences</p>

      {/* Profil + Solde réunis proprement */}
      <section className="glass-card mt-3 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl font-display text-[15px] font-bold text-white"
            style={{
              background: `linear-gradient(140deg, hsl(${hue} 60% 44%), hsl(${(hue + 36) % 360} 68% 30%))`,
            }}
          >
            {initials(user?.name ?? "PU")}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-display text-[16px] font-bold text-ink">
                {user?.name ?? "—"}
              </p>
              {user?.role === "admin" && (
                <span className="rounded-md bg-betclic-red/10 px-1.5 py-0.5 font-display text-[10px] font-bold uppercase text-betclic-red">
                  Admin
                </span>
              )}
            </div>
            <p className="truncate text-[12px] text-dim">{user?.email ?? "Session active"}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-xl bg-elev p-3">
          <div>
            <p className="text-[11px] font-medium text-dim">Solde disponible</p>
            <AnimatedNumber
              value={user?.balance ?? 0}
              format={eur}
              className="mt-0.5 block font-display text-[22px] font-bold leading-none tabular-nums text-ink"
            />
            {stats.gains > 0 && (
              <p className="mt-1 text-[11px] font-medium text-win">
                +{eur(stats.gains)} encaissés au total
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={openRecharge}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-betclic-red px-3.5 font-display text-[12.5px] font-bold text-white active:opacity-90"
          >
            <Plus className="h-4 w-4" strokeWidth={2.6} />
            Recharger
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 divide-x divide-edge border-t border-edge pt-3 text-center">
          <div>
            <p className="font-display text-[15px] font-bold tabular-nums text-ink">{stats.total}</p>
            <p className="text-[10px] font-medium text-dim">Paris</p>
          </div>
          <div>
            <p className="font-display text-[15px] font-bold tabular-nums text-win">{stats.wins}</p>
            <p className="text-[10px] font-medium text-dim">Gagnés</p>
          </div>
          <div>
            <p className="font-display text-[15px] font-bold tabular-nums text-ink">
              {stats.total ? `${stats.rate}%` : "—"}
            </p>
            <p className="text-[10px] font-medium text-dim">Réussite</p>
          </div>
        </div>
      </section>

      {/* Accès Admin (si administrateur) */}
      {user?.role === "admin" && (
        <button
          type="button"
          onClick={() => router.push("/admin")}
          className="glass-card mt-3 flex w-full items-center gap-3 rounded-2xl p-3.5 text-left transition-colors active:bg-elev"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-betclic-red/10 text-betclic-red">
            <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[13.5px] font-bold text-ink">Espace administrateur</p>
            <p className="text-[11.5px] text-dim">Matchs, pronostics, soldes et statistiques</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.2} />
        </button>
      )}

      {/* Préférences réelles */}
      <h2 className="mt-5 px-0.5 font-display text-[12px] font-bold uppercase tracking-wider text-mist">
        Préférences
      </h2>
      <div className="glass-card mt-2 overflow-hidden rounded-2xl">
        <div className="border-b border-edge p-3.5">
          <div className="flex items-center gap-3">
            <IconBox>
              <HandCoins className="h-4 w-4" strokeWidth={2.1} />
            </IconBox>
            <div>
              <p className="font-display text-[13.5px] font-semibold text-ink">Format des cotes</p>
              <p className="text-[11px] text-dim">Affichage sur les matchs et prédictions</p>
            </div>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-1 rounded-xl border border-edge bg-elev p-1">
            {(
              [
                { v: "decimal", label: "Décimal (1,95)" },
                { v: "fractional", label: "Fraction (19/20)" },
              ] as const
            ).map(({ v, label }) => {
              const active = (user?.oddsFormat ?? "decimal") === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => patch({ oddsFormat: v }, "Format des cotes mis à jour")}
                  className={cn(
                    "h-8 rounded-lg font-display text-[12px] transition-colors",
                    active ? "bg-ink font-bold text-white" : "font-medium text-mist"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <SwitchRow
          Icon={<Radio className="h-4 w-4" strokeWidth={2.1} />}
          label="Simulation en direct"
          hint="Avancement automatique des matchs"
          checked={user?.liveSim ?? true}
          onChange={(v) =>
            patch({ liveSim: v }, v ? "Simulation activée" : "Simulation en pause")
          }
        />
        <SwitchRow
          Icon={<Bell className="h-4 w-4" strokeWidth={2.1} />}
          label="Alertes de résultats"
          hint="Notifications lors du règlement des paris"
          checked={user?.notifications ?? true}
          onChange={(v) =>
            patch({ notifications: v }, v ? "Alertes activées" : "Alertes désactivées")
          }
        />
        <SwitchRow
          Icon={<Volume2 className="h-4 w-4" strokeWidth={2.1} />}
          label="Effets sonores"
          checked={user?.sound ?? false}
          onChange={(v) => patch({ sound: v }, v ? "Sons activés" : "Sons coupés")}
        />
        <SwitchRow
          Icon={<Vibrate className="h-4 w-4" strokeWidth={2.1} />}
          label="Retour haptique"
          checked={user?.haptics ?? true}
          onChange={(v) => patch({ haptics: v }, v ? "Vibrations activées" : "Vibrations coupées")}
          last
        />
      </div>

      {/* Jeu responsable & Déconnexion */}
      <h2 className="mt-5 px-0.5 font-display text-[12px] font-bold uppercase tracking-wider text-mist">
        Assistance & session
      </h2>
      <div className="glass-card mt-2 overflow-hidden rounded-2xl">
        <a
          href="tel:0974751313"
          className="flex items-center gap-3 border-b border-edge p-3.5 transition-colors active:bg-elev"
        >
          <IconBox>
            <PhoneCall className="h-4 w-4" strokeWidth={2.1} />
          </IconBox>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[13.5px] font-semibold text-ink">
              Joueurs Info Service
            </p>
            <p className="text-[11.5px] text-dim">09 74 75 13 13 · Appel non surtaxé (7j/7)</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-dim" strokeWidth={2.2} />
        </a>

        <button
          type="button"
          onClick={logout}
          disabled={loggingOut}
          className="flex w-full items-center gap-3 p-3.5 text-left transition-colors active:bg-betclic-red/5 disabled:opacity-60"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-betclic-red/10 text-betclic-red">
            {loggingOut ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
            ) : (
              <LogOut className="h-4 w-4" strokeWidth={2.1} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[13.5px] font-semibold text-betclic-red">
              Se déconnecter
            </p>
            <p className="text-[11.5px] text-dim">Fermer votre session sur cet appareil</p>
          </div>
        </button>
      </div>

      <p className="mt-6 text-center text-[10.5px] leading-relaxed text-dim">
        18+ · Jouer comporte des risques : endettement, isolement, dépendance.
      </p>
    </div>
  );
}

function IconBox({ children }: { children: ReactNode }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-elev text-ink">
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
    <div className={cn("flex items-center gap-3 p-3.5", !last && "border-b border-edge")}>
      <IconBox>{Icon}</IconBox>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[13.5px] font-semibold text-ink">{label}</p>
        {hint && <p className="truncate text-[11.5px] text-dim">{hint}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}
