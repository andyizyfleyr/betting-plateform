"use client";

import Image from "next/image";
import Link from "next/link";
import { Play } from "lucide-react";

const MINI_GAMES = [
  {
    href: "/tap",
    badge: "Classique",
    tag: "Jusqu'à ×50",
    title: "Tap Win",
    subtitle: "Enchaînez les pressions pour faire grimper le multiplicateur et encaissez avant le crash.",
    image: "/images/games/tap-win.jpg",
    imageAlt: "Miniature du jeu casino Tap Win",
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
  },
] as const;

export default function JeuxPage() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-2 pb-6 pt-2.5 lg:px-0 lg:py-0">
      <h1 className="font-display text-[14.5px] font-bold leading-tight tracking-tight text-ink lg:text-[16px]">
        Mini-jeux
      </h1>

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:mt-4 lg:gap-5">
        {MINI_GAMES.map(({ href, badge, tag, title, subtitle, image, imageAlt }, idx) => (
          <Link
            key={href}
            href={href}
            className="glass-card group overflow-hidden rounded-2xl border border-edge transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]"
          >
            <div className="relative aspect-[16/9] w-full overflow-hidden bg-slate-950">
              <Image
                src={image}
                alt={imageAlt}
                width={1280}
                height={720}
                priority={idx === 0}
                sizes="(max-width: 768px) 100vw, 640px"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />

              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/15" />

              <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
                <span className="rounded-full border border-white/20 bg-black/55 px-2.5 py-0.5 font-display text-[9.5px] font-medium uppercase tracking-wider text-white backdrop-blur-md">
                  {badge}
                </span>
                <span className="rounded-full bg-amber-400/95 px-2.5 py-0.5 font-display text-[9.5px] font-medium text-slate-950 shadow-xs">
                  {tag}
                </span>
              </div>

              <div className="absolute inset-x-3.5 bottom-3 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-[14.5px] font-bold leading-tight tracking-tight text-white drop-shadow-sm">
                    {title}
                  </h2>
                  <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-white/85">
                    {subtitle}
                  </p>
                </div>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-betclic-red text-white shadow-md transition-transform group-active:scale-95">
                  <Play className="ml-0.5 h-4 w-4 fill-current" strokeWidth={2.2} />
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
