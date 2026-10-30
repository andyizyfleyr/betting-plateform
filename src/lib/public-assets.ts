/** URL d'assets publics uniquement. La valeur NEXT_PUBLIC est intégrée au build web.
 * En l'absence de configuration HTTPS valide, les chemins Vercel restent inchangés. */
export function normalizeAssetOrigin(input: string | undefined): string | null {
  if (!input) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

export function publicAssetUrl(path: string): string {
  if (!/^\/(?:images|brand|icons)\/[a-zA-Z0-9_./-]+$/.test(path) &&
      !/^\/(?:favicon\.ico|og-pulse-bet\.png|cashout\.mp3|crashed\.mp3|maintien\.mp3|Pulse-Bet-Android\.apk)$/.test(path)) return path;
  if (path.includes("..") || path.includes("//")) return path;
  const origin = normalizeAssetOrigin(process.env.NEXT_PUBLIC_R2_PUBLIC_ORIGIN);
  return origin ? `${origin}${path}` : path;
}

/** Les fichiers OTA ont un interrupteur distinct, pour ne jamais publier un manifeste
 * pointant vers un bundle pas encore transféré/vérifié. */
export function otaAssetUrl(path: string, fallbackOrigin: string): string {
  if (!/^\/expo-sdk52\/(?:AppEntry-[a-f0-9]+\.hbc|assets\/[a-f0-9]+)$/.test(path)) {
    throw new Error("Chemin d'asset OTA invalide");
  }
  return `${normalizeAssetOrigin(process.env.R2_OTA_ASSETS_ORIGIN) ?? fallbackOrigin}${path}`;
}
