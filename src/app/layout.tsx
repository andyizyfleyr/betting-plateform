import { publicAssetUrl } from "@/lib/public-assets";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { BottomNav } from "@/components/bottom-nav";
import { Providers } from "@/components/providers";
import { getBrandingSettings } from "@/lib/admin-settings";

export async function generateMetadata(): Promise<Metadata> {
  // Branding configurable par l'admin (nom, tagline) — sans redéploiement.
  const b = await getBrandingSettings();
  const tagline = b.tagline || "Paris sportifs & Prédictions Live";
  const titleDefault = b.siteName
    ? `${b.siteName} — ${tagline}`
    : "Pulse Bet — Paris sportifs & Prédictions Live";
  return {
    metadataBase: new URL("https://be-plateform.vercel.app"),
    title: {
      default: titleDefault,
      template: `%s | ${b.siteName}`,
    },
    description: `${b.siteName} : plateforme de paris sportifs en direct, Cash Out instantané et prédictions à cotes fixes.`,
    applicationName: b.siteName,
    icons: {
      icon: [
        { url: publicAssetUrl("/favicon.ico"), sizes: "48x48" },
        { url: publicAssetUrl("/icons/icon-192.png"), sizes: "192x192", type: "image/png" },
        { url: publicAssetUrl("/icons/icon-512.png"), sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    },
    openGraph: {
      type: "website",
      locale: "fr_FR",
      siteName: b.siteName,
      title: titleDefault,
      description:
        "Cotes en direct, Cash Out instantané et prédictions sportives à cotes fixes.",
      images: [
        {
          url: publicAssetUrl("/og-pulse-bet.png"),
          width: 1200,
          height: 630,
          alt: titleDefault,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: titleDefault,
      description:
        "Cotes en direct, Cash Out instantané et prédictions sportives à cotes fixes.",
      images: [publicAssetUrl("/og-pulse-bet.png")],
    },
  };
}

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
