"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { X, Copy, Check, CheckCircle2, XCircle, ArrowDownLeft, ArrowUpRight, ChevronRight, ClipboardPaste } from "lucide-react";
import QRCode from "qrcode";
import { useApp } from "@/components/providers";
import { localToEur, maxSpendableLocalFromEur, formatLocalInputString, formatPresetChip } from "@/lib/countries";
import { eur } from "@/lib/format";
import { generateIdempotencyKey } from "@/lib/odds-lock";
import { formatTransferCode, isValidTransferCode, normalizeTransferCode } from "@/lib/transfer-code";

type Tab = "deposit" | "withdraw" | "history";
type Entry = { code: string | null; id: string; amount: number; status: string; created_at: string; updated_at: string; type: "deposit" | "withdrawal" };
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

export function TransferCodeSheet({ open, onClose, withdrawable, withdrawableEur }: { open: boolean; onClose: () => void; withdrawable: string; withdrawableEur?: number | null }) {
  const { currency, currencyConfig, setBalance } = useApp();
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
  const [confirmation, setConfirmation] = useState<"cancel" | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const createSlot = useRef<{ amount: number; key: string } | null>(null);
  const redeemSlot = useRef<{ code: string; key: string } | null>(null);
  const controls = useDragControls();
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [open, close]);
  const load = async (next?: string) => { const result = await request(undefined, next); setEntries(previous => next ? [...previous, ...(result.transfers ?? [])] : result.transfers ?? []); setCursor(result.nextCursor ?? null); };
  const changeTab = async (next: Tab) => {
    if (busy) return;
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
        else { setMessage("Code créé. Retrouvez-le dans l’historique."); createSlot.current = null; }
      } else if (action === "redeem") { setMessage(`Dépôt réussi : ${eur(result.amount ?? 0)}. Nouveau solde : ${eur(result.balance ?? 0)}.`); setCode(""); redeemSlot.current = null; }
      else { setMessage("Code annulé et solde remboursé."); setDetail(null); await load().catch(() => undefined); }
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
      <div className="mb-4 flex items-center justify-between"><div><h2 className="text-base font-bold text-ink">Codes de transfert</h2><p className="mt-1 text-[11px] text-mist">Envoyez ou recevez de l’argent avec un code</p></div><button type="button" aria-label="Fermer" onClick={close} className="rounded-full bg-gray-100 p-2"><X size={17} /></button></div>
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1">{([['deposit','Déposer'],['withdraw','Retirer'],['history','Historique']] as const).map(([id,label]) => <button key={id} type="button" onClick={() => void changeTab(id)} className={`rounded-lg px-1 py-2 text-xs ${tab === id ? 'bg-white text-betclic-red shadow-sm' : 'text-gray-600'}`}>{label}</button>)}</div>
      {confirmation && <div role="alertdialog" aria-label="Confirmation" className="mb-3 space-y-2 rounded-xl bg-amber-50 p-3 text-xs"><p>Annuler ce code et récupérer le montant ?</p><div className="flex gap-2"><button type="button" className="rounded-lg border px-3 py-2" onClick={() => setConfirmation(null)}>Retour</button><button type="button" className="rounded-lg bg-betclic-red px-3 py-2 text-white" onClick={() => { setConfirmation(null); void perform("cancel", detail?.id); }}>Confirmer</button></div></div>}
      {(error || message) && <div role={error ? "alert" : "status"} className="py-5 text-center"><div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${error ? "bg-red-50 text-red-500" : "bg-emerald-50 text-emerald-500"}`}>{error ? <XCircle size={32} /> : <CheckCircle2 size={32} />}</div><h3 className="mt-4 text-base font-semibold text-ink">{error ? "Opération échouée" : "Opération réussie"}</h3><p className="mt-2 text-xs text-gray-500">{error || message}</p><button onClick={() => { setError(""); setMessage(""); }} className="mt-6 w-full rounded-xl bg-betclic-red py-3 text-sm text-white">{error ? "Réessayer" : "Terminé"}</button></div>}
      {!error && !message && tab === "deposit" && <div className="space-y-3"><h3 className="text-sm font-bold">Déposer avec un code</h3><p className="text-xs text-mist">Entrez le code reçu pour créditer votre compte.</p><div className="relative"><div aria-hidden="true" className="grid grid-cols-5 gap-1.5">{Array.from({length: 5}, (_, i) => <span key={i} className={`rounded-xl border py-3 text-center font-mono text-xs ${Math.floor(Math.min(code.length, 19)/4) === i ? "border-betclic-red" : "border-edge bg-elev"}`}>{code.slice(i*4, i*4+4).padEnd(4, "0")}</span>)}</div><input aria-label="Code de transfert à 20 chiffres" inputMode="numeric" autoComplete="off" value={formatTransferCode(code)} onChange={e => setCode(normalizeTransferCode(e.target.value))} className="absolute inset-0 h-full w-full cursor-text opacity-0" /></div><p className="text-xs text-mist">Le code contient 20 chiffres.</p><div className="grid grid-cols-2 gap-2"><label className="flex items-center justify-center rounded-xl border border-edge p-3 text-xs text-ink">Scanner un QR<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={e => { void scanImage(e.target.files?.[0]); e.target.value = ""; }} /></label><button type="button" onClick={() => void navigator.clipboard.readText().then(v => setCode(normalizeTransferCode(v))).catch(() => setError("Collage indisponible. Saisissez le code."))} className="flex items-center justify-center gap-1 rounded-xl border border-edge p-3 text-xs"><ClipboardPaste size={14} />Coller le code</button></div>{code.length === 20 && !isValidTransferCode(code) && <p className="text-xs text-red-600">Vérifiez le code saisi.</p>}<button type="button" onClick={() => void perform("redeem")} disabled={busy || !isValidTransferCode(code)} className={button}>{busy ? "Validation…" : "Valider le code"}</button></div>}
      {!error && !message && tab === "withdraw" && <div className="space-y-3"><h3 className="text-sm font-bold">Retirer avec un code</h3>{created ? <><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-500"><CheckCircle2 size={30} /></div><p className="text-center text-sm font-semibold">Code créé</p><CodeQr value={created} /><p className="select-all text-center text-sm tracking-wider">{formatTransferCode(created)}</p><button type="button" onClick={() => void navigator.clipboard.writeText(created).then(() => setMessage("Code copié.")).catch(() => setError("Sélectionnez le code pour le copier."))} className={button}>Copier le code</button></> : <><p className="text-xs text-mist">Générez un code pour envoyer de l’argent à quelqu’un.</p><div className="rounded-xl bg-elev p-3"><p className="text-xs text-mist">Solde transférable</p><p className="mt-1 text-lg font-bold">{withdrawable}</p></div><label htmlFor="transfer-amount" className="block text-xs text-mist">Montant</label><input id="transfer-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" className="w-full rounded-xl border border-gray-300 px-3 py-3 text-center text-lg" /><div className="grid grid-cols-4 gap-2">{currencyConfig.withdrawalPresetsLocal.map(n => <button key={n} type="button" onClick={() => setAmount(String(n))} className="rounded-xl bg-elev py-2 text-xs">{formatPresetChip(n, currency)}</button>)}<button type="button" disabled={withdrawableEur == null} onClick={() => { if (withdrawableEur != null) setAmount(formatLocalInputString(maxSpendableLocalFromEur(withdrawableEur, currency), currency, ".")); }} className="rounded-xl bg-betclic-red/10 py-2 text-xs text-betclic-red disabled:opacity-40">MAX</button></div><p className="rounded-xl border border-edge p-3 text-xs text-mist">Partagez le code seulement avec la personne concernée : quiconque le possède peut l’utiliser.</p><button type="button" onClick={() => void perform("create")} disabled={busy || !(Number(amount.replace(",", ".")) > 0)} className={button}>{busy ? "Génération…" : "Générer le code"}</button></>}</div>}
      {!error && !message && tab === "history" && <div className="space-y-3">{detail ? <div className="space-y-3 text-xs"><button onClick={() => setDetail(null)} className="text-betclic-red">← Historique</button><div className="space-y-2 rounded-2xl bg-elev p-5 text-center"><span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-white">{detail.type === "deposit" ? <ArrowDownLeft className="text-win" /> : <ArrowUpRight className="text-betclic-red" />}</span><p>{detail.type === "deposit" ? "Dépôt" : "Retrait"} par code</p><p className="text-xl font-bold text-ink">{eur(detail.amount)}</p><p>{statusLabel(detail.status)}</p></div>{[["Type", detail.type === "deposit" ? "Dépôt" : "Retrait"], ["Montant", eur(detail.amount)], ["Statut", statusLabel(detail.status)], ["Date", new Date(detail.created_at).toLocaleString("fr-FR")]].map(([label,value]) => <div key={label} className="flex justify-between gap-3 border-b border-edge py-2"><span className="text-mist">{label}</span><span className="text-right text-ink">{value}</span></div>)}{detail.type === "withdrawal" && detail.status === "new" && <button disabled={busy} onClick={() => setConfirmation("cancel")} className={button}>Annuler et rembourser</button>}</div> : <><div className="no-scrollbar flex gap-2 overflow-x-auto">{([['all','Tous'],['deposit','Dépôts'],['withdrawal','Retraits'],['new','Neufs'],['used','Utilisés'],['cancelled','Annulés']] as const).map(([value,label]) => <button key={value} onClick={() => setFilter(value)} aria-pressed={filter === value} className={`shrink-0 rounded-full border px-3 py-2 text-xs ${filter === value ? "border-betclic-red bg-betclic-red text-white" : "border-edge bg-white"}`}>{label}</button>)}</div>{visible.length ? visible.map(item => <div key={item.id} className="flex items-center gap-2 rounded-xl border border-edge p-3 text-xs"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${item.type === "deposit" ? "bg-win/10 text-win" : "bg-betclic-red/10 text-betclic-red"}`}>{item.type === "deposit" ? <ArrowDownLeft size={16}/> : <ArrowUpRight size={16}/>}</span><button onClick={() => setDetail(item)} className="min-w-0 flex-1 text-left"><span className="block font-medium">{item.type === "deposit" ? "Dépôt" : "Retrait"} · {eur(item.amount)} <span className="rounded-full bg-elev px-1.5 py-0.5 text-[10px] text-mist">{statusLabel(item.status)}</span></span>{item.type === "withdrawal" && <span className="mt-1 block text-mist">{item.code ? `••••-••••-••••-••••-${normalizeTransferCode(item.code).slice(-4)}` : "Code non disponible"}</span>}<span className="mt-1 block text-mist">{new Date(item.created_at).toLocaleString("fr-FR")}</span></button>{item.type === "withdrawal" && item.code && <button aria-label="Copier le code" onClick={() => void navigator.clipboard.writeText(item.code!).then(() => setCopiedId(item.id)).catch(() => setError("Copie impossible."))} className="rounded-full bg-gray-100 p-2 text-gray-600">{copiedId === item.id ? <Check size={16} /> : <Copy size={16} />}</button>}<ChevronRight size={16} className="text-mist" /></div>) : <p className="py-4 text-center text-xs text-gray-600">{busy ? "Chargement…" : "Aucun code."}</p>}{cursor && <button disabled={busy} className="w-full rounded-xl border p-3 text-xs" onClick={() => { setBusy(true); void load(cursor).catch(e => setError(e instanceof Error ? e.message : "Service indisponible.")).finally(() => setBusy(false)); }}>Charger plus</button>}</>}</div>}

    </motion.div></div>}</AnimatePresence>;
}

function statusLabel(status: string) { return status === "new" ? "Neuf" : status === "used" ? "Utilisé" : status === "cancelled" ? "Annulé" : status; }
