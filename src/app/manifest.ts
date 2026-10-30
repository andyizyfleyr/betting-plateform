import { publicAssetUrl } from "@/lib/public-assets";
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pulse Bet — Paris sportifs & Prédictions Live",
    short_name: "Pulse Bet",
    description:
      "Plateforme de paris sportifs en direct, Cash Out instantané et prédictions à cotes fixes.",
    start_url: "/matchs",
    display: "standalone",
    orientation: "portrait",
    background_color: "#090D16",
    theme_color: "#e10014",
    lang: "fr",
    icons: [
      {
        src: publicAssetUrl("/icons/icon-192.png"),
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: publicAssetUrl("/icons/icon-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: publicAssetUrl("/icons/icon-maskable-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
