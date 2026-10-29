"use client";
import { useCallback, useEffect, useState } from "react";

type Dispute = { id: number; betKind: string; betId: number; message: string; status: string; adminReply: string | null };
export function BetDispute({ betKind, betId }: { betKind: "sport" | "prediction" | "combo"; betId: number }) {
  const [open, setOpen] = useState(false); const [message, setMessage] = useState(""); const [items, setItems] = useState<Dispute[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const load = useCallback(async () => { const r = await fetch("/api/disputes", { cache: "no-store" }); if (!r.ok) throw new Error("Chargement impossible"); const v = await r.json() as { disputes: Dispute[] }; setItems(v.disputes.filter((d) => d.betKind === betKind && d.betId === betId)); }, [betKind, betId]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active && open) void load().catch(() => setError("Impossible de charger vos réclamations.")); }); return () => { active = false; }; }, [open, load]);
  const submit = async () => {
    if (busy || message.trim().length < 10) return; setBusy(true); setError("");
    try { const r = await fetch("/api/disputes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ betId, betKind, message: message.trim() }) }); if (!r.ok) throw new Error((await r.json()).error || "Envoi impossible"); setMessage(""); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Envoi impossible."); } finally { setBusy(false); }
  };
  return <section className="my-3 rounded-xl border border-edge bg-white p-3 text-[11px] text-ink">
    <button type="button" onClick={() => setOpen((v) => !v)}>Signaler un problème sur ce pari {open ? "−" : "+"}</button>
    {open && <div className="mt-2 space-y-2">{items.map((d) => <div key={d.id} className="rounded-lg bg-elev p-2"><p>Réclamation #{d.id} · {d.status === "resolved" ? "Résolue" : d.status === "in_review" ? "En cours" : "Ouverte"}</p><p>{d.message}</p>{d.adminReply && <p>Réponse : {d.adminReply}</p>}</div>)}
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} placeholder="Décrivez le problème (10 caractères minimum)" className="min-h-20 w-full rounded-lg border border-edge p-2" />
      {error && <p className="text-betclic-red">{error}</p>}<button disabled={busy || message.trim().length < 10} onClick={() => void submit()} className="rounded-lg bg-betclic-red px-3 py-2 text-white disabled:opacity-50">Envoyer la réclamation</button></div>}
  </section>;
}
