import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Définition vectorielle maîtresse de l'emblème PULSE BET (viewBox 0 0 512 512).
 * - Écusson squircle sport haute précision (#FF2436 -> #E10014 -> #98000D)
 * - Tracé ECG "Pulse" fusionné à un éclair dynamique incliné + point live lumineux
 */
function buildCrestInnerDefs(prefix = "pb") {
  return `
    <linearGradient id="${prefix}-bg" x1="64" y1="36" x2="448" y2="476" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FF2638" />
      <stop offset="46%" stop-color="#E10014" />
      <stop offset="100%" stop-color="#96000D" />
    </linearGradient>
    <radialGradient id="${prefix}-glow" cx="156" cy="112" r="260" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FF7A85" stop-opacity="0.38" />
      <stop offset="65%" stop-color="#FF2638" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="${prefix}-rim" x1="60" y1="40" x2="420" y2="472" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.48" />
      <stop offset="45%" stop-color="#FFFFFF" stop-opacity="0.12" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.04" />
    </linearGradient>
    <linearGradient id="${prefix}-bolt" x1="180" y1="88" x2="330" y2="428" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#FFEef0" />
    </linearGradient>
    <filter id="${prefix}-shadow" x="-15%" y="-15%" width="130%" height="135%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#520007" flood-opacity="0.42" />
    </filter>
  `;
}

/**
 * Glyphe central "Pulse + Éclair" dessiné dans un repère 512×512.
 * Peut être utilisé en couleur blanche pleine (monochrome / notification) ou avec ombre portée.
 */
function buildPulseBoltGlyph({ fill = "#FFFFFF", filterAttr = "", accentFill = "#FFFFFF" } = {}) {
  return `
    <g ${filterAttr}>
      <!-- Onde ECG gauche menant à l'éclair -->
      <path
        d="M 76 274 H 128 L 150 232 L 174 302 L 198 258"
        fill="none"
        stroke="${fill}"
        stroke-width="26"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <!-- Éclair sportif central haute tension -->
      <path
        d="M 298 84 L 368 84 L 284 232 H 374 L 198 432 L 244 278 H 168 Z"
        fill="${fill}"
      />
      <!-- Onde ECG droite de sortie -->
      <path
        d="M 356 286 L 378 252 L 398 286 H 436"
        fill="none"
        stroke="${fill}"
        stroke-width="24"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <!-- Point LIVE signature en haut à droite -->
      <circle cx="404" cy="132" r="22" fill="${accentFill}" />
    </g>
  `;
}

/**
 * 1) Emblème autonome transparent (512×512 viewBox) — favicon SVG, mark PNG
 */
function svgStandaloneMark() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1024" height="1024">
    <defs>${buildCrestInnerDefs("mark")}</defs>
    <rect x="24" y="24" width="464" height="464" rx="118" fill="url(#mark-bg)" />
    <rect x="24" y="24" width="464" height="464" rx="118" fill="url(#mark-glow)" />
    <rect x="30" y="30" width="452" height="452" rx="112" fill="none" stroke="url(#mark-rim)" stroke-width="6" />
    ${buildPulseBoltGlyph({ fill: "url(#mark-bolt)", filterAttr: 'filter="url(#mark-shadow)"' })}
  </svg>`;
}

/**
 * 2) Icône principale de l'application (`icon.png` 1024×1024, sans transparence aux coins
 *    conformément aux exigences Google Play Store 32-bit PNG plein cadre).
 */
function svgAppLauncherIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    <defs>
      <linearGradient id="ic-bg" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#FF2436" />
        <stop offset="48%" stop-color="#E10014" />
        <stop offset="100%" stop-color="#8A000B" />
      </linearGradient>
      <radialGradient id="ic-spot" cx="280" cy="210" r="620" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#FF7D88" stop-opacity="0.42" />
        <stop offset="65%" stop-color="#E10014" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="ic-ring" x1="120" y1="90" x2="900" y2="930" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.26" />
        <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.03" />
      </linearGradient>
      <filter id="ic-drop" x="-18%" y="-18%" width="136%" height="140%">
        <feDropShadow dx="0" dy="22" stdDeviation="24" flood-color="#470005" flood-opacity="0.48" />
      </filter>
    </defs>
    <rect width="1024" height="1024" fill="url(#ic-bg)" />
    <rect width="1024" height="1024" fill="url(#ic-spot)" />
    <!-- Anneau télémétrique subtil -->
    <rect x="68" y="68" width="888" height="888" rx="210" fill="none" stroke="url(#ic-ring)" stroke-width="8" />
    <!-- Glyphe mis à l'échelle plein impact -->
    <g transform="translate(76, 76) scale(1.703125)">
      ${buildPulseBoltGlyph({ fill: "#FFFFFF", filterAttr: 'filter="url(#ic-drop)"' })}
    </g>
  </svg>`;
}

