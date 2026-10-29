import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { requestJson } from "@/lib/http";
import { COLORS } from "@/theme/tokens";

type Row = { userName: string; dispute: { id: number; betId: number; betKind: string; status: string; message: string; adminReply: string | null } };
export function AdminDisputes() {
  const [rows, setRows] = useState<Row[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(async () => {
    const data = await requestJson<{ disputes: Row[] }>("/api/admin/disputes", { forceRefresh: true });
    setRows(data.disputes);
  }, []);
  useEffect(() => { void load().catch(() => setError("Chargement des réclamations impossible.")); }, [load]);
  const update = async (id: number, status: "in_review" | "resolved") => {
    if (busy !== null) return;
    setBusy(id); setError("");
    try {
      await requestJson("/api/admin/disputes", { method: "PATCH", body: { id, status, reply: drafts[id] ?? "" } });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible."); }
    finally { setBusy(null); }
  };
  return <View style={{ backgroundColor: "white", borderWidth: 1, borderColor: COLORS.edge, borderRadius: 16, padding: 12, gap: 8 }}>
    <Text style={{ color: COLORS.ink, fontSize: 12, fontWeight: "700" }}>Réclamations</Text>
    <Pressable onPress={() => void load().catch(() => setError("Actualisation impossible."))}><Text style={{ color: COLORS.betclicRed, fontSize: 11 }}>Actualiser</Text></Pressable>
    {error ? <Text style={{ color: COLORS.betclicRed, fontSize: 11 }}>{error}</Text> : null}
    {rows.length === 0 ? <Text style={{ color: COLORS.mist, fontSize: 11 }}>Aucune réclamation.</Text> : null}
    {rows.map(({ userName, dispute: d }) => <View key={d.id} style={{ borderTopWidth: 1, borderColor: COLORS.edge, paddingTop: 8, gap: 5 }}>
      <Text style={{ color: COLORS.ink, fontSize: 11 }}>#{d.id} · {userName} · {d.betKind} #{d.betId} · {d.status}</Text>
      <Text style={{ color: COLORS.mist, fontSize: 11 }}>{d.message}</Text>
      <TextInput placeholder="Réponse à la réclamation" placeholderTextColor={COLORS.mist} value={drafts[d.id] ?? d.adminReply ?? ""} onChangeText={(text) => setDrafts((v) => ({ ...v, [d.id]: text }))} maxLength={2000} multiline style={{ borderWidth: 1, borderColor: COLORS.edge, borderRadius: 8, padding: 8, color: COLORS.ink }} />
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Pressable disabled={busy !== null} onPress={() => void update(d.id, "in_review")}><Text style={{ color: COLORS.ink, fontSize: 11 }}>En cours</Text></Pressable>
        <Pressable disabled={busy !== null} onPress={() => void update(d.id, "resolved")}><Text style={{ color: COLORS.betclicRed, fontSize: 11 }}>Répondre et clôturer</Text></Pressable>
      </View>
    </View>)}
  </View>;
}
