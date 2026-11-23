import { AdminProvider } from "@/components/admin/admin-provider";

/**
 * Layout de l'admin : fournit le contexte admin partagé (panel, actions,
 * forms) à toutes les pages de l'admin. La navigation (sidebar + header)
 * est déjà gérée par le shell global (main-shell).
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminProvider>{children}</AdminProvider>;
}
