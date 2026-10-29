import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Activity, BellRing, Clock3, CreditCard, Wallet, CircleAlert } from "lucide-react-native";
import { requestJson } from "@/lib/http";
import { COLORS } from "@/theme/tokens";
const metrics = [
  {key:"deposits_review",label:"Dépôts à vérifier",icon:CreditCard}, {key:"deposits_stale",label:"Dépôts en attente > 24 h",icon:Clock3},
  {key:"deposits_failed",label:"Dépôts en échec · 7 j",icon:CircleAlert}, {key:"withdrawals_stale",label:"Retraits en attente > 24 h",icon:Wallet},
  {key:"push_failed",label:"Notifications en échec",icon:BellRing}, {key:"unsettled_bets",label:"Paris à régler",icon:Activity},
];
export function AdminMonitoring() {
  const [data,setData]=useState<Record<string,number>|null>(null); const [error,setError]=useState(false);
  useEffect(()=>{let active=true;const load=async()=>{try{const r=await requestJson<{monitoring:Record<string,number>}>("/api/admin/monitoring",{forceRefresh:true});if(active){setData(r.monitoring);setError(false);}}catch{if(active)setError(true);}};void load();const timer=setInterval(()=>void load(),30000);return()=>{active=false;clearInterval(timer);};},[]);
  return <View style={{backgroundColor:"white",borderWidth:1,borderColor:COLORS.edge,borderRadius:16,overflow:"hidden"}}>
    <View style={{padding:12,flexDirection:"row",alignItems:"center",gap:10,borderBottomWidth:1,borderColor:COLORS.edge}}><View style={{width:38,height:38,borderRadius:12,backgroundColor:"#fff0f1",alignItems:"center",justifyContent:"center"}}><Activity size={18} color={COLORS.betclicRed}/></View><View style={{flex:1}}><Text style={{color:COLORS.ink,fontSize:12,fontWeight:"700"}}>Surveillance de la plateforme</Text><Text style={{color:COLORS.mist,fontSize:10,marginTop:2}}>Paiements, paris et notifications · toutes les 30 s</Text></View><Text style={{color:COLORS.mist,fontSize:9}}>Direct</Text></View>
    {error?<Text style={{color:COLORS.betclicRed,fontSize:11,padding:10}}>Actualisation impossible. Les dernières valeurs peuvent être anciennes.</Text>:null}
    {!data&&!error?<Text style={{color:COLORS.mist,fontSize:11,padding:10}}>Chargement…</Text>:null}
    {data?<View style={{padding:10,flexDirection:"row",flexWrap:"wrap",gap:8}}>{metrics.map(({key,label,icon:Icon})=>{const n=Number(data[key]??0);return <View key={key} style={{width:"48%",flexGrow:1,backgroundColor:COLORS.elev,borderRadius:12,padding:10}}><View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center"}}><Icon size={15} color={n?COLORS.betclicRed:COLORS.mist}/><Text style={{color:n?COLORS.betclicRed:COLORS.ink,fontSize:17}}>{n}</Text></View><Text style={{color:COLORS.mist,fontSize:10,marginTop:7}}>{label}</Text></View>;})}</View>:null}
  </View>;
}
