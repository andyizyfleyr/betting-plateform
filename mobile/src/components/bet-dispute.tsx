import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { requestJson } from "@/lib/http";
import { COLORS } from "@/theme/tokens";

type Dispute = { id: number; betKind: string; betId: number; message: string; status: string; adminReply: string | null };
export function BetDispute({ betKind, betId }: { betKind: "sport" | "prediction" | "combo"; betId: number }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<Dispute[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const r = await requestJson<{ disputes: Dispute[] }>("/api/disputes", { forceRefresh: true });
    setItems(r.disputes.filter((d) => d.betKind === betKind && d.betId === betId));
  }, [betKind, betId]);
  useEffect(() => { if (open) void load().catch(() => setError("Impossible de charger vos réclamations.")); }, [open, load]);
  const submit = async () => {
    if (message.trim().length < 10 || busy) return;
    setBusy(true); setError("");
    try {
      await requestJson("/api/disputes", { method: "POST", body: { betId, betKind, message: message.trim() } });
      setMessage(""); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Envoi impossible."); }
    finally { setBusy(false); }
  };
  return <View style={{ marginVertical: 12, padding: 12, borderRadius: 12, backgroundColor: "white", borderWidth: 1, borderColor: COLORS.edge }}>
    <Pressable onPress={() => setOpen((v) => !v)}><Text style={{ color: COLORS.ink, fontSize: 12 }}>Signaler un problème sur ce pari {open ? "−" : "+"}</Text></Pressable>
    {open && <View style={{ gap: 8, marginTop: 10 }}>
      {items.map((d) => <View key={d.id} style={{ padding: 8, backgroundColor: COLORS.elev, borderRadius: 8 }}>
        <Text style={{ color: COLORS.ink, fontSize: 11 }}>Réclamation #{d.id} · {d.status === "resolved" ? "Résolue" : d.status === "in_review" ? "En cours" : "Ouverte"}</Text>
        <Text style={{ color: COLORS.mist, fontSize: 11 }}>{d.message}</Text>
        {d.adminReply ? <Text style={{ color: COLORS.ink, fontSize: 11 }}>Réponse : {d.adminReply}</Text> : null}
      </View>)}
      <TextInput value={message} onChangeText={setMessage} multiline maxLength={2000} placeholder="Décrivez le problème (10 caractères minimum)" placeholderTextColor={COLORS.mist} style={{ minHeight: 70, borderWidth: 1, borderColor: COLORS.edge, borderRadius: 8, padding: 8, color: COLORS.ink, textAlignVertical: "top" }} />
      {error ? <Text style={{ color: COLORS.betclicRed, fontSize: 11 }}>{error}</Text> : null}
      <Pressable onPress={() => void submit()} disabled={busy || message.trim().length < 10} style={{ backgroundColor: COLORS.betclicRed, padding: 10, borderRadius: 8, opacity: busy || message.trim().length < 10 ? 0.5 : 1 }}>
        {busy ? <ActivityIndicator color="white" /> : <Text style={{ color: "white", textAlign: "center" }}>Envoyer la réclamation</Text>}
      </Pressable>
    </View>}
  </View>;
}
