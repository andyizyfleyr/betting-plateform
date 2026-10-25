import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "PULSE — Paris & Prédictions",
  description: "Plateforme mobile de prédictions et paris sportifs en temps réel.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-deep text-ink antialiased">
        <Providers>
          <div className="mx-auto flex min-h-dvh w-full flex-col overflow-x-clip bg-deep sm:max-w-[440px] sm:border-x sm:border-edge sm:shadow-sm">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
