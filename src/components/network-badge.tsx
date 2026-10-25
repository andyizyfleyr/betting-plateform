"use client";

import { WifiOff } from "lucide-react";
import { useNetwork, type NetQuality } from "@/lib/network-manager";

const LABELS: Record<NetQuality, string> = {
  good: "En ligne",
  fair: "Moyen",
  poor: "Lent",
  offline: "Hors-ligne",
};

const COLORS: Record<NetQuality, string> = {
  good: "#22c55e",
  fair: "#facc15",
  poor: "#fb923c",
  offline: "#ef4444",
};

export function NetworkBadge() {
  const net = useNetwork();
  const color = COLORS[net.quality];
  const detail =
    net.quality !== "good" && net.quality !== "offline" && net.avgRttMs != null
      ? ` · ${Math.round(net.avgRttMs)}ms`
      : "";

  return (
    <span
      title="Qualité de la connexion"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-200 whitespace-nowrap"
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      <span>
        {LABELS[net.quality]}
        {detail}
      </span>
    </span>
  );
}

export function OfflineBanner() {
  const net = useNetwork();
  if (net.quality !== "offline") return null;
  return (
    <div
      style={{
        position: "fixed",
        top: "calc(60px + env(safe-area-inset-top))",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 3000,
      }}
      className="flex w-[92%] max-w-[400px] items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-950/90 px-3.5 py-2 text-center text-[12px] font-semibold text-red-200 shadow-lg backdrop-blur-md"
    >
      <WifiOff className="h-4 w-4 shrink-0" strokeWidth={2.3} />
      <span>Connexion perdue — reconnexion automatique en cours…</span>
    </div>
  );
}
