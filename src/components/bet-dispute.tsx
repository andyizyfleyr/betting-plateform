"use client";
import { useCallback, useEffect, useState } from "react";
import { MessageSquareWarning, ChevronDown, Send } from "lucide-react";

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
  return <section className="my-3 overflow-hidden rounded-2xl border border-edge bg-white text-[11px] text-ink">
    <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 p-3 text-left"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-betclic-red/10 text-betclic-red"><MessageSquareWarning size={17}/></span><span className="min-w-0 flex-1"><span className="block text-[12px] font-bold">Besoin d’aide ?</span><span className="mt-0.5 block text-[10px] text-mist">Signaler un problème sur ce pari</span></span><ChevronDown size={16} className={`shrink-0 text-mist transition-transform ${open ? "rotate-180" : ""}`}/></button>
    {open && <div className="space-y-2 border-t border-edge p-3">{items.map((d) => <div key={d.id} className="rounded-xl border border-edge bg-[#fafbfc] p-3"><div className="flex items-center justify-between gap-2"><p>Réclamation #{d.id}</p><span className={`rounded-full px-2 py-1 text-[9px] ${d.status === "resolved" ? "bg-green-50 text-green-700" : d.status === "in_review" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-betclic-red"}`}>{d.status === "resolved" ? "Résolue" : d.status === "in_review" ? "En cours" : "Ouverte"}</span></div><p className="mt-2 whitespace-pre-wrap break-words text-mist">{d.message}</p>{d.adminReply && <div className="mt-2 rounded-lg bg-white p-2.5"><p className="text-[10px] text-mist">Réponse du support</p><p className="mt-1 whitespace-pre-wrap break-words">{d.adminReply}</p></div>}</div>)}
      <label className="block text-[10px] text-mist">Votre message<textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} placeholder="Décrivez le problème (10 caractères minimum)" className="mt-1 min-h-20 w-full resize-y rounded-xl border border-edge bg-elev/40 p-3 text-[11px] text-ink outline-none focus:border-ink" /></label>
      {error && <p role="alert" className="text-betclic-red">{error}</p>}<button disabled={busy || message.trim().length < 10} onClick={() => void submit()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-betclic-red px-3 py-2.5 text-white disabled:opacity-50"><Send size={14}/>{busy ? "Envoi…" : "Envoyer la réclamation"}</button></div>}
  </section>;
}
