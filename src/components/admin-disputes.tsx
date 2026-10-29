"use client";
import { useCallback, useEffect, useState } from "react";
import { MessageSquareText, RefreshCw, CheckCircle2 } from "lucide-react";
type Row = { userName: string; dispute: { id: number; betId: number; betKind: string; status: string; message: string; adminReply: string | null } };
export function AdminDisputes() {
  const [rows, setRows] = useState<Row[]>([]); const [drafts, setDrafts] = useState<Record<number,string>>({}); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => { const r = await fetch("/api/admin/disputes", { cache: "no-store" }); if (!r.ok) throw new Error("Chargement impossible"); const v = await r.json() as { disputes: Row[] }; setRows(v.disputes); setLoaded(true); }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load().catch(() => setError("Chargement des réclamations impossible.")); }); return () => { active = false; }; }, [load]);
  const update = async (id: number, status: "in_review" | "resolved", previous: string | null) => {
    if (busy) return; setBusy(true); setError("");
    try { const r = await fetch("/api/admin/disputes", { method:"PATCH", headers: { "Content-Type":"application/json" }, body:JSON.stringify({ id, status, reply: drafts[id] ?? previous ?? "" }) }); if (!r.ok) throw new Error((await r.json()).error || "Enregistrement impossible"); await load(); }
    catch(e) { setError(e instanceof Error ? e.message : "Erreur"); } finally { setBusy(false); }
  };
  return <section className="mt-4 overflow-hidden rounded-2xl border border-edge bg-white text-[11px] text-ink">
    <div className="flex items-center gap-3 border-b border-edge p-3.5">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-betclic-red/10 text-betclic-red"><MessageSquareText size={18} /></div>
      <div className="min-w-0 flex-1"><h2 className="text-[12px] font-bold">Réclamations</h2><p className="mt-0.5 text-[10px] text-mist">Consultez et répondez aux demandes des joueurs</p></div>
      <button type="button" aria-label="Actualiser les réclamations" onClick={() => void load().catch(() => setError("Actualisation impossible"))} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-elev text-mist"><RefreshCw size={15} /></button>
    </div>
    {error && <p role="alert" className="mx-3 mt-3 rounded-lg bg-red-50 p-2 text-betclic-red">{error}</p>}
    {!loaded && !error && <p className="p-4 text-mist">Chargement…</p>}
    {loaded && !rows.length && <div className="flex items-center gap-3 p-4 text-mist"><CheckCircle2 size={18} className="shrink-0 text-green-700"/><p>Aucune réclamation pour le moment.</p></div>}
    <div className="space-y-2 p-3">{rows.map(({ userName, dispute:d }) => <article key={d.id} className="rounded-xl border border-edge bg-[#fafbfc] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-ink">{userName}</p><p className="mt-0.5 text-[10px] text-mist">Réclamation #{d.id} · {d.betKind === "combo" ? "Combiné" : d.betKind === "prediction" ? "Pronostic" : "Pari sportif"} #{d.betId}</p></div><span className={`rounded-full px-2 py-1 text-[9px] ${d.status === "resolved" ? "bg-green-50 text-green-700" : d.status === "in_review" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-betclic-red"}`}>{d.status === "resolved" ? "Résolue" : d.status === "in_review" ? "En cours" : "Ouverte"}</span></div>
      <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-white p-2.5 text-mist">{d.message}</p>
      <label className="mt-2 block text-[10px] text-mist">Votre réponse<textarea value={drafts[d.id] ?? d.adminReply ?? ""} onChange={(e) => setDrafts((v) => ({ ...v, [d.id]: e.target.value }))} maxLength={2000} placeholder="Rédiger une réponse…" className="mt-1 min-h-16 w-full resize-y rounded-lg border border-edge bg-white p-2.5 text-[11px] text-ink outline-none focus:border-ink" /></label>
      <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void update(d.id,"in_review",d.adminReply)} className="rounded-lg border border-edge bg-white px-3 py-2 text-mist disabled:opacity-50">Mettre en cours</button><button type="button" disabled={busy} onClick={() => void update(d.id,"resolved",d.adminReply)} className="rounded-lg bg-ink px-3 py-2 text-white disabled:opacity-50">Répondre et clôturer</button></div>
    </article>)}</div>
  </section>;
}