/**
 * 3) Android Adaptive Icon Foreground (`adaptive-icon.png` 1024×1024 RGBA transparent).
 *    Zone de sécurité Android 66dp / 108dp = cercle central de 625px (rayon 312px autour de 512,512).
 */
function svgAdaptiveForeground() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    <defs>
      <filter id="af-drop" x="-20%" y="-20%" width="140%" height="145%">
        <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#4A0006" flood-opacity="0.42" />
      </filter>
    </defs>
    <!-- Centré exactement dans la safe-zone 66dp (560×560 autour de 512,512) -->
    <g transform="translate(232, 232) scale(1.09375)">
      ${buildPulseBoltGlyph({ fill: "#FFFFFF", filterAttr: 'filter="url(#af-drop)"' })}
    </g>
  </svg>`;
}

/**
 * 4) Android Adaptive Icon Background (`adaptive-icon-background.png` 1024×1024).
 */
function svgAdaptiveBackground() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    <defs>
      <linearGradient id="ab-bg" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#FF2638" />
        <stop offset="50%" stop-color="#E10014" />
        <stop offset="100%" stop-color="#85000B" />
      </linearGradient>
      <radialGradient id="ab-glow" cx="300" cy="220" r="640" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#FF828C" stop-opacity="0.38" />
        <stop offset="70%" stop-color="#E10014" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect width="1024" height="1024" fill="url(#ab-bg)" />
    <rect width="1024" height="1024" fill="url(#ab-glow)" />
    <circle cx="512" cy="512" r="390" fill="none" stroke="#FFFFFF" stroke-opacity="0.08" stroke-width="4" />
    <circle cx="512" cy="512" r="470" fill="none" stroke="#FFFFFF" stroke-opacity="0.05" stroke-width="3" />
  </svg>`;
}

/**
 * 5) Android 13+ Monochrome Themed Icon (`monochrome-icon.png` 1024×1024 blanc + alpha).
 */
function svgMonochromeIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    <g transform="translate(232, 232) scale(1.09375)">
      ${buildPulseBoltGlyph({ fill: "#FFFFFF", accentFill: "#FFFFFF" })}
    </g>
  </svg>`;
}

/**
 * 6) Android Notification Status-Bar Icon (`notification-icon.png` 96×96 blanc pur + alpha).
 */
function svgNotificationIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="96" height="96">
    <g transform="translate(20, 20) scale(0.921875)">
      ${buildPulseBoltGlyph({ fill: "#FFFFFF", accentFill: "#FFFFFF" })}
    </g>
  </svg>`;
}

/**
 * 7) Logo horizontal complet PULSE BET (versions claire & sombre) — SVG + PNG HD
 */
