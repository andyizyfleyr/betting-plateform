"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, X, ArrowLeft, Send } from "lucide-react";
import { useApp } from "@/components/providers";

type Message = { id: number; sender_role: string; body: string; created_at: string; read_at: string | null };
type Conversation = { id: number; name: string; online: boolean; last_seen_at: string | null; unread: number };
function time(value: string) { return new Date(value).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
function lastSeen(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "Vu à l’instant";
  if (minutes < 60) return `Vu il y a ${minutes} min`;
  if (minutes < 1440) return `Vu il y a ${Math.floor(minutes / 60)} h`;
  return `Vu le ${time(value)}`;
}
export function SupportChat() {
  const { user } = useApp();
  return user ? <Chat key={user.id} isAdmin={user.role === "admin"} /> : null;
}
function Chat({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false); const [selected, setSelected] = useState<number | null>(null);
  const [rows, setRows] = useState<Conversation[]>([]); const [messages, setMessages] = useState<Message[]>([]);
  const [unread, setUnread] = useState(0); const [online, setOnline] = useState(false);
  const [text, setText] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const clientId = useRef<string | null>(null);
  const load = useCallback(async () => {
    const view = open && (!isAdmin || selected !== null);
    const qs = view ? `?view=messages${isAdmin ? `&id=${selected}` : ""}` : "";
    const response = await fetch(`/api/chat${qs}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Messagerie indisponible");
    const data = await response.json();
    if (isAdmin && !view) { setRows(data.conversations ?? []); setUnread((data.conversations ?? []).reduce((n: number, c: Conversation) => n + Number(c.unread), 0)); }
    else if (view) { setMessages(data.messages ?? []); setOnline(Boolean(data.adminOnline)); }
    else { setUnread(Number(data.unread ?? 0)); setOnline(Boolean(data.adminOnline)); }
  }, [open, isAdmin, selected]);
  useEffect(() => { let active = true; const tick = () => { void load().then(() => { if (active) setError(""); }).catch(() => { if (active && open) setError("Connexion à la messagerie impossible."); }); }; tick(); const timer = setInterval(tick, open ? 5000 : 20000); return () => { active = false; clearInterval(timer); }; }, [load, open]);
  const send = async () => {
    if (!text.trim() || busy) return; setBusy(true); setError("");
    clientId.current ||= crypto.randomUUID();
    try { const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: text.trim(), conversationId: selected, clientId: clientId.current }) }); if (!r.ok) throw new Error("Envoi impossible, réessayez."); clientId.current = null; setText(""); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Envoi impossible."); } finally { setBusy(false); }
  };
  const chatOpen = !isAdmin || selected !== null;
  return <div className="fixed bottom-20 right-3 z-[90] lg:bottom-5">
    {open && <section className="mb-2 flex h-[min(510px,70dvh)] w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-edge bg-white shadow-xl">
      <header className="flex items-center gap-2 border-b border-edge p-3"><button aria-label="Retour" onClick={() => setSelected(null)} className={isAdmin && selected ? "" : "hidden"}><ArrowLeft size={18} /></button><div className="flex-1"><h2 className="text-sm font-bold text-ink">{isAdmin && selected ? rows.find(x => x.id === selected)?.name ?? "Discussion" : "Messagerie"}</h2>{!isAdmin && <p className="text-[11px] text-mist">{online ? "Support en ligne" : "Support indisponible pour le moment"}</p>}</div><button aria-label="Fermer" onClick={() => setOpen(false)}><X size={18} /></button></header>
      {error && <p className="px-3 py-1 text-xs text-betclic-red">{error}</p>}
      {!chatOpen ? <div className="flex-1 overflow-auto p-2">{rows.length === 0 && <p className="p-2 text-xs text-mist">Aucune discussion.</p>}{rows.map(row => <button key={row.id} onClick={() => { setMessages([]); setSelected(row.id); }} className="flex w-full items-center justify-between border-b border-edge p-3 text-left"><span><span className="block text-xs text-ink">{row.name}</span><span className="text-[10px] text-mist">{row.online ? "En ligne" : row.last_seen_at ? lastSeen(row.last_seen_at) : "Hors ligne"}</span></span>{Number(row.unread) > 0 && <span className="rounded-full bg-betclic-red px-2 py-1 text-[10px] text-white">{row.unread}</span>}</button>)}</div> : <><div className="flex flex-1 flex-col gap-2 overflow-auto p-3">{messages.length === 0 && <p className="text-xs text-mist">Écrivez votre premier message.</p>}{messages.map(m => { const mine = m.sender_role === (isAdmin ? "admin" : "user"); return <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 ${mine ? "self-end bg-ink text-white" : "self-start bg-elev text-ink"}`}><p className="whitespace-pre-wrap break-words text-xs">{m.body}</p><p className={`mt-1 text-[9px] ${mine ? "text-white/70" : "text-mist"}`}>{time(m.created_at)}{mine ? m.read_at ? " · Lu" : " · Envoyé" : ""}</p></div>; })}</div><form className="flex gap-2 border-t border-edge p-2" onSubmit={e => { e.preventDefault(); void send(); }}><input aria-label="Votre message" value={text} maxLength={2000} onChange={e => { setText(e.target.value); clientId.current = null; }} className="min-w-0 flex-1 rounded-xl bg-elev px-3 text-xs text-ink" placeholder="Votre message…" /><button aria-label="Envoyer" disabled={busy || !text.trim()} className="rounded-xl bg-ink p-2 text-white disabled:opacity-40"><Send size={18} /></button></form></>}
    </section>}
    <button aria-label={open ? "Fermer la messagerie" : "Ouvrir la messagerie"} onClick={() => setOpen(!open)} className="relative ml-auto flex h-12 w-12 items-center justify-center rounded-full bg-betclic-red text-white shadow-lg"><MessageCircle size={23} />{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-ink px-1.5 py-0.5 text-[10px] text-white">{unread > 99 ? "99+" : unread}</span>}</button>
  </div>;
}
