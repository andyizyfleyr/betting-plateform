"use client";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, ChevronRight } from "lucide-react";
import { TeamAvatar } from "@/components/team-avatar";
import { formatKickoff } from "@/lib/format";
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
  return <section className="mb-3 overflow-hidden rounded-2xl border border-edge bg-white text-[11px]">
    <div className="flex items-center gap-3 border-b border-edge p-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600"><Star size={17} fill="currentColor"/></div><div className="min-w-0 flex-1"><h2 className="text-[12px] font-bold text-ink">Mes équipes favorites</h2><p className="mt-0.5 text-[10px] text-mist">{names.size} équipe{names.size>1?"s suivies":" suivie"}</p></div></div>
    <div className="flex flex-wrap gap-1.5 px-3 pt-3">{[...names].map(name=><span key={name} className="max-w-full truncate rounded-full bg-elev px-2.5 py-1 text-[10px] text-mist">{name}</span>)}</div>
    <div className="px-3 pb-3 pt-2"><p className="mb-1 text-[10px] text-mist">Matchs à suivre</p>{upcoming.length ? upcoming.map(m=><Link key={m.id} href={`/matchs/${m.id}`} className="flex items-center gap-2 border-t border-edge py-2.5 first:border-t-0"><div className="flex -space-x-1"><TeamAvatar name={m.homeTeam} logo={m.homeLogo} size="xs"/><TeamAvatar name={m.awayTeam} logo={m.awayLogo} size="xs"/></div><div className="min-w-0 flex-1"><p className="truncate text-ink">{m.homeTeam} – {m.awayTeam}</p><p className={`mt-0.5 text-[10px] ${m.status === "live" ? "text-betclic-red" : "text-mist"}`}>{m.status === "live" ? "En direct" : formatKickoff(m.startsAt)}</p></div><ChevronRight size={15} className="shrink-0 text-dim"/></Link>) : <p className="rounded-xl bg-elev/70 p-3 text-[10px] text-mist">Aucun match à venir disponible.</p>}</div>
  </section>;
}
