import React from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react-native";
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
  return <View style={{ marginHorizontal: 8, marginVertical: 8, borderRadius: 12, backgroundColor: "white", padding: 12 }}>
    <Text style={{ color: COLORS.ink, fontSize: 12, fontWeight: "700" }}>Mes équipes favorites</Text>
    <Text style={{ color: COLORS.mist, fontSize: 11, marginTop: 4 }}>{[...names].join(" · ")}</Text>
    {upcoming.length ? upcoming.map((m) => <Pressable key={m.id} onPress={() => router.push(`/matchs/${m.id}`)} style={{ paddingVertical: 6 }}>
      <Text style={{ color: COLORS.ink, fontSize: 11 }}>{m.homeTeam} – {m.awayTeam}</Text>
    </Pressable>) : <Text style={{ color: COLORS.mist, fontSize: 11, marginTop: 6 }}>Aucun match à venir disponible.</Text>}
  </View>;
}
