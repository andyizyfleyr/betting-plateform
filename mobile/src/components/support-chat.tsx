import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ArrowLeft, MessageCircle, Send, X } from "lucide-react-native";
import { useApp } from "@/context/app-context";
import { generateIdempotencyKey, requestJson } from "@/lib/http";
import { loadNotifications } from "@/lib/push-notifications";
import { COLORS } from "@/theme/tokens";

type Message = { id: number; sender_role: string; body: string; created_at: string; read_at: string | null };
type Conversation = { id: number; name: string; online: boolean; last_seen_at: string | null; unread: number };
type Response = { conversations?: Conversation[]; messages?: Message[]; unread?: number; adminOnline?: boolean };
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
    const data = await requestJson<Response>(`/api/chat${qs}`, { forceRefresh: true });
    if (isAdmin && !view) { setRows(data.conversations ?? []); setUnread((data.conversations ?? []).reduce((n, c) => n + Number(c.unread), 0)); }
    else if (view) { setMessages(data.messages ?? []); setOnline(Boolean(data.adminOnline)); }
    else { setUnread(Number(data.unread ?? 0)); setOnline(Boolean(data.adminOnline)); }
  }, [open, isAdmin, selected]);
  useEffect(() => { let active = true; const tick = () => { void load().then(() => { if (active) setError(""); }).catch(() => { if (active && open) setError("Connexion à la messagerie impossible."); }); }; tick(); const timer = setInterval(tick, open ? 5000 : 20000); return () => { active = false; clearInterval(timer); }; }, [load, open]);
  useEffect(() => {
    const n = loadNotifications(); if (!n) return;
    const onResponse = (response: import("expo-notifications").NotificationResponse) => {
      const data = response.notification.request.content.data;
      if (data?.path !== "/chat") return;
      if (isAdmin && Number.isSafeInteger(data.conversationId)) setSelected(Number(data.conversationId));
      setOpen(true);
    };
    const sub = n.addNotificationResponseReceivedListener(onResponse);
    void n.getLastNotificationResponseAsync().then((r) => { if (r) onResponse(r); }).catch(() => {});
    return () => sub.remove();
  }, [isAdmin]);
  const send = async () => {
    if (!text.trim() || busy) return; setBusy(true); setError(""); clientId.current ||= generateIdempotencyKey("chat");
    try { await requestJson("/api/chat", { method: "POST", body: { body: text.trim(), conversationId: selected, clientId: clientId.current } }); clientId.current = null; setText(""); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Envoi impossible."); } finally { setBusy(false); }
  };
  const chatOpen = !isAdmin || selected !== null;
  return <>
    <Pressable accessibilityLabel="Ouvrir la messagerie" onPress={() => setOpen(true)} style={{ position: "absolute", right: 12, bottom: 76, zIndex: 90, width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.betclicRed, elevation: 6 }}><MessageCircle size={23} color="white" />{unread > 0 && <View style={{ position: "absolute", right: -2, top: -2, borderRadius: 12, backgroundColor: COLORS.ink, paddingHorizontal: 5 }}><Text style={{ color: "white", fontSize: 10 }}>{unread > 99 ? "99+" : unread}</Text></View>}</Pressable>
    <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, backgroundColor: "white", paddingTop: 35 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderBottomWidth: 1, borderColor: COLORS.edge }}>
          {isAdmin && selected !== null ? <Pressable onPress={() => setSelected(null)} accessibilityLabel="Retour"><ArrowLeft size={20} color={COLORS.ink} /></Pressable> : null}
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "#fff0f1", alignItems: "center", justifyContent: "center" }}><MessageCircle size={18} color={COLORS.betclicRed}/></View><View style={{ flex: 1 }}><Text style={{ color: COLORS.ink, fontSize: 12, fontWeight: "700" }}>{isAdmin && selected !== null ? rows.find(x => x.id === selected)?.name ?? "Discussion" : "Messagerie"}</Text>{!isAdmin ? <Text style={{ fontSize: 11, color: COLORS.mist }}>{online ? "Support en ligne" : "Support indisponible pour le moment"}</Text> : null}</View>
          <Pressable onPress={() => setOpen(false)} accessibilityLabel="Fermer"><X size={20} color={COLORS.ink} /></Pressable>
        </View>
        {error ? <Text style={{ padding: 8, color: COLORS.betclicRed, fontSize: 11 }}>{error}</Text> : null}
        {!chatOpen ? <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 10 }}>{rows.length === 0 ? <Text style={{ color: COLORS.mist, fontSize: 12 }}>Aucune discussion.</Text> : null}{rows.map(row => <Pressable key={row.id} onPress={() => { setMessages([]); setSelected(row.id); }} style={{ padding: 12, borderBottomWidth: 1, borderColor: COLORS.edge, flexDirection: "row", justifyContent: "space-between" }}><View><Text style={{ color: COLORS.ink, fontSize: 12 }}>{row.name}</Text><Text style={{ color: COLORS.mist, fontSize: 10 }}>{row.online ? "En ligne" : row.last_seen_at ? lastSeen(row.last_seen_at) : "Hors ligne"}</Text></View>{Number(row.unread) > 0 ? <Text style={{ color: COLORS.betclicRed }}>{row.unread}</Text> : null}</Pressable>)}</ScrollView> : <><ScrollView style={{ flex: 1, backgroundColor: "#f7f8fa" }} contentContainerStyle={{ padding: 12, gap: 8, flexGrow: 1 }}>{messages.length === 0 ? <View style={{ alignItems: "center", marginTop: 60, gap: 8 }}><View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: "white", alignItems: "center", justifyContent: "center" }}><MessageCircle size={21} color={COLORS.betclicRed}/></View><Text style={{ color: COLORS.ink, fontSize: 11 }}>Une question ? Écrivez-nous.</Text><Text style={{ color: COLORS.mist, fontSize: 10 }}>Votre discussion avec le support est privée.</Text></View> : null}{messages.map(m => { const mine = m.sender_role === (isAdmin ? "admin" : "user"); return <View key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%", padding: 10, borderRadius: 12, backgroundColor: mine ? COLORS.ink : "white" }}><Text style={{ color: mine ? "white" : COLORS.ink, fontSize: 12 }}>{m.body}</Text><Text style={{ color: mine ? "#ddd" : COLORS.mist, fontSize: 9, marginTop: 4 }}>{time(m.created_at)}{mine ? m.read_at ? " · Lu" : " · Envoyé" : ""}</Text></View>; })}</ScrollView><View style={{ flexDirection: "row", padding: 10, gap: 8, borderTopWidth: 1, borderColor: COLORS.edge }}><TextInput value={text} onChangeText={v => { setText(v); clientId.current = null; }} maxLength={2000} placeholder="Votre message…" placeholderTextColor={COLORS.mist} style={{ flex: 1, color: COLORS.ink, backgroundColor: COLORS.elev, borderRadius: 12, paddingHorizontal: 12, fontSize: 12 }} /><Pressable accessibilityLabel="Envoyer" disabled={busy || !text.trim()} onPress={() => void send()} style={{ padding: 10, backgroundColor: COLORS.betclicRed, borderRadius: 12, opacity: busy ? .5 : 1 }}>{busy ? <ActivityIndicator size="small" color="white" /> : <Send size={19} color="white" />}</Pressable></View></>}
      </View>
    </Modal>
  </>;
}
