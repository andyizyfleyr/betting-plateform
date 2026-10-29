"use client";
import { useEffect, useState } from "react";
import { Activity, BellRing, Clock3, CreditCard, Wallet, CircleAlert } from "lucide-react";
const metrics = [
  { key:"deposits_review", label:"Dépôts à vérifier", icon:CreditCard },
  { key:"deposits_stale", label:"Dépôts en attente > 24 h", icon:Clock3 },
  { key:"deposits_failed", label:"Dépôts en échec · 7 j", icon:CircleAlert },
  { key:"withdrawals_stale", label:"Retraits en attente > 24 h", icon:Wallet },
  { key:"push_failed", label:"Notifications en échec", icon:BellRing },
  { key:"unsettled_bets", label:"Paris à régler", icon:Activity },
];
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
  return <section className="mt-4 overflow-hidden rounded-2xl border border-edge bg-white">
    <div className="flex items-center gap-3 border-b border-edge p-4"><div className="grid h-10 w-10 place-items-center rounded-xl bg-betclic-red/10 text-betclic-red"><Activity size={18}/></div><div className="min-w-0 flex-1"><h2 className="text-[12px] font-bold text-ink">Surveillance de la plateforme</h2><p className="mt-0.5 text-[10px] text-mist">Paiements, paris et notifications · actualisation toutes les 30 s</p></div><span className="rounded-full bg-elev px-2 py-1 text-[9px] text-mist">Direct</span></div>
    {error && <p className="px-4 pt-3 text-[11px] text-betclic-red">Actualisation impossible. Les dernières valeurs peuvent être anciennes.</p>}
    {!data && !error && <p className="p-4 text-[11px] text-mist">Chargement…</p>}
    {data && <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">{metrics.map(({key,label,icon:Icon}) => {const n=Number(data[key] ?? 0);return <div key={key} className="rounded-xl bg-elev/70 p-3"><div className="flex items-center justify-between"><Icon size={15} className={n ? "text-betclic-red" : "text-mist"}/><span className={`text-[17px] ${n ? "text-betclic-red" : "text-ink"}`}>{n}</span></div><p className="mt-2 text-[10px] leading-4 text-mist">{label}</p></div>;})}</div>}
  </section>;
}
