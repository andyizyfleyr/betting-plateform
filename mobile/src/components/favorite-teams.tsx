import React from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, ChevronRight } from "lucide-react-native";
import { TeamAvatar } from "@/components/team-avatar";
import { formatKickoff } from "@/lib/format";
import { useApp } from "@/context/app-context";
import type { ClientMatch } from "@/lib/api";
import { requestJson } from "@/lib/http";
import { useRouter } from "@/lib/router";
import { COLORS } from "@/theme/tokens";

type Favorite = { teamKey: string; teamName: string };
function useFavorites() {
  const { user } = useApp();
  return useQuery({ queryKey: ["favorite-teams", user?.id], enabled: Boolean(user),
    queryFn: () => requestJson<{ teams: Favorite[] }>("/api/favorites", { forceRefresh: true }), staleTime: 30_000 });
}
export function FavoriteTeamButton({ teamName }: { teamName: string }) {
  const { user, toast } = useApp();
  const router = useRouter();
  const client = useQueryClient();
  const query = useFavorites();
  const following = Boolean(query.data?.teams.some((t) => t.teamKey === teamName.normalize("NFKC").toLocaleLowerCase("fr")));
  const [busy, setBusy] = React.useState(false);
  const toggle = async () => {
    if (!user) { router.push("/auth/connexion"); return; }
    if (busy) return;
    setBusy(true);
    try {
      await requestJson("/api/favorites", { method: "POST", body: { teamName, following: !following } });
      await client.invalidateQueries({ queryKey: ["favorite-teams", user.id] });
    } catch (e) { toast({ kind: "error", title: "Favoris", description: e instanceof Error ? e.message : "Action impossible" }); }
    finally { setBusy(false); }
  };
  return <Pressable accessibilityRole="button" accessibilityLabel={`${following ? "Ne plus suivre" : "Suivre"} ${teamName}`} onPress={() => void toggle()} disabled={busy} style={{ padding: 6 }}>
    <Star size={17} color={following ? "#d99a00" : COLORS.mist} fill={following ? "#d99a00" : "transparent"} />
  </Pressable>;
}
export function FavoriteMatches({ matches }: { matches: ClientMatch[] }) {
  const router = useRouter();
  const query = useFavorites();
  const names = new Set((query.data?.teams ?? []).map((t) => t.teamName));
  if (!names.size) return null;
  const upcoming = matches.filter((m) => m.status !== "finished" && (names.has(m.homeTeam) || names.has(m.awayTeam)))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()).slice(0, 5);
  return <View style={{marginHorizontal:8,marginVertical:8,borderRadius:16,backgroundColor:"white",borderWidth:1,borderColor:COLORS.edge,overflow:"hidden"}}>
    <View style={{flexDirection:"row",alignItems:"center",gap:10,padding:12,borderBottomWidth:1,borderColor:COLORS.edge}}><View style={{width:36,height:36,borderRadius:12,backgroundColor:COLORS.amberSoft,alignItems:"center",justifyContent:"center"}}><Star size={17} color={COLORS.amber} fill={COLORS.amber}/></View><View style={{flex:1}}><Text style={{color:COLORS.ink,fontSize:12,fontWeight:"700"}}>Mes équipes favorites</Text><Text style={{color:COLORS.mist,fontSize:10,marginTop:2}}>{names.size} équipe{names.size>1?"s suivies":" suivie"}</Text></View></View>
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:6,paddingHorizontal:12,paddingTop:12}}>{[...names].map(name=><View key={name} style={{maxWidth:"100%",borderRadius:20,backgroundColor:COLORS.elev,paddingHorizontal:10,paddingVertical:5}}><Text numberOfLines={1} style={{fontSize:10,color:COLORS.mist}}>{name}</Text></View>)}</View>
    <View style={{paddingHorizontal:12,paddingBottom:12,paddingTop:8}}><Text style={{fontSize:10,color:COLORS.mist,marginBottom:4}}>Matchs à suivre</Text>{upcoming.length?upcoming.map((m,idx)=><Pressable key={m.id} onPress={()=>router.push(`/matchs/${m.id}`)} style={{flexDirection:"row",alignItems:"center",gap:8,paddingVertical:10,borderTopWidth:idx?1:0,borderColor:COLORS.edge}}><View style={{flexDirection:"row",alignItems:"center"}}><TeamAvatar name={m.homeTeam} logo={m.homeLogo} size="xs"/><View style={{marginLeft:-4}}><TeamAvatar name={m.awayTeam} logo={m.awayLogo} size="xs"/></View></View><View style={{flex:1}}><Text numberOfLines={1} style={{fontSize:11,color:COLORS.ink}}>{m.homeTeam} – {m.awayTeam}</Text><Text style={{fontSize:10,marginTop:2,color:m.status==='live'?COLORS.betclicRed:COLORS.mist}}>{m.status==='live'?"En direct":formatKickoff(m.startsAt)}</Text></View><ChevronRight size={15} color={COLORS.dim}/></Pressable>):<View style={{backgroundColor:COLORS.elev,borderRadius:12,padding:12}}><Text style={{fontSize:10,color:COLORS.mist}}>Aucun match à venir disponible.</Text></View>}</View>
  </View>;
}