function svgHorizontalLogo(theme = "light") {
  const isDark = theme === "dark";
  const pulseColor = isDark ? "#FFFFFF" : "#111827";
  const subColor = isDark ? "#9CA3AF" : "#6B7280";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 940 220" width="1880" height="440">
    <defs>${buildCrestInnerDefs(`hz-${theme}`)}</defs>
    <!-- Écusson PULSE BET -->
    <g transform="translate(18, 18) scale(0.359375)">
      <rect x="24" y="24" width="464" height="464" rx="118" fill="url(#hz-${theme}-bg)" />
      <rect x="24" y="24" width="464" height="464" rx="118" fill="url(#hz-${theme}-glow)" />
      <rect x="30" y="30" width="452" height="452" rx="112" fill="none" stroke="url(#hz-${theme}-rim)" stroke-width="6" />
      ${buildPulseBoltGlyph({ fill: "#FFFFFF", filterAttr: `filter="url(#hz-${theme}-shadow)"` })}
    </g>

    <!-- Typographie sportive PULSE + badge BET -->
    <g transform="translate(226, 0)">
      <text
        x="0"
        y="126"
        fill="${pulseColor}"
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        font-size="102"
        font-weight="900"
        font-style="italic"
        letter-spacing="-2"
      >PULSE</text>

      <!-- Cartouche rouge signature BET parfaitement espacé après PULSE -->
      <rect x="404" y="46" width="214" height="94" rx="22" fill="#E10014" />
      <text
        x="511"
        y="116"
        text-anchor="middle"
        fill="#FFFFFF"
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        font-size="66"
        font-weight="900"
        font-style="italic"
        letter-spacing="1"
      >BET</text>

      <text
        x="4"
        y="174"
        fill="${subColor}"
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        font-size="21"
        font-weight="700"
        letter-spacing="3.2"
      >PARIS SPORTIFS &amp; PRÉDICTIONS LIVE</text>
    </g>
  </svg>`;
}

/**
 * 8) Splash Screen Natif Android WQHD+ HD (`splash-icon.png` 1440×3200 sur fond #090D16).
 *    Aligné au pixel près avec le composant React Native `<PulseSplashScreen />` (même fond #090D16,
 *    même lueur radiale rouge #E10014 et même emblème centré) pour une transition 0 saccade.
 */
function svgNativeSplashHd() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 3200" width="1440" height="3200">
    <defs>
      <radialGradient id="sp-halo" cx="720" cy="1440" r="680" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#E10014" stop-opacity="0.28" />
        <stop offset="55%" stop-color="#E10014" stop-opacity="0.06" />
        <stop offset="100%" stop-color="#090D16" stop-opacity="0" />
      </radialGradient>
      ${buildCrestInnerDefs("sp")}
    </defs>

    <!-- Fond obsidienne identique à app.json splash.backgroundColor & PulseSplashScreen -->
    <rect width="1440" height="3200" fill="#090D16" />
    <rect width="1440" height="3200" fill="url(#sp-halo)" />

    <!-- Cercles télémétriques subtils HD -->
    <circle cx="720" cy="1440" r="290" fill="none" stroke="#E10014" stroke-opacity="0.16" stroke-width="2.5" />
    <circle cx="720" cy="1440" r="410" fill="none" stroke="#FFFFFF" stroke-opacity="0.05" stroke-width="2" />

    <!-- Emblème central HD (340×340 centré en x=720, y=1440) -->
    <g transform="translate(550, 1270) scale(0.6640625)">
      <rect x="24" y="24" width="464" height="464" rx="118" fill="url(#sp-bg)" />
      <rect x="24" y="24" width="464" height="464" rx="118" fill="url(#sp-glow)" />
      <rect x="30" y="30" width="452" height="452" rx="112" fill="none" stroke="url(#sp-rim)" stroke-width="6" />
      ${buildPulseBoltGlyph({ fill: "#FFFFFF", filterAttr: 'filter="url(#sp-shadow)"' })}
    </g>

    <!-- Lockup typographique PULSE BET parfaitement centré -->
    <g transform="translate(720, 1735)">
      <text
        x="-96"
        y="0"
        text-anchor="middle"
        fill="#FFFFFF"
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        font-size="90"
        font-weight="900"
        font-style="italic"
        letter-spacing="-2"
      >PULSE</text>
      <rect x="96" y="-68" width="174" height="82" rx="20" fill="#E10014" />
      <text
        x="183"
        y="-9"
        text-anchor="middle"
        fill="#FFFFFF"
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        font-size="54"
        font-weight="900"
        font-style="italic"
        letter-spacing="1"
      >BET</text>
      <text
        x="0"
        y="64"
        text-anchor="middle"
        fill="#9CA3AF"
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        font-size="25"
        font-weight="700"
        letter-spacing="5.5"
      >PARIS SPORTIFS &amp; PRÉDICTIONS</text>
    </g>
  </svg>`;
}

