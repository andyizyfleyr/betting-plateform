import { redirect } from "next/navigation";

/**
 * Index admin : redirige vers la page de synthèse.
 * Chaque onglet a désormais sa propre URL (ex. /admin/matches).
 */
export default function AdminIndex() {
  redirect("/admin/dashboard");
}
