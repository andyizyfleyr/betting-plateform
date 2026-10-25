"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Flame, Play } from "lucide-react";

const MINI_GAMES = [
  {
    href: "/tap",
    badge: "Classique",
    tag: "Jusqu'à ×50",
    title: "Tap Win",
    subtitle: "Enchaînez les pressions pour faire grimper le multiplicateur et encaissez avant le crash.",
    image: "/images/games/tap-win.jpg",
    imageAlt: "Miniature du jeu casino Tap Win",
    stats: "Manches instantanées · Cash-out libre",
  },
  {
    href: "/accelerator",
    badge: "Temps réel",
    tag: "Turbo Live",
    title: "Accelerator Pro",
    subtitle:
      "Maintenez l'accélérateur pour pousser l'aiguille dans le rouge et relâchez au bon moment.",
    image: "/images/games/accelerator-pro.jpg",
    imageAlt: "Miniature du jeu casino Accelerator Pro",
    stats: "Contrôle direct · Cash-out manuel ou auto",
  },
] as const;

export default function JeuxPage() {
  return (
    <div className="px-4 pb-8 pt-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
            Casino & Mini-jeux
          </h1>
          <p className="text-[12px] text-mist">
            Sessions instantanées branchées sur votre portefeuille
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-betclic-red/10 px-2.5 py-1 font-display text-[10.5px] font-bold text-betclic-red">
          <Flame className="h-3.5 w-3.5" strokeWidth={2.3} />2 jeux
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-3.5">
        {MINI_GAMES.map(({ href, badge, tag, title, subtitle, image, imageAlt, stats }, idx) => (
          <Link
            key={href}
            href={href}
            className="glass-card group overflow-hidden rounded-2xl border border-edge transition-transform active:scale-[0.99]"
          >
            {/* Vraie miniature 16:9 haute définition */}
            <div className="relative aspect-[16/9] w-full overflow-hidden bg-slate-950">
              <Image
                src={image}
                alt={imageAlt}
                width={1280}
                height={720}
                priority={idx === 0}
                sizes="(max-width: 640px) 100vw, 520px"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />

              {/* Voile dégradé bas discret pour laisser briller l'illustration centrale */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/15" />

              {/* Badges supérieurs */}
              <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
                <span className="rounded-full border border-white/20 bg-black/55 px-2.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur-md">
                  {badge}
                </span>
                <span className="rounded-full bg-amber-400/95 px-2.5 py-0.5 font-display text-[10px] font-extrabold text-slate-950 shadow-xs">
                  {tag}
                </span>
              </div>

              {/* Titre du jeu ancré au bas du visuel */}
              <div className="absolute inset-x-3.5 bottom-3 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-[21px] font-extrabold leading-tight tracking-tight text-white drop-shadow-sm">
                    {title}
                  </h2>
                  <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-white/85">
                    {subtitle}
                  </p>
                </div>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-betclic-red text-white shadow-md transition-transform group-active:scale-95">
                  <Play className="ml-0.5 h-4 w-4 fill-current" strokeWidth={2.2} />
                </span>
              </div>
            </div>

            {/* Barre d'infos & CTA */}
            <div className="flex items-center justify-between gap-2 bg-white px-4 py-2.5">
              <span className="truncate text-[11.5px] font-medium text-mist">{stats}</span>
              <span className="inline-flex shrink-0 items-center gap-1 font-display text-[12px] font-bold text-betclic-red">
                Jouer
                <ArrowRight
                  className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                  strokeWidth={2.5}
                />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
