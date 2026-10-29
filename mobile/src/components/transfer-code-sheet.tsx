import React, { useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { X } from "lucide-react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import Svg, { Rect } from "react-native-svg";
import QRCode from "qrcode";
import { useApp } from "@/context/app-context";
import { localToEur } from "@/lib/countries";
import { eur } from "@/lib/format";
import { requestJson, createIdempotencyKey } from "@/lib/http";
import { formatTransferCode, isValidTransferCode, normalizeTransferCode } from "@/lib/transfer-code";

type Tab = "deposit" | "withdraw" | "history";
type Entry = { id: string; amount: number; status: string; created_at: string; type: "deposit" | "withdrawal" };
type Result = { balance?: number; amount?: number; code?: string | null; transfers?: Entry[]; nextCursor?: string | null };
function CodeQr({ value }: { value: string }) {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" }); const size = qr.modules.size;
  return <Svg width={160} height={160} viewBox={`0 0 ${size + 8} ${size + 8}`} style={{ alignSelf: "center", backgroundColor: "white" }}><Rect width={size + 8} height={size + 8} fill="white" />{Array.from(qr.modules.data, (dark, i) => dark ? <Rect key={i} x={i % size + 4} y={Math.floor(i / size) + 4} width={1} height={1} fill="black" /> : null)}</Svg>;
}

export function TransferCodeSheet({ open, onClose, withdrawable }: { open: boolean; onClose: () => void; withdrawable: string }) {
  const { currency, setBalance } = useApp();
  const [tab, setTab] = useState<Tab>("deposit");
  const [code, setCode] = useState(""); const [amount, setAmount] = useState(""); const [created, setCreated] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [filter, setFilter] = useState("all"); const [detail, setDetail] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [scanning, setScanning] = useState(false);
  const [confirmation, setConfirmation] = useState<"close" | "cancel" | Tab | null>(null);
  const createSlot = useRef<{ amount: number; key: string } | null>(null); const redeemSlot = useRef<{ code: string; key: string } | null>(null);
  const closeRef = useRef<() => void>(() => {});
  closeRef.current = () => { if (busy) return; if (created) setConfirmation("close"); else onClose(); };
  const pan = useRef(PanResponder.create({ onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx), onPanResponderRelease: (_, g) => { if (g.dy > 70 || g.vy > 0.9) closeRef.current(); } })).current;
  const request = (body?: object, next?: string) => requestJson<Result>(next ? `/api/transfer-codes?before=${encodeURIComponent(next)}` : "/api/transfer-codes", body ? { method: "POST", body } : { bypassEtag: true });
  const load = async (next?: string) => { const r = await request(undefined, next); setEntries(previous => next ? [...previous, ...(r.transfers ?? [])] : r.transfers ?? []); setCursor(r.nextCursor ?? null); };
  const changeTab = (next: Tab, confirmed = false) => {
    if (busy) return;
    const change = () => { setCreated(""); setError(""); setMessage(""); setDetail(null); setScanning(false); setTab(next); if (next === "history") { setBusy(true); void load().catch(e => setError(e instanceof Error ? e.message : "Service indisponible.")).finally(() => setBusy(false)); } };
    if (created && !confirmed) setConfirmation(next); else change();
  };
  const perform = async (action: "create" | "redeem" | "cancel", id?: string) => {
    if (busy) return; setBusy(true); setError(""); setMessage("");
    try {
      let body: object;
      if (action === "create") { const num = Number(amount.replace(",", ".")); if (!Number.isFinite(num) || num <= 0) throw new Error("Montant invalide."); const pivot = localToEur(num, currency); if (!createSlot.current || createSlot.current.amount !== pivot) createSlot.current = { amount: pivot, key: createIdempotencyKey("transfer") }; body = { action, amount: pivot, key: createSlot.current.key }; }
      else if (action === "redeem") { if (!isValidTransferCode(code)) throw new Error("Vérifiez le code saisi."); if (!redeemSlot.current || redeemSlot.current.code !== code) redeemSlot.current = { code, key: createIdempotencyKey("transfer") }; body = { action, code, key: redeemSlot.current.key }; }
      else body = { action, id };
      const r = await request(body); if (typeof r.balance === "number") setBalance(r.balance);
      if (action === "create") { if (r.code) setCreated(r.code); else setMessage("Code déjà créé et non réaffichable. Retrouvez-le dans l’historique pour l’annuler si nécessaire."); createSlot.current = null; }
      else if (action === "redeem") { setMessage(`Dépôt réussi : ${eur(r.amount ?? 0)}. Nouveau solde : ${eur(r.balance ?? 0)}.`); setCode(""); redeemSlot.current = null; }
      else { setMessage("Code annulé et solde remboursé."); setDetail(null); await load(); }
    } catch (e) { setError(e instanceof Error ? e.message : "Impossible de terminer l’opération."); } finally { setBusy(false); }
  };
  const copy = async () => { try { if (!requireOptionalNativeModule("ExpoClipboard")) throw new Error(); const clipboard = require("expo-clipboard") as typeof import("expo-clipboard"); if (!await clipboard.setStringAsync(created)) throw new Error(); setMessage("Code copié."); } catch { setError("Maintenez le code pour le sélectionner et le copier."); } };
  const scan = async () => { try { if (!requireOptionalNativeModule("ExpoCamera")) throw new Error("Caméra indisponible dans cette version. Collez le code."); const camera = require("expo-camera") as typeof import("expo-camera"); const permission = await camera.Camera.requestCameraPermissionsAsync(); if (!permission.granted) throw new Error("Autorisez la caméra ou collez le code."); setScanning(true); } catch (e) { setError(e instanceof Error ? e.message : "Caméra indisponible."); } };
  let Camera: typeof import("expo-camera").CameraView | null = null;
  if (scanning && requireOptionalNativeModule("ExpoCamera")) Camera = (require("expo-camera") as typeof import("expo-camera")).CameraView;
  const visible = entries.filter(item => filter === "all" || item.type === filter || item.status === filter);
  const statuses: Record<string, string> = { new: "Neuf", used: "Utilisé", cancelled: "Annulé" };
  const button = (label: string, press: () => void, disabled = false) => <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={press} style={[s.button, (busy || disabled) && s.disabled]}><Text style={s.buttonText}>{busy ? "Chargement…" : label}</Text></Pressable>;
  return <Modal visible={open} transparent animationType="slide" onRequestClose={() => closeRef.current()} statusBarTranslucent>
    <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}><Pressable style={s.backdrop} onPress={() => closeRef.current()} accessibilityLabel="Fermer" /><View style={s.sheet}>
      <View {...pan.panHandlers} style={s.handleArea}><View style={s.handle} /></View><View style={s.header}><Text style={s.title}>Codes de transfert</Text><Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => closeRef.current()} style={s.close}><X size={18} color="#20242a" /></Pressable></View>
      <View style={s.tabs}>{([['deposit','Déposer'],['withdraw','Retirer'],['history','Historique']] as const).map(([id,label]) => <Pressable key={id} onPress={() => changeTab(id)} style={[s.tab, tab === id && s.activeTab]}><Text style={[s.tabText, tab === id && s.activeText]}>{label}</Text></Pressable>)}</View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>{confirmation ? <View style={s.confirm}><Text style={s.description}>{confirmation === "cancel" ? "Annuler ce code et récupérer le montant ?" : "Ce code ne sera plus affiché. L’avez-vous copié ?"}</Text><View style={s.filterRow}><Pressable onPress={() => setConfirmation(null)} style={s.filter}><Text style={s.tabText}>Retour</Text></Pressable><Pressable onPress={() => { const next = confirmation; setConfirmation(null); if (next === "close") onClose(); else if (next === "cancel") void perform("cancel", detail?.id); else changeTab(next, true); }} style={s.filter}><Text style={s.activeText}>Confirmer</Text></Pressable></View></View> : null}{error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}{message ? <Text style={s.success}>{message}</Text> : null}
        {tab === "deposit" && <><Text style={s.heading}>Déposer avec un code</Text><Text style={s.description}>Saisissez ou collez le code reçu d’un autre utilisateur.</Text><TextInput accessibilityLabel="Code de transfert" keyboardType="number-pad" value={formatTransferCode(code)} onChangeText={value => setCode(normalizeTransferCode(value))} placeholder="0000-0000-0000-0000-0000" style={s.input} />{code.length === 20 && !isValidTransferCode(code) ? <Text style={s.error}>Vérifiez le code saisi.</Text> : null}{Camera ? <><Camera style={{ height: 220 }} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={({ data }) => { setScanning(false); if (!isValidTransferCode(data)) setError("QR invalide."); else { setCode(normalizeTransferCode(data)); setError(""); } }} /><Pressable onPress={() => setScanning(false)}><Text style={s.link}>Fermer la caméra</Text></Pressable></> : <Pressable onPress={() => void scan()}><Text style={s.link}>Scanner un QR</Text></Pressable>}{button("Valider le code", () => void perform("redeem"), !isValidTransferCode(code))}</>}
        {tab === "withdraw" && <><Text style={s.heading}>Retirer avec un code</Text>{created ? <><Text style={s.description}>Ce code ne sera affiché qu’une fois. Copiez-le avant de fermer.</Text><CodeQr value={created} /><Text selectable style={s.code}>{formatTransferCode(created)}</Text>{button("Copier le code", () => void copy())}</> : <><Text style={s.description}>Le montant est réservé sur votre solde. Transmettez le code au destinataire.</Text><Text style={s.description}>Solde transférable : {withdrawable}</Text><TextInput accessibilityLabel="Montant" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="Montant" style={s.input} /><Text style={s.description}>Sans expiration. En cas de réponse perdue, annulez depuis l’historique.</Text>{button("Générer le code", () => void perform("create"), !(Number(amount.replace(",", ".")) > 0))}</>}</>}
        {tab === "history" && <>{detail ? <><Pressable onPress={() => setDetail(null)}><Text style={s.link}>← Historique</Text></Pressable><Text style={s.description}>Type : {detail.type === "deposit" ? "Dépôt" : "Retrait"}</Text><Text style={s.description}>Montant : {eur(detail.amount)}</Text><Text style={s.description}>Statut : {statuses[detail.status] ?? detail.status}</Text><Text style={s.description}>Date : {new Date(detail.created_at).toLocaleString("fr-FR")}</Text>{detail.type === "withdrawal" && detail.status === "new" ? button("Annuler et rembourser", () => setConfirmation("cancel")) : null}</> : <><ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={s.filterRow}>{([['all','Tous'],['deposit','Dépôts'],['withdrawal','Retraits'],['new','Neufs'],['used','Utilisés'],['cancelled','Annulés']] as const).map(([id,label]) => <Pressable key={id} onPress={() => setFilter(id)} style={[s.filter, filter === id && s.activeTab]}><Text style={s.tabText}>{label}</Text></Pressable>)}</View></ScrollView>{visible.length ? visible.map(item => <Pressable key={item.id} onPress={() => setDetail(item)} style={s.entry}><Text style={s.description}>{item.type === "deposit" ? "Dépôt" : "Retrait"} · {statuses[item.status] ?? item.status}</Text><Text style={s.description}>{eur(item.amount)} ›</Text></Pressable>) : <Text style={s.description}>{busy ? "Chargement…" : "Aucun code."}</Text>}{cursor ? button("Charger plus", () => { setBusy(true); void load(cursor).catch(e => setError(e instanceof Error ? e.message : "Service indisponible.")).finally(() => setBusy(false)); }) : null}</>}</>}
      </ScrollView></View></KeyboardAvoidingView></Modal>;
}
const s = StyleSheet.create({
  confirm: { gap: 8, padding: 12, borderRadius: 12, backgroundColor: "#fffbeb" },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }, backdrop: { flex: 1 }, sheet: { maxHeight: "85%", backgroundColor: "white", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingBottom: 24 }, handleArea: { height: 24, alignItems: "center", justifyContent: "center" }, handle: { width: 40, height: 4, borderRadius: 4, backgroundColor: "#d1d5db" }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }, title: { fontSize: 16, fontWeight: "700", color: "#20242a" }, close: { backgroundColor: "#f3f4f6", padding: 8, borderRadius: 20 }, tabs: { flexDirection: "row", padding: 4, backgroundColor: "#f3f4f6", borderRadius: 12 }, tab: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: 8 }, activeTab: { backgroundColor: "white" }, tabText: { fontSize: 12, color: "#555" }, activeText: { color: "#d3182b" }, content: { gap: 12, paddingTop: 16 }, heading: { fontSize: 14, fontWeight: "700", color: "#20242a" }, description: { fontSize: 12, color: "#555", lineHeight: 18 }, input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 12, padding: 12, fontSize: 14, color: "#20242a" }, error: { fontSize: 12, color: "#dc2626" }, success: { fontSize: 12, color: "#15803d" }, link: { fontSize: 12, color: "#d3182b", textAlign: "center" }, code: { textAlign: "center", fontSize: 14, color: "#20242a", letterSpacing: 1 }, button: { borderRadius: 12, padding: 14, alignItems: "center", backgroundColor: "#d3182b" }, disabled: { backgroundColor: "#d1d5db" }, buttonText: { fontSize: 13, color: "white" }, filterRow: { flexDirection: "row", gap: 6, backgroundColor: "#f3f4f6", borderRadius: 10, padding: 4 }, filter: { padding: 8, borderRadius: 8 }, entry: { flexDirection: "row", justifyContent: "space-between", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 12 },
});
