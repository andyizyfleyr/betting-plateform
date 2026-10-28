import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { BottomNav } from "@/components/bottom-nav";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  metadataBase: new URL("https://be-plateform.vercel.app"),
  title: {
    default: "Pulse Bet — Paris sportifs & Prédictions Live",
    template: "%s | Pulse Bet",
  },
  description:
    "Pulse Bet : plateforme de paris sportifs en direct, Cash Out instantané et prédictions à cotes fixes.",
  applicationName: "Pulse Bet",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "Pulse Bet",
    title: "Pulse Bet — Paris sportifs & Prédictions Live",
    description:
      "Cotes en direct, Cash Out instantané et prédictions sportives à cotes fixes.",
    images: [
      {
        url: "/og-pulse-bet.png",
        width: 1200,
        height: 630,
        alt: "Pulse Bet — Paris sportifs & Prédictions Live",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pulse Bet — Paris sportifs & Prédictions Live",
    description:
      "Cotes en direct, Cash Out instantané et prédictions sportives à cotes fixes.",
    images: ["/og-pulse-bet.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#e10014",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-deep text-ink antialiased">
        <Providers>
          <div className="mx-auto flex min-h-dvh w-full flex-col overflow-x-clip bg-deep">
            {children}
          </div>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
