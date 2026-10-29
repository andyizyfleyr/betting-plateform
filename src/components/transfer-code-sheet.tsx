"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { X } from "lucide-react";
import QRCode from "qrcode";
import { useApp } from "@/components/providers";
import { localToEur } from "@/lib/countries";
import { eur } from "@/lib/format";
import { generateIdempotencyKey } from "@/lib/odds-lock";
import { formatTransferCode, isValidTransferCode, normalizeTransferCode } from "@/lib/transfer-code";

type Tab = "deposit" | "withdraw" | "history";
type Entry = { id: string; amount: number; status: string; created_at: string; updated_at: string; type: "deposit" | "withdrawal" };
type Result = { error?: string; balance?: number; amount?: number; code?: string | null; id?: string; status?: string; transfers?: Entry[]; nextCursor?: string | null };
async function request(body?: object, cursor?: string): Promise<Result> {
  const url = cursor ? `/api/transfer-codes?before=${encodeURIComponent(cursor)}` : "/api/transfer-codes";
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" } : { cache: "no-store" });
  const data: Result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Service indisponible.");
  return data;
}
function CodeQr({ value }: { value: string }) {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  return <svg role="img" aria-label="QR du code de transfert" viewBox={`0 0 ${size + 8} ${size + 8}`} className="mx-auto h-40 w-40 bg-white" shapeRendering="crispEdges"><rect width={size + 8} height={size + 8} fill="white" />{Array.from(qr.modules.data, (dark, i) => dark ? <rect key={i} x={i % size + 4} y={Math.floor(i / size) + 4} width="1" height="1" /> : null)}</svg>;
}

