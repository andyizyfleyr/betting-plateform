import type { ReactNode } from "react";
import { MainShell } from "@/components/main-shell";

export default function MainLayout({ children }: { children: ReactNode }) {
  return <MainShell>{children}</MainShell>;
}
