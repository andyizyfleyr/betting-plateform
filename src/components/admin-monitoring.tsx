"use client";
import { useEffect, useState } from "react";
const labels: Record<string, string> = {
  deposits_review: "Dépôts à vérifier", deposits_stale: "Dépôts en attente depuis plus de 24 h",
  deposits_failed: "Dépôts échoués, expirés ou refusés (7 jours)", withdrawals_stale: "Retraits en attente depuis plus de 24 h",
  push_failed: "Notifications en échec après 5 tentatives", unsettled_bets: "Paris simples en attente sur matchs terminés",
};
export function AdminMonitoring() {
  const [data, setData] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try { const r = await fetch("/api/admin/monitoring", { cache: "no-store" }); if (!r.ok) throw new Error(); const v = await r.json(); if (active) { setData(v.monitoring); setError(false); } }
      catch { if (active) setError(true); }
    };
    void load(); const timer = setInterval(() => void load(), 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <section className="mt-4 rounded-xl border border-edge bg-white p-4 text-[11px] text-ink"><h2 className="font-bold">Surveillance de la plateforme</h2><p className="mt-1 text-mist">Indicateurs actualisés toutes les 30 secondes. À vérifier dans les rubriques de gestion.</p>{error && <p className="text-betclic-red">Actualisation impossible.</p>}{!data && !error && <p>Chargement…</p>}{data && Object.entries(labels).map(([key,label]) => <p key={key} className="mt-1">{label} : {data[key] ?? 0}</p>)}</section>;
}
