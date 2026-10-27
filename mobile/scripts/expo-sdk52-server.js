#!/usr/bin/env node
/**
 * Serveur Expo Go SDK 52 (Android · Hermes) sur `0.0.0.0:8081` :
 * - Sert le manifeste officiel Expo Updates (`expo-protocol-version: 1`, `exposdk:52.0.0`)
 *   aux clients Android Expo Go SDK 52 (`exp://<host>:443`).
 * - Sert le bundle Hermes `.hbc` et les 12 assets vérifiés par SHA-256 base64url.
 * - Sert la page d'aperçu HTML avec QR Code et lien permanent 24h/24 dans Arena.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const QRCode = require("qrcode");

const MOBILE_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(MOBILE_ROOT, "..");
const PUBLIC_SDK52 = path.join(REPO_ROOT, "public", "expo-sdk52");
const META_PATH = path.join(REPO_ROOT, "src", "lib", "expo-sdk52-meta.json");

const PORT = Number(process.env.PORT || 8081);
const HOST = "0.0.0.0";
const SANDBOX_ID = process.env.E2B_SANDBOX_ID || "";
const DEFAULT_PUBLIC_HOST = SANDBOX_ID
  ? `${PORT}-${SANDBOX_ID}.e2b.app`
  : `localhost:${PORT}`;

if (!fs.existsSync(META_PATH) || !fs.existsSync(PUBLIC_SDK52)) {
  execFileSync(process.execPath, [path.join(__dirname, "export-sdk52-static.js")], {
    cwd: MOBILE_ROOT,
    stdio: "inherit",
  });
}

const sdk52Meta = JSON.parse(fs.readFileSync(META_PATH, "utf8"));

const MIME_MAP = {
  ".hbc": "application/javascript",
  ".js": "application/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
};

function resolvePublicHost(req) {
  const xfHost = req.headers["x-forwarded-host"];
  const rawHost =
    (Array.isArray(xfHost) ? xfHost[0] : xfHost) ||
    req.headers.host ||
    DEFAULT_PUBLIC_HOST;
  const clean = String(rawHost).split(",")[0].trim();
  if (
    (clean.startsWith("127.0.0.1") || clean.startsWith("localhost")) &&
    SANDBOX_ID
  ) {
    return DEFAULT_PUBLIC_HOST;
  }
  return clean;
}

function isExpoClient(req, pathname, searchParams) {
  if (pathname === "/manifest" || pathname === "/index.exp") return true;
  if (pathname !== "/" && pathname !== "/api/expo") return false;
  if (
    searchParams.get("format") === "json" ||
    searchParams.get("platform") === "android"
  ) {
    return true;
  }
  const h = req.headers;
  if (
    h["expo-platform"] ||
    h["exponent-platform"] ||
    h["expo-protocol-version"] ||
    h["expo-runtime-version"] ||
    h["expo-updates-environment"] ||
    h["eas-client-id"]
  ) {
    return true;
  }
  const ua = String(h["user-agent"] || "").toLowerCase();
  if (ua.includes("okhttp") || ua.includes("exponent") || ua.includes("expo")) {
    return true;
  }
  const accept = String(h.accept || "").toLowerCase();
  if (
    (accept.includes("multipart/mixed") ||
      accept.includes("application/expo+json") ||
      accept.includes("application/json")) &&
    !accept.includes("text/html")
  ) {
    return true;
  }
  return false;
}

function buildSdk52Manifest(origin, host) {
  return {
    id: sdk52Meta.id,
    createdAt: sdk52Meta.createdAt,
    runtimeVersion: "exposdk:52.0.0",
    launchAsset: {
      hash: sdk52Meta.launchAsset.hash,
      key: sdk52Meta.launchAsset.key,
      contentType: "application/javascript",
      fileExtension: sdk52Meta.launchAsset.fileExtension,
      url: `${origin}${sdk52Meta.launchAsset.relativePath}`,
    },
    assets: sdk52Meta.assets.map((a) => ({
      hash: a.hash,
      key: a.key,
      contentType: a.contentType,
      fileExtension: a.fileExtension,
      url: `${origin}${a.relativePath}`,
    })),
    metadata: {},
    extra: {
      eas: {},
      expoClient: {
        name: "PulseBets",
        slug: "pulsebets-android",
        version: "1.0.0",
        sdkVersion: "52.0.0",
        platforms: ["android"],
        orientation: "portrait",
        primaryColor: "#e10014",
        userInterfaceStyle: "light",
        backgroundColor: "#f4f5f7",
        jsEngine: "hermes",
        hostUri: host,
        icon: "./assets/icon.png",
        iconUrl: `${origin}/expo-sdk52/icon.png`,
        splash: {
          image: "./assets/splash-icon.png",
          resizeMode: "contain",
          backgroundColor: "#ffffff",
          imageUrl: `${origin}/expo-sdk52/splash-icon.png`,
        },
        android: {
          package: "app.pulsebets.android",
          versionCode: 1,
          adaptiveIcon: {
            foregroundImage: "./assets/adaptive-icon.png",
            backgroundColor: "#e10014",
            foregroundImageUrl: `${origin}/expo-sdk52/adaptive-icon.png`,
          },
        },
        extra: {
          apiBaseUrl: "https://be-plateform.vercel.app",
        },
      },
      expoGo: {
        debuggerHost: `${host}:443`,
        mainModuleName: "node_modules/expo/AppEntry",
        packagerOpts: {
          dev: false,
        },
      },
      scopeKey: "@anonymous/pulsebets-android",
    },
  };
}

async function renderLauncherHtml() {
  const permanentExpUrl = "exp://be-plateform.vercel.app:443/api/expo";
  const qrSvg = await QRCode.toString(permanentExpUrl, {
    type: "svg",
    margin: 1,
    width: 248,
    color: { dark: "#111827", light: "#ffffff" },
  });

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PulseBets Android · Expo Go SDK 52</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f4f5f7;
      color: #111827;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      width: 100%;
      max-width: 520px;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 22px;
      padding: 24px;
      box-shadow: 0 12px 32px rgba(17, 24, 39, 0.07);
    }
    .brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      font-weight: 900;
      font-size: 20px;
    }
    .brand-dot {
      width: 30px;
      height: 30px;
      border-radius: 9px;
      background: #e10014;
      color: #fff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
    }
    .sdk-pill {
      background: #fef2f2;
      color: #e10014;
      border: 1px solid #fecaca;
      font-size: 12px;
      font-weight: 800;
      padding: 5px 10px;
      border-radius: 999px;
    }
    .badge {
      display: inline-block;
      font-size: 12px;
      font-weight: 700;
      padding: 5px 11px;
      border-radius: 999px;
      margin-bottom: 16px;
      background: #dcfce7;
      color: #15803d;
    }
    .qr-box {
      width: 268px;
      height: 268px;
      margin: 6px auto 18px;
      padding: 10px;
      border-radius: 18px;
      border: 2px solid #e5e7eb;
      background: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .qr-box svg { width: 100%; height: 100%; display: block; }
    .url-box {
      background: #f1f3f5;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 11px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12.5px;
      word-break: break-all;
      color: #111827;
      margin-bottom: 12px;
    }
    .actions { display: flex; gap: 8px; margin-bottom: 18px; }
    .btn {
      flex: 1;
      height: 42px;
      border-radius: 12px;
      border: none;
      font-weight: 800;
      font-size: 13.5px;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .btn-primary { background: #e10014; color: #ffffff; }
    .btn-secondary { background: #374151; color: #ffffff; }
    .steps { margin: 0; padding-left: 18px; color: #4b5563; font-size: 13px; line-height: 1.6; }
    .steps strong { color: #111827; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand-row">
      <div class="brand"><span class="brand-dot">⚡</span><span>PulseBets Android</span></div>
      <span class="sdk-pill">Expo Go SDK 52 · Hermes</span>
    </div>
    <span class="badge">● Prêt · Bundle Hermes SDK 52 actif 24h/24</span>
    <div class="qr-box">${qrSvg}</div>
    <div class="url-box" id="expoUrl">${permanentExpUrl}</div>
    <div class="actions">
      <a class="btn btn-primary" href="${permanentExpUrl}">Ouvrir dans Expo Go</a>
      <button class="btn btn-secondary" id="copyBtn" type="button">Copier l'URL exp://</button>
    </div>
    <ol class="steps">
      <li>Ouvrez <strong>Expo Go (SDK 52)</strong> sur votre Android.</li>
      <li>Scannez le <strong>QR Code</strong> ou appuyez sur <strong>« Enter URL manually »</strong> et collez <code>${permanentExpUrl}</code>.</li>
    </ol>
  </div>
  <script>
    document.getElementById("copyBtn").addEventListener("click", function () {
      var text = document.getElementById("expoUrl").textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
      this.textContent = "URL copiée ✓";
      var self = this;
      setTimeout(function () { self.textContent = "Copier l'URL exp://"; }, 1800);
    });
  </script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsed = new URL(req.url || "/", "http://localhost");
  const pathname = parsed.pathname;

  if (pathname === "/status") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("packager-status:running");
    return;
  }

  if (pathname.startsWith("/expo-sdk52/")) {
    const rel = pathname.slice("/expo-sdk52/".length);
    const safeDisk = path.resolve(PUBLIC_SDK52, rel);
    if (safeDisk.startsWith(PUBLIC_SDK52) && fs.existsSync(safeDisk) && fs.statSync(safeDisk).isFile()) {
      const buf = fs.readFileSync(safeDisk);
      const ext = path.extname(safeDisk).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME_MAP[ext] || "application/octet-stream",
        "Content-Length": buf.length,
        "Cache-Control": "public, max-age=31536000, immutable",
      });
      res.end(buf);
      return;
    }
  }

  const publicHost = resolvePublicHost(req);
  const scheme = publicHost.endsWith(".e2b.app") ? "https" : "http";
  const origin = `${scheme}://${publicHost}`;

  if (isExpoClient(req, pathname, parsed.searchParams)) {
    const reqProto = req.headers["expo-protocol-version"] === "1" ? "1" : "0";
    const manifest = buildSdk52Manifest(origin, publicHost);
    res.writeHead(200, {
      "Content-Type": "application/expo+json; charset=utf-8",
      "expo-protocol-version": reqProto,
      "expo-sfv-version": "0",
      "Cache-Control": "private, max-age=0",
    });
    res.end(JSON.stringify(manifest));
    return;
  }

  const html = await renderLauncherHtml();
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
});

server.listen(PORT, HOST, () => {
  console.log("==========================================================");
  console.log(" Serveur Expo Go SDK 52 (Android · Hermes) démarré !");
  console.log(` - Écoute locale    : http://${HOST}:${PORT}`);
  console.log(` - Aperçu Arena     : https://${DEFAULT_PUBLIC_HOST}`);
  console.log(` - Lien Expo Go 24/7: exp://be-plateform.vercel.app:443/api/expo`);
  console.log("==========================================================");
});
