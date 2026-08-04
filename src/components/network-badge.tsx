"use client";

import { WifiOff } from "lucide-react";
import { useNetwork, type NetQuality } from "@/lib/network-manager";

const LABELS: Record<NetQuality, string> = {
  good: "Réseau OK",
  fair: "Réseau moyen",
  poor: "Réseau faible",
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
    net.quality !== "offline" && net.avgRttMs != null
      ? ` · ~${Math.round(net.avgRttMs)} ms · pertes ${net.lossPct}%`
      : net.quality === "offline"
        ? " · reconnexion…"
        : "";
  return (
    <span
      title="Qualité de la connexion (mesurée sur /api/health)"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        border: `1px solid ${color}55`,
        background: `${color}18`,
        color: "#e2e8f0",
        fontSize: "0.72rem",
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 6px ${color}`,
          flexShrink: 0,
        }}
      />
      {LABELS[net.quality]}
      {detail}
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
        bottom: "calc(76px + env(safe-area-inset-bottom))",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 3000,
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "rgba(239, 68, 68, 0.15)",
        border: "1px solid rgba(239, 68, 68, 0.6)",
        color: "#fecaca",
        padding: "8px 16px",
        borderRadius: 999,
        fontSize: "0.78rem",
        fontWeight: 700,
        maxWidth: "92%",
        textAlign: "center",
        boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
      }}
    >
      <WifiOff className="h-4 w-4" strokeWidth={2.4} style={{ flexShrink: 0 }} />
      {"Connexion perdue — la manche continue. Ne relâchez pas : l'encaissement sera retenté automatiquement."}
    </div>
  );
}
