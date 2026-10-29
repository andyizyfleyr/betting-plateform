"use client";
import { useCallback, useEffect, useState } from "react";
type Row = { userName: string; dispute: { id: number; betId: number; betKind: string; status: string; message: string; adminReply: string | null } };
export function AdminDisputes() {
  const [rows, setRows] = useState<Row[]>([]); const [drafts, setDrafts] = useState<Record<number,string>>({}); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await fetch("/api/admin/disputes", { cache: "no-store" }); if (!r.ok) throw new Error("Chargement impossible"); const v = await r.json() as { disputes: Row[] }; setRows(v.disputes); }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load().catch(() => setError("Chargement des réclamations impossible.")); }); return () => { active = false; }; }, [load]);
  const update = async (id: number, status: "in_review" | "resolved", previous: string | null) => {
    if (busy) return; setBusy(true); setError("");
    try { const r = await fetch("/api/admin/disputes", { method:"PATCH", headers: { "Content-Type":"application/json" }, body:JSON.stringify({ id, status, reply: drafts[id] ?? previous ?? "" }) }); if (!r.ok) throw new Error((await r.json()).error || "Enregistrement impossible"); await load(); }
    catch(e) { setError(e instanceof Error ? e.message : "Erreur"); } finally { setBusy(false); }
  };
  return <section className="mt-4 rounded-xl border border-edge bg-white p-4 text-[11px] text-ink"><h2 className="font-bold">Réclamations</h2><button onClick={() => void load().catch(() => setError("Actualisation impossible"))} className="mt-1 text-betclic-red">Actualiser</button>{error && <p className="text-betclic-red">{error}</p>}{!rows.length && <p className="text-mist">Aucune réclamation.</p>}{rows.map(({ userName, dispute:d }) => <div key={d.id} className="mt-2 space-y-1 border-t border-edge pt-2"><p>#{d.id} · {userName} · {d.betKind} #{d.betId} · {d.status}</p><p>{d.message}</p><textarea value={drafts[d.id] ?? d.adminReply ?? ""} onChange={(e) => setDrafts((v) => ({ ...v, [d.id]: e.target.value }))} maxLength={2000} placeholder="Réponse" className="w-full rounded-lg border border-edge p-2" /><div className="flex gap-4"><button disabled={busy} onClick={() => void update(d.id,"in_review",d.adminReply)}>En cours</button><button disabled={busy} onClick={() => void update(d.id,"resolved",d.adminReply)} className="text-betclic-red">Répondre et clôturer</button></div></div>)}</section>;
}
