import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { DesktopSidebar } from "@/components/desktop-sidebar";

export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full flex-col lg:flex-row">
      <DesktopSidebar />
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <AppHeader />
        <main className="flex-1">{children}</main>
        <BottomNav />
      </div>
    </div>
  );
}