/**
 * 9) Bannière Google Play Store (`feature-graphic.png` 1024×500) & OpenGraph Web (`1200×630`)
 */
function svgBannerCard(width, height) {
  const cy = Math.round(height / 2);
  const pulseSize = Math.round(width * 0.078);
  const pillX = Math.round(width * 0.308);
  const pillW = Math.round(width * 0.165);
  const pillH = Math.round(width * 0.074);
  const pillY = -Math.round(width * 0.061);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <defs>
      <linearGradient id="bn-bg" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#090D16" />
        <stop offset="58%" stop-color="#111827" />
        <stop offset="100%" stop-color="#2A050A" />
      </linearGradient>
      <radialGradient id="bn-glow" cx="${Math.round(width * 0.21)}" cy="${cy}" r="${Math.round(width * 0.44)}" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#E10014" stop-opacity="0.34" />
        <stop offset="100%" stop-color="#E10014" stop-opacity="0" />
      </radialGradient>
      ${buildCrestInnerDefs("bn")}
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bn-bg)" />
    <rect width="${width}" height="${height}" fill="url(#bn-glow)" />
    <circle cx="${Math.round(width * 0.2)}" cy="${cy}" r="${Math.round(height * 0.38)}" fill="none" stroke="#E10014" stroke-opacity="0.16" stroke-width="2" />
    <circle cx="${Math.round(width * 0.2)}" cy="${cy}" r="${Math.round(height * 0.54)}" fill="none" stroke="#FFFFFF" stroke-opacity="0.06" stroke-width="1.5" />

    <g transform="translate(${Math.round(width * 0.075)}, ${cy - 114}) scale(0.4453125)">
      <rect x="24" y="24" width="464" height="464" rx="118" fill="url(#bn-bg)" />
      <rect x="24" y="24" width="464" height="464" rx="118" fill="#E10014" />
      <rect x="24" y="24" width="464" height="464" rx="118" fill="url(#bn-glow)" />
      <rect x="30" y="30" width="452" height="452" rx="112" fill="none" stroke="url(#bn-rim)" stroke-width="6" />
      ${buildPulseBoltGlyph({ fill: "#FFFFFF", filterAttr: 'filter="url(#bn-shadow)"' })}
    </g>

    <g transform="translate(${Math.round(width * 0.335)}, ${cy - 12})">
      <text
        x="0"
        y="0"
        fill="#FFFFFF"
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        font-size="${pulseSize}"
        font-weight="900"
        font-style="italic"
        letter-spacing="-2"
      >PULSE</text>
      <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="16" fill="#E10014" />
      <text
        x="${pillX + Math.round(pillW / 2)}"
        y="${-Math.round(width * 0.008)}"
        text-anchor="middle"
        fill="#FFFFFF"
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        font-size="${Math.round(width * 0.049)}"
        font-weight="900"
        font-style="italic"
      >BET</text>
      <text
        x="4"
        y="${Math.round(height * 0.095)}"
        fill="#D1D5DB"
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        font-size="${Math.round(width * 0.0185)}"
        font-weight="700"
        letter-spacing="2.6"
      >COTES EN DIRECT · CASH OUT · PRÉDICTIONS</text>
    </g>
  </svg>`;
}

/**
 * Construit un fichier `.ico` valide contenant deux images PNG (32×32 et 48×48).
 */
function buildIcoFromPngBuffers(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // ICO type
  header.writeUInt16LE(count, 4);

  let offset = header.length;
  for (let i = 0; i < count; i++) {
    const { size, png } = entries[i];
    const base = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, base + 0);
    header.writeUInt8(size >= 256 ? 0 : size, base + 1);
    header.writeUInt8(0, base + 2);
    header.writeUInt8(0, base + 3);
    header.writeUInt16LE(1, base + 4);
    header.writeUInt16LE(32, base + 6);
    header.writeUInt32LE(png.length, base + 8);
    header.writeUInt32LE(offset, base + 12);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries.map((e) => e.png)]);
}

async function renderSvgToPng(svg, width, height, outPath) {
  ensureDir(path.dirname(outPath));
  await sharp(Buffer.from(svg), { density: 300 })
    .resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outPath);
}

async function main() {
  ensureDir(path.join(ROOT, "public", "brand"));
  ensureDir(path.join(ROOT, "public", "icons"));
  ensureDir(path.join(ROOT, "mobile", "assets"));

  // 1. SVGs maîtres (site Web + marque)
  const markSvg = svgStandaloneMark();
  const logoLightSvg = svgHorizontalLogo("light");
  const logoDarkSvg = svgHorizontalLogo("dark");

  fs.writeFileSync(path.join(ROOT, "src", "app", "icon.svg"), markSvg, "utf8");
  fs.writeFileSync(path.join(ROOT, "public", "brand", "pulse-bet-mark.svg"), markSvg, "utf8");
  fs.writeFileSync(path.join(ROOT, "public", "brand", "pulse-bet-logo-light.svg"), logoLightSvg, "utf8");
  fs.writeFileSync(path.join(ROOT, "public", "brand", "pulse-bet-logo-dark.svg"), logoDarkSvg, "utf8");

  // 2. Logos PNG HD site Web + Favicon + PWA + OpenGraph
  await renderSvgToPng(markSvg, 1024, 1024, path.join(ROOT, "public", "brand", "pulse-bet-mark.png"));
  await renderSvgToPng(logoLightSvg, 1880, 440, path.join(ROOT, "public", "brand", "pulse-bet-logo-light.png"));
  await renderSvgToPng(logoDarkSvg, 1880, 440, path.join(ROOT, "public", "brand", "pulse-bet-logo-dark.png"));

  await renderSvgToPng(markSvg, 180, 180, path.join(ROOT, "src", "app", "apple-icon.png"));
  await renderSvgToPng(markSvg, 192, 192, path.join(ROOT, "public", "icons", "icon-192.png"));
  await renderSvgToPng(markSvg, 512, 512, path.join(ROOT, "public", "icons", "icon-512.png"));
  await renderSvgToPng(svgAppLauncherIcon(), 512, 512, path.join(ROOT, "public", "icons", "icon-maskable-512.png"));
  await renderSvgToPng(svgBannerCard(1200, 630), 1200, 630, path.join(ROOT, "public", "og-pulse-bet.png"));

  const png32 = await sharp(Buffer.from(markSvg), { density: 300 }).resize(32, 32).png().toBuffer();
  const png48 = await sharp(Buffer.from(markSvg), { density: 300 }).resize(48, 48).png().toBuffer();
  const icoBuf = buildIcoFromPngBuffers([
    { size: 32, png: png32 },
    { size: 48, png: png48 },
  ]);
  fs.writeFileSync(path.join(ROOT, "public", "favicon.ico"), icoBuf);

  // 3. Suite complète d'assets Android HD (`mobile/assets/`)
  await renderSvgToPng(svgAppLauncherIcon(), 1024, 1024, path.join(ROOT, "mobile", "assets", "icon.png"));
  await renderSvgToPng(svgAdaptiveForeground(), 1024, 1024, path.join(ROOT, "mobile", "assets", "adaptive-icon.png"));
  await renderSvgToPng(svgAdaptiveBackground(), 1024, 1024, path.join(ROOT, "mobile", "assets", "adaptive-icon-background.png"));
  await renderSvgToPng(svgMonochromeIcon(), 1024, 1024, path.join(ROOT, "mobile", "assets", "monochrome-icon.png"));
  await renderSvgToPng(svgNotificationIcon(), 96, 96, path.join(ROOT, "mobile", "assets", "notification-icon.png"));
  await renderSvgToPng(svgNativeSplashHd(), 1440, 3200, path.join(ROOT, "mobile", "assets", "splash-icon.png"));
  await renderSvgToPng(markSvg, 196, 196, path.join(ROOT, "mobile", "assets", "favicon.png"));
  await renderSvgToPng(svgBannerCard(1024, 500), 1024, 500, path.join(ROOT, "mobile", "assets", "feature-graphic.png"));

  // 4. Pack natif Android multi-densités complet (`mobile/android-res/` : mdpi -> xxxhdpi + anydpi-v26)
  const ANDROID_RES = path.join(ROOT, "mobile", "android-res");
  const launcherSvg = svgAppLauncherIcon();
  const fgSvg = svgAdaptiveForeground();
  const bgSvg = svgAdaptiveBackground();
  const monoSvg = svgMonochromeIcon();
  const notifSvg = svgNotificationIcon();
  const roundLauncherSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" fill="none">
    <defs>
      <linearGradient id="rndBg" x1="96" y1="48" x2="928" y2="976" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#FF2638" />
        <stop offset="48%" stop-color="#E10014" />
        <stop offset="100%" stop-color="#96000D" />
      </linearGradient>
    </defs>
    <circle cx="512" cy="512" r="512" fill="url(#rndBg)" />
    <g transform="translate(88, 88) scale(1.65625)">
      <path d="M 76 274 H 128 L 150 232 L 174 302 L 198 258" stroke="#FFFFFF" stroke-width="28" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M 298 84 L 368 84 L 284 232 H 374 L 198 432 L 244 278 H 168 Z" fill="#FFFFFF" />
      <path d="M 356 286 L 378 252 L 398 286 H 436" stroke="#FFFFFF" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="404" cy="132" r="24" fill="#FFFFFF" />
    </g>
  </svg>`;

  for (const d of [
    { dir: "mipmap-mdpi", legacy: 48, adaptive: 108 },
    { dir: "mipmap-hdpi", legacy: 72, adaptive: 162 },
    { dir: "mipmap-xhdpi", legacy: 96, adaptive: 216 },
    { dir: "mipmap-xxhdpi", legacy: 144, adaptive: 324 },
    { dir: "mipmap-xxxhdpi", legacy: 192, adaptive: 432 },
  ]) {
    const outDir = path.join(ANDROID_RES, d.dir);
    await renderSvgToPng(launcherSvg, d.legacy, d.legacy, path.join(outDir, "ic_launcher.png"));
    await renderSvgToPng(roundLauncherSvg, d.legacy, d.legacy, path.join(outDir, "ic_launcher_round.png"));
    await renderSvgToPng(fgSvg, d.adaptive, d.adaptive, path.join(outDir, "ic_launcher_foreground.png"));
    await renderSvgToPng(bgSvg, d.adaptive, d.adaptive, path.join(outDir, "ic_launcher_background.png"));
    await renderSvgToPng(monoSvg, d.adaptive, d.adaptive, path.join(outDir, "ic_launcher_monochrome.png"));
  }

  for (const d of [
    { dir: "drawable-mdpi", px: 24, splashLogo: 192 },
    { dir: "drawable-hdpi", px: 36, splashLogo: 288 },
    { dir: "drawable-xhdpi", px: 48, splashLogo: 384 },
    { dir: "drawable-xxhdpi", px: 72, splashLogo: 576 },
    { dir: "drawable-xxxhdpi", px: 96, splashLogo: 768 },
  ]) {
    const outDir = path.join(ANDROID_RES, d.dir);
    await renderSvgToPng(notifSvg, d.px, d.px, path.join(outDir, "ic_stat_pulse.png"));
    await renderSvgToPng(markSvg, d.splashLogo, d.splashLogo, path.join(outDir, "splashscreen_logo.png"));
  }

  const anydpiDir = path.join(ANDROID_RES, "mipmap-anydpi-v26");
  fs.mkdirSync(anydpiDir, { recursive: true });
  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@mipmap/ic_launcher_background" />
  <foreground android:drawable="@mipmap/ic_launcher_foreground" />
  <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`;
  fs.writeFileSync(path.join(anydpiDir, "ic_launcher.xml"), adaptiveXml, "utf8");
  fs.writeFileSync(path.join(anydpiDir, "ic_launcher_round.xml"), adaptiveXml, "utf8");

  const valuesDir = path.join(ANDROID_RES, "values");
  fs.mkdirSync(valuesDir, { recursive: true });
  fs.writeFileSync(
    path.join(valuesDir, "colors.xml"),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="splashscreen_background">#090D16</color>
  <color name="iconBackground">#E10014</color>
  <color name="colorPrimary">#E10014</color>
  <color name="notification_icon_color">#E10014</color>
</resources>
`,
    "utf8"
  );

  console.log("ALL_BRAND_AND_ANDROID_HD_ASSETS_GENERATED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
