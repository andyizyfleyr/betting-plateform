import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { MessageSquareText, RefreshCw, CheckCircle2 } from "lucide-react-native";
import { requestJson } from "@/lib/http";
import { COLORS } from "@/theme/tokens";

type Row = { userName: string; dispute: { id: number; betId: number; betKind: string; status: string; message: string; adminReply: string | null } };
export function AdminDisputes() {
  const [rows, setRows] = useState<Row[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const data = await requestJson<{ disputes: Row[] }>("/api/admin/disputes", { forceRefresh: true });
    setRows(data.disputes);
    setLoaded(true);
  }, []);
  useEffect(() => { void load().catch(() => setError("Chargement des réclamations impossible.")); }, [load]);
  const update = async (id: number, status: "in_review" | "resolved") => {
    if (busy !== null) return;
    setBusy(id); setError("");
    try {
      await requestJson("/api/admin/disputes", { method: "PATCH", body: { id, status, reply: drafts[id] ?? rows.find((r) => r.dispute.id === id)?.dispute.adminReply ?? "" } });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible."); }
    finally { setBusy(null); }
  };
  return <View style={{ backgroundColor:"white", borderWidth:1, borderColor:COLORS.edge, borderRadius:16, overflow:"hidden" }}>
    <View style={{flexDirection:"row",alignItems:"center",gap:10,padding:12,borderBottomWidth:1,borderColor:COLORS.edge}}><View style={{width:40,height:40,borderRadius:12,backgroundColor:COLORS.redSoft,alignItems:"center",justifyContent:"center"}}><MessageSquareText size={18} color={COLORS.betclicRed}/></View><View style={{flex:1}}><Text style={{color:COLORS.ink,fontSize:12,fontWeight:"700"}}>Réclamations</Text><Text style={{color:COLORS.mist,fontSize:10,marginTop:2}}>Consultez et répondez aux demandes des joueurs</Text></View><Pressable accessibilityLabel="Actualiser les réclamations" onPress={() => void load().catch(() => setError("Actualisation impossible."))} style={{width:36,height:36,alignItems:"center",justifyContent:"center",borderRadius:12,backgroundColor:COLORS.elev}}><RefreshCw size={15} color={COLORS.mist}/></Pressable></View>
    {error ? <Text style={{color:COLORS.betclicRed,fontSize:11,margin:12}}>{error}</Text> : null}
    {!loaded&&!error ? <Text style={{color:COLORS.mist,fontSize:11,margin:12}}>Chargement…</Text> : null}
    {loaded&&rows.length===0 ? <View style={{flexDirection:"row",alignItems:"center",gap:10,padding:14}}><CheckCircle2 size={18} color={COLORS.win}/><Text style={{color:COLORS.mist,fontSize:11}}>Aucune réclamation pour le moment.</Text></View> : null}
    <View style={{padding:12,gap:8}}>{rows.map(({userName,dispute:d})=><View key={d.id} style={{borderWidth:1,borderColor:COLORS.edge,backgroundColor:"#fafbfc",borderRadius:12,padding:10,gap:8}}>
      <View style={{flexDirection:"row",alignItems:"flex-start",justifyContent:"space-between",gap:8}}><View style={{flex:1}}><Text style={{color:COLORS.ink,fontSize:11}}>{userName}</Text><Text style={{color:COLORS.mist,fontSize:10,marginTop:2}}>Réclamation #{d.id} · {d.betKind==="combo"?"Combiné":d.betKind==="prediction"?"Pronostic":"Pari sportif"} #{d.betId}</Text></View><View style={{borderRadius:20,paddingHorizontal:8,paddingVertical:4,backgroundColor:d.status==="resolved"?COLORS.winSoft:d.status==="in_review"?COLORS.amberSoft:COLORS.redSoft}}><Text style={{color:d.status==="resolved"?COLORS.win:d.status==="in_review"?COLORS.amber:COLORS.betclicRed,fontSize:9}}>{d.status==="resolved"?"Résolue":d.status==="in_review"?"En cours":"Ouverte"}</Text></View></View>
      <Text style={{color:COLORS.mist,fontSize:11,backgroundColor:"white",borderRadius:8,padding:10}}>{d.message}</Text><Text style={{color:COLORS.mist,fontSize:10}}>Votre réponse</Text>
      <TextInput placeholder="Rédiger une réponse…" placeholderTextColor={COLORS.mist} value={drafts[d.id] ?? d.adminReply ?? ""} onChangeText={(text)=>setDrafts(v=>({...v,[d.id]:text}))} maxLength={2000} multiline style={{minHeight:60,borderWidth:1,borderColor:COLORS.edge,borderRadius:8,padding:9,color:COLORS.ink,backgroundColor:"white",fontSize:11,textAlignVertical:"top"}}/>
      <View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}><Pressable disabled={busy!==null} onPress={()=>void update(d.id,"in_review")} style={{borderWidth:1,borderColor:COLORS.edge,backgroundColor:"white",borderRadius:8,paddingVertical:8,paddingHorizontal:12,opacity:busy!==null?0.5:1}}><Text style={{color:COLORS.mist,fontSize:11}}>Mettre en cours</Text></Pressable><Pressable disabled={busy!==null} onPress={()=>void update(d.id,"resolved")} style={{backgroundColor:COLORS.ink,borderRadius:8,paddingVertical:8,paddingHorizontal:12,opacity:busy!==null?0.5:1}}><Text style={{color:"white",fontSize:11}}>Répondre et clôturer</Text></Pressable></View>
    </View>)}</View>
  </View>;
}
