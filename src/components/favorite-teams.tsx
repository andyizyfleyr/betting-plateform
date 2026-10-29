"use client";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/components/providers";
import type { ClientMatch } from "@/lib/api";

type Favorite = { teamKey: string; teamName: string };
function useFavorites() {
  const { user } = useApp();
  return useQuery({ queryKey: ["favorite-teams", user?.id], enabled: Boolean(user), staleTime: 30_000,
    queryFn: async () => { const r = await fetch("/api/favorites", { cache: "no-store" }); if (!r.ok) throw new Error("Favoris indisponibles"); return await r.json() as { teams: Favorite[] }; } });
}
export function FavoriteTeamButton({ teamName }: { teamName: string }) {
  const { user, toast } = useApp(); const router = useRouter(); const client = useQueryClient(); const q = useFavorites();
  const [busy, setBusy] = useState(false);
  const following = Boolean(q.data?.teams.some((t) => t.teamKey === teamName.normalize("NFKC").toLocaleLowerCase("fr")));
  const toggle = async () => {
    if (!user) { router.push("/auth/connexion"); return; }
    if (busy) return; setBusy(true);
    try {
      const r = await fetch("/api/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamName, following: !following }) });
      if (!r.ok) throw new Error((await r.json()).error || "Action impossible");
      await client.invalidateQueries({ queryKey: ["favorite-teams", user.id] });
    } catch (e) { toast({ kind: "error", title: "Favoris", description: e instanceof Error ? e.message : "Action impossible" }); }
    finally { setBusy(false); }
  };
  return <button type="button" aria-label={`${following ? "Ne plus suivre" : "Suivre"} ${teamName}`} disabled={busy} onClick={() => void toggle()} className="p-1"><Star className="h-4 w-4" color={following ? "#d99a00" : "#94a3b8"} fill={following ? "#d99a00" : "none"} /></button>;
}
export function FavoriteMatches({ matches }: { matches: ClientMatch[] }) {
  const q = useFavorites(); const names = new Set((q.data?.teams ?? []).map((t) => t.teamName));
  if (!names.size) return null;
  const upcoming = matches.filter((m) => m.status !== "finished" && (names.has(m.homeTeam) || names.has(m.awayTeam))).sort((a,b) => new Date(a.startsAt).getTime()-new Date(b.startsAt).getTime()).slice(0,5);
  return <section className="mb-3 rounded-xl border border-edge bg-white p-3 text-[11px]"><h2 className="font-bold text-ink">Mes équipes favorites</h2><p className="text-mist">{[...names].join(" · ")}</p>{upcoming.length ? upcoming.map((m) => <Link key={m.id} href={`/matchs/${m.id}`} className="block pt-1 text-ink">{m.homeTeam} – {m.awayTeam}</Link>) : <p className="pt-1 text-mist">Aucun match à venir disponible.</p>}</section>;
}
