"use client";

import Link from "next/link";
import { ArrowRight, Flame, Gauge, Zap } from "lucide-react";

const MINI_GAMES = [
  {
    href: "/tap",
    badge: "Classique",
    title: "Tap Win",
    subtitle: "Choisissez votre multiplicateur cible et tentez de battre le crash instantané.",
    accent: "from-betclic-red to-rose-700",
    Icon: Zap,
    stats: "Manches instantanées · Multiplicateurs jusqu'à ×50",
  },
  {
    href: "/accelerator",
    badge: "Temps réel",
    title: "Accelerator Pro",
    subtitle:
      "Maintenez l'accélérateur pour faire grimper le multiplicateur et encaissez avant la surchauffe.",
    accent: "from-slate-900 to-slate-700",
    Icon: Gauge,
    stats: "Contrôle direct · Cash-out manuel ou auto",
  },
] as const;

export default function JeuxPage() {
  return (
    <div className="px-4 pb-8 pt-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
            Mini-jeux
          </h1>
          <p className="text-[12px] text-mist">
            Sessions rapides branchées directement sur votre solde
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-betclic-red/10 px-2.5 py-1 font-display text-[10.5px] font-bold text-betclic-red">
          <Flame className="h-3.5 w-3.5" strokeWidth={2.3} />2 jeux
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {MINI_GAMES.map(({ href, badge, title, subtitle, accent, Icon, stats }) => (
          <Link
            key={href}
            href={href}
            className="glass-card group overflow-hidden rounded-2xl transition-transform active:scale-[0.99]"
          >
            <div className={`bg-gradient-to-br ${accent} p-4 text-white`}>
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-white/18 px-2.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider">
                  {badge}
                </span>
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/15">
                  <Icon className="h-5 w-5" strokeWidth={2.2} />
                </span>
              </div>
              <h2 className="mt-3 font-display text-[20px] font-bold tracking-tight">{title}</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-white/85">{subtitle}</p>
            </div>

            <div className="flex items-center justify-between bg-white px-4 py-3">
              <span className="text-[11.5px] font-medium text-mist">{stats}</span>
              <span className="inline-flex items-center gap-1 font-display text-[12.5px] font-bold text-betclic-red">
                Jouer
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-active:translate-x-0.5" strokeWidth={2.5} />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
