import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { requestJson } from "@/lib/http";
import { COLORS } from "@/theme/tokens";
const labels: Record<string, string> = {
  deposits_review: "Dépôts à vérifier", deposits_stale: "Dépôts en attente depuis plus de 24 h",
  deposits_failed: "Dépôts échoués, expirés ou refusés (7 jours)", withdrawals_stale: "Retraits en attente depuis plus de 24 h",
  push_failed: "Notifications en échec après 5 tentatives", unsettled_bets: "Paris simples en attente sur matchs terminés",
};
export function AdminMonitoring() {
  const [data, setData] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => { try { const result = await requestJson<{ monitoring: Record<string, number> }>("/api/admin/monitoring", { forceRefresh: true }); if (active) { setData(result.monitoring); setError(false); } } catch { if (active) setError(true); } };
    void load(); const timer = setInterval(() => void load(), 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <View style={{ backgroundColor: "white", borderWidth: 1, borderColor: COLORS.edge, borderRadius: 16, padding: 12, gap: 5 }}><Text style={{ color: COLORS.ink, fontSize: 12, fontWeight: "700" }}>Surveillance de la plateforme</Text><Text style={{ color: COLORS.mist, fontSize: 11 }}>Actualisation toutes les 30 secondes. Vérifiez les rubriques de gestion.</Text>{error ? <Text style={{ color: COLORS.betclicRed, fontSize: 11 }}>Actualisation impossible.</Text> : null}{!data && !error ? <Text>Chargement…</Text> : null}{data ? Object.entries(labels).map(([key,label]) => <Text key={key} style={{ color: COLORS.ink, fontSize: 11 }}>{label} : {data[key] ?? 0}</Text>) : null}</View>;
}
