import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { MessageSquareWarning, ChevronDown, Send } from "lucide-react-native";
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
  return <View style={{marginVertical:12,borderRadius:16,backgroundColor:"white",borderWidth:1,borderColor:COLORS.edge,overflow:"hidden"}}>
    <Pressable accessibilityRole="button" accessibilityState={{expanded:open}} onPress={()=>setOpen(v=>!v)} style={{flexDirection:"row",alignItems:"center",gap:10,padding:12}}><View style={{width:36,height:36,borderRadius:12,backgroundColor:COLORS.redSoft,alignItems:"center",justifyContent:"center"}}><MessageSquareWarning size={17} color={COLORS.betclicRed}/></View><View style={{flex:1}}><Text style={{color:COLORS.ink,fontSize:12,fontWeight:"700"}}>Besoin d’aide ?</Text><Text style={{color:COLORS.mist,fontSize:10,marginTop:2}}>Signaler un problème sur ce pari</Text></View><ChevronDown size={16} color={COLORS.mist} style={{transform:[{rotate:open?"180deg":"0deg"}]}}/></Pressable>
    {open && <View style={{gap:8,padding:12,borderTopWidth:1,borderColor:COLORS.edge}}>{items.map(d=><View key={d.id} style={{borderRadius:12,borderWidth:1,borderColor:COLORS.edge,backgroundColor:"#fafbfc",padding:10,gap:8}}><View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8}}><Text style={{color:COLORS.ink,fontSize:11}}>Réclamation #{d.id}</Text><View style={{borderRadius:20,paddingHorizontal:8,paddingVertical:4,backgroundColor:d.status==='resolved'?COLORS.winSoft:d.status==='in_review'?COLORS.amberSoft:COLORS.redSoft}}><Text style={{color:d.status==='resolved'?COLORS.win:d.status==='in_review'?COLORS.amber:COLORS.betclicRed,fontSize:9}}>{d.status==='resolved'?'Résolue':d.status==='in_review'?'En cours':'Ouverte'}</Text></View></View><Text style={{color:COLORS.mist,fontSize:11}}>{d.message}</Text>{d.adminReply?<View style={{backgroundColor:"white",borderRadius:8,padding:10,gap:4}}><Text style={{color:COLORS.mist,fontSize:10}}>Réponse du support</Text><Text style={{color:COLORS.ink,fontSize:11}}>{d.adminReply}</Text></View>:null}</View>)}
      <Text style={{color:COLORS.mist,fontSize:10}}>Votre message</Text><TextInput value={message} onChangeText={setMessage} multiline maxLength={2000} placeholder="Décrivez le problème (10 caractères minimum)" placeholderTextColor={COLORS.mist} style={{minHeight:80,borderWidth:1,borderColor:COLORS.edge,borderRadius:12,padding:10,color:COLORS.ink,backgroundColor:COLORS.elev,fontSize:11,textAlignVertical:"top"}}/>
      {error?<Text style={{color:COLORS.betclicRed,fontSize:11}}>{error}</Text>:null}<Pressable onPress={()=>void submit()} disabled={busy||message.trim().length<10} style={{backgroundColor:COLORS.betclicRed,padding:10,borderRadius:12,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:8,opacity:busy||message.trim().length<10?0.5:1}}>{busy?<ActivityIndicator size="small" color="white"/>:<Send size={14} color="white"/>}<Text style={{color:"white",fontSize:11}}>{busy?"Envoi…":"Envoyer la réclamation"}</Text></Pressable>
    </View>}
  </View>;
}
