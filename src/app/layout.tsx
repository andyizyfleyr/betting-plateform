import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Montserrat, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  weight: ["500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "PULSE — Paris Sportifs",
  description: "Plateforme de paris sportifs en temps réel. Matchs en direct, cotes, tickets.",
};

export const viewport: Viewport = {
  themeColor: "#05080d",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={`${grotesk.variable} ${inter.variable} ${montserrat.variable}`}>
      <body className="bg-[#030507] text-white antialiased">
        <div className="ambient" aria-hidden />
        <Providers>
          <div className="app-shell relative z-10 mx-auto flex min-h-dvh w-full max-w-[27.5rem] flex-col bg-ink sm:border-x sm:border-edge/50">
            <AppHeader />
            <main className="flex-1">{children}</main>
            <BottomNav />
          </div>
        </Providers>
      </body>
    </html>
  );
}