export function TransferCodeSheet({ open, onClose, withdrawable }: { open: boolean; onClose: () => void; withdrawable: string }) {
  const { currency, setBalance } = useApp();
  const [tab, setTab] = useState<Tab>("deposit");
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [created, setCreated] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [detail, setDetail] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<"close" | "cancel" | Tab | null>(null);
  const createSlot = useRef<{ amount: number; key: string } | null>(null);
  const redeemSlot = useRef<{ code: string; key: string } | null>(null);
  const controls = useDragControls();
  const close = useCallback(() => { if (busy) return; if (created) setConfirmation("close"); else onClose(); }, [busy, created, onClose]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [open, close]);
  const load = async (next?: string) => { const result = await request(undefined, next); setEntries(previous => next ? [...previous, ...(result.transfers ?? [])] : result.transfers ?? []); setCursor(result.nextCursor ?? null); };
  const changeTab = async (next: Tab, confirmed = false) => {
    if (busy) return;
    if (created && !confirmed) { setConfirmation(next); return; }
    setCreated(""); setMessage(""); setError(""); setDetail(null); setTab(next);
    if (next === "history") { setBusy(true); try { await load(); } catch (e) { setError(e instanceof Error ? e.message : "Service indisponible."); } finally { setBusy(false); } }
  };
  const perform = async (action: "create" | "redeem" | "cancel", id?: string) => {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      let payload: object;
      if (action === "create") {
        const num = Number(amount.replace(",", "."));
        if (!Number.isFinite(num) || num <= 0) throw new Error("Montant invalide.");
        const pivot = localToEur(num, currency);
        if (!createSlot.current || createSlot.current.amount !== pivot) createSlot.current = { amount: pivot, key: generateIdempotencyKey("transfer") };
        payload = { action, amount: pivot, key: createSlot.current.key };
      } else if (action === "redeem") {
        if (!isValidTransferCode(code)) throw new Error("Vérifiez le code saisi.");
        if (!redeemSlot.current || redeemSlot.current.code !== code) redeemSlot.current = { code, key: generateIdempotencyKey("transfer") };
        payload = { action, code, key: redeemSlot.current.key };
      } else payload = { action, id };
      const result = await request(payload);
      if (typeof result.balance === "number") setBalance(result.balance);
      if (action === "create") {
        if (result.code) { setCreated(result.code); createSlot.current = null; }
        else { setMessage("Le code a déjà été créé et ne peut pas être réaffiché. Retrouvez-le dans l’historique pour l’annuler si nécessaire."); createSlot.current = null; }
      } else if (action === "redeem") { setMessage(`Dépôt réussi : ${eur(result.amount ?? 0)}. Nouveau solde : ${eur(result.balance ?? 0)}.`); setCode(""); redeemSlot.current = null; }
      else { setMessage("Code annulé et solde remboursé."); setDetail(null); await load(); }
    } catch (e) { setError(e instanceof Error ? e.message : "Impossible de terminer l’opération."); }
    finally { setBusy(false); }
  };
  const scanImage = async (file?: File) => {
    if (!file) return;
    try {
      const Detector = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (source: ImageBitmap) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
      if (!Detector) throw new Error("Scan indisponible sur ce navigateur. Collez le code.");
      const image = await createImageBitmap(file); const found = await new Detector({ formats: ["qr_code"] }).detect(image); image.close();
      const value = found[0]?.rawValue ?? ""; if (!isValidTransferCode(value)) throw new Error("QR invalide."); setCode(normalizeTransferCode(value)); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Scan indisponible."); }
  };
  const visible = entries.filter(item => filter === "all" || item.type === filter || item.status === filter);
  const button = "w-full rounded-xl bg-betclic-red py-3 text-sm text-white disabled:bg-gray-300 disabled:text-gray-600";
  return <AnimatePresence>{open && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 sm:items-center" onClick={close}>
    <motion.div role="dialog" aria-modal="true" aria-label="Codes de transfert" initial={{ opacity: 0, y: 35 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 35 }} drag="y" dragControls={controls} dragListener={false} dragConstraints={{ top: 0, bottom: 0 }} onDragEnd={(_, info) => { if (info.offset.y > 100 || info.velocity.y > 700) close(); }} onClick={event => event.stopPropagation()} className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl sm:max-w-md sm:rounded-2xl">
      <div className="flex h-5 touch-none items-start justify-center" onPointerDown={event => controls.start(event)}><div className="h-1 w-10 rounded-full bg-gray-300" /></div>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-bold text-ink">Codes de transfert</h2><button type="button" aria-label="Fermer" onClick={close} className="rounded-full bg-gray-100 p-2"><X size={17} /></button></div>
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1">{([['deposit','Déposer'],['withdraw','Retirer'],['history','Historique']] as const).map(([id,label]) => <button key={id} type="button" onClick={() => void changeTab(id)} className={`rounded-lg px-1 py-2 text-xs ${tab === id ? 'bg-white text-betclic-red shadow-sm' : 'text-gray-600'}`}>{label}</button>)}</div>
      {confirmation && <div role="alertdialog" aria-label="Confirmation" className="mb-3 space-y-2 rounded-xl bg-amber-50 p-3 text-xs"><p>{confirmation === "cancel" ? "Annuler ce code et récupérer le montant ?" : "Ce code ne sera plus affiché. L’avez-vous copié ?"}</p><div className="flex gap-2"><button type="button" className="rounded-lg border px-3 py-2" onClick={() => setConfirmation(null)}>Retour</button><button type="button" className="rounded-lg bg-betclic-red px-3 py-2 text-white" onClick={() => { const next = confirmation; setConfirmation(null); if (next === "close") onClose(); else if (next === "cancel") void perform("cancel", detail?.id); else void changeTab(next, true); }}>Confirmer</button></div></div>}
      {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</p>}{message && <p role="status" className="mb-3 rounded-xl bg-green-50 p-3 text-xs text-green-800">{message}</p>}
      {tab === "deposit" && <div className="space-y-3"><h3 className="text-sm font-bold">Déposer avec un code</h3><p className="text-xs text-gray-600">Saisissez ou collez le code reçu d’un autre utilisateur.</p><input aria-label="Code de transfert" inputMode="numeric" autoComplete="off" value={formatTransferCode(code)} onChange={e => setCode(normalizeTransferCode(e.target.value))} placeholder="0000-0000-0000-0000-0000" className="w-full rounded-xl border border-gray-300 px-3 py-3 text-center text-sm tracking-wider" /><label className="block text-center text-xs text-betclic-red">Scanner un QR<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={e => { void scanImage(e.target.files?.[0]); e.target.value = ""; }} /></label>{code.length === 20 && !isValidTransferCode(code) && <p className="text-xs text-red-600">Vérifiez le code saisi.</p>}<button type="button" onClick={() => void perform("redeem")} disabled={busy || !isValidTransferCode(code)} className={button}>{busy ? "Validation…" : "Valider le code"}</button></div>}
      {tab === "withdraw" && <div className="space-y-3"><h3 className="text-sm font-bold">Retirer avec un code</h3>{created ? <><p className="text-xs text-gray-600">Ce code ne sera affiché qu’une fois. Copiez-le avant de fermer.</p><CodeQr value={created} /><p className="select-all text-center text-sm tracking-wider">{formatTransferCode(created)}</p><button type="button" onClick={() => void navigator.clipboard.writeText(created).then(() => setMessage("Code copié.")).catch(() => setError("Sélectionnez le code pour le copier."))} className={button}>Copier le code</button></> : <><p className="text-xs text-gray-600">Le montant est réservé sur votre solde. Transmettez le code au destinataire.</p><p className="text-xs text-gray-600">Solde transférable : {withdrawable}</p><input aria-label="Montant" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Montant" className="w-full rounded-xl border border-gray-300 px-3 py-3 text-sm" /><p className="text-xs text-gray-600">Sans expiration. En cas de réponse perdue, annulez depuis l’historique.</p><button type="button" onClick={() => void perform("create")} disabled={busy || !(Number(amount.replace(",", ".")) > 0)} className={button}>{busy ? "Génération…" : "Générer le code"}</button></>}</div>}
      {tab === "history" && <div className="space-y-3"><select aria-label="Filtrer les codes" value={filter} onChange={e => setFilter(e.target.value)} className="w-full rounded-xl border p-2 text-xs"><option value="all">Tous</option><option value="deposit">Dépôts</option><option value="withdrawal">Retraits</option><option value="new">Neufs</option><option value="used">Utilisés</option><option value="cancelled">Annulés</option></select>{detail ? <div className="space-y-3 text-xs"><button onClick={() => setDetail(null)} className="text-betclic-red">← Historique</button><p>Type : {detail.type === "deposit" ? "Dépôt" : "Retrait"}</p><p>Montant : {eur(detail.amount)}</p><p>Statut : {detail.status === "new" ? "Neuf" : detail.status === "used" ? "Utilisé" : "Annulé"}</p><p>Date : {new Date(detail.created_at).toLocaleString("fr-FR")}</p>{detail.type === "withdrawal" && detail.status === "new" && <button disabled={busy} onClick={() => setConfirmation("cancel")} className={button}>Annuler et rembourser</button>}</div> : visible.length ? visible.map(item => <button key={item.id} onClick={() => setDetail(item)} className="flex w-full justify-between rounded-xl border p-3 text-xs"><span>{item.type === "deposit" ? "Dépôt" : "Retrait"} · {item.status === "new" ? "Neuf" : item.status === "used" ? "Utilisé" : "Annulé"}</span><span>{eur(item.amount)} ›</span></button>) : <p className="py-4 text-center text-xs text-gray-600">{busy ? "Chargement…" : "Aucun code."}</p>}{!detail && cursor && <button disabled={busy} className="w-full rounded-xl border p-3 text-xs" onClick={() => { setBusy(true); void load(cursor).catch(e => setError(e instanceof Error ? e.message : "Service indisponible.")).finally(() => setBusy(false)); }}>Charger plus</button>}</div>}
    </motion.div></div>}</AnimatePresence>;
}
