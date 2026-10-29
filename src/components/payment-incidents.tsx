"use client";
import { useCallback, useEffect, useState } from "react";
import { CircleAlert, CheckCircle2, WalletCards } from "lucide-react";
type Incident = { kind: "deposit" | "withdrawal"; id: number; payment_status: string; method: string; created_at: string; review_state: string; note: string };
export function PaymentIncidents() {
  const [items, setItems] = useState<Incident[]>([]); const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => { const res = await fetch("/api/admin/payment-incidents", { cache: "no-store" }); if (!res.ok) throw new Error("Chargement impossible"); const data = await res.json(); setItems(data.incidents); setLoaded(true); }, []);
  useEffect(() => { let active=true; const tick=()=>void load().catch(()=>{if(active)setError("Chargement des incidents impossible.");}); tick(); const id=setInterval(tick,30000); return ()=>{active=false;clearInterval(id);}; }, [load]);
  async function save(item: Incident, state: string) {
    if (busy) return; setBusy(true); setError("");
    try { const r=await fetch("/api/admin/payment-incidents", { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({kind:item.kind,id:item.id,state,note:notes[`${item.kind}:${item.id}`] ?? item.note}) }); if(!r.ok) throw new Error("Enregistrement impossible."); setNotes(n=>{const next={...n}; delete next[`${item.kind}:${item.id}`]; return next;}); await load(); }
    catch(e){setError(e instanceof Error ? e.message : "Erreur.");} finally{setBusy(false);}
  }
  return <section className="mt-4 overflow-hidden rounded-2xl border border-edge bg-white text-[11px] text-ink">
    <div className="flex items-center gap-3 border-b border-edge p-3.5"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-betclic-red/10 text-betclic-red"><WalletCards size={18}/></div><div><h2 className="text-[12px] font-bold">Suivi des incidents de paiement</h2><p className="mt-0.5 text-[10px] text-mist">Détectez les opérations à vérifier</p></div></div>
    <div className="px-3 pt-3"><p className="flex items-start gap-1.5 rounded-lg bg-elev/70 p-2 text-[10px] text-mist"><CircleAlert size={13} className="shrink-0"/>Le suivi ne modifie ni le paiement ni le solde.</p>{error && <p role="alert" className="mt-2 text-betclic-red">{error}</p>}</div>
    {!loaded && !error && <p className="p-4 text-mist">Chargement…</p>}{loaded && !items.length && <div className="flex items-center gap-3 p-4 text-mist"><CheckCircle2 size={18} className="shrink-0 text-green-700"/><p>Aucun incident détecté.</p></div>}
    <div className="space-y-2 p-3">{items.map(item=>{ const key=`${item.kind}:${item.id}`; const label=item.review_state === "resolved" ? "Clos" : item.review_state === "investigating" ? "En cours" : "Ouvert"; return <article key={key} className="rounded-xl border border-edge bg-[#fafbfc] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><p>{item.kind === "deposit" ? "Dépôt" : "Retrait"} #{item.id}</p><p className="mt-0.5 text-[10px] text-mist">{item.method === "mobile_money" ? "Mobile Money" : item.method.toUpperCase()} · {new Date(item.created_at).toLocaleString("fr-FR")}</p></div><span className={`rounded-full px-2 py-1 text-[9px] ${item.review_state === "resolved" ? "bg-green-50 text-green-700" : item.review_state === "investigating" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-betclic-red"}`}>{label}</span></div>
      <p className="mt-2 text-[10px] text-mist">Statut du paiement : {({pending:"En attente",pending_review:"À vérifier",approved:"Approuvé",rejected:"Refusé",failed:"Échoué",expired:"Expiré",credited:"Crédité"} as Record<string,string>)[item.payment_status] ?? item.payment_status}</p>
      <label className="mt-2 block text-[10px] text-mist">Note interne<textarea aria-label={`Note incident ${key}`} maxLength={1000} value={notes[key] ?? item.note} onChange={e=>setNotes(v=>({...v,[key]:e.target.value}))} placeholder="Ajouter une note…" className="mt-1 min-h-16 w-full resize-y rounded-lg border border-edge bg-white p-2.5 text-[11px] text-ink outline-none focus:border-ink"/></label>
      <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={()=>void save(item,"investigating")} className="rounded-lg border border-edge bg-white px-3 py-2 text-mist disabled:opacity-50">En cours</button><button type="button" disabled={busy} onClick={()=>void save(item,"resolved")} className="rounded-lg bg-ink px-3 py-2 text-white disabled:opacity-50">Clore le suivi</button><button type="button" disabled={busy} onClick={()=>void save(item,"open")} className="rounded-lg border border-edge bg-white px-3 py-2 text-mist disabled:opacity-50">Rouvrir</button></div>
    </article>;})}</div>
  </section>;
}
