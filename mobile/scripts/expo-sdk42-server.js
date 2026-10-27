#!/usr/bin/env node
/**
 * Serveur Expo Go SDK 42 (Android) + Metro Bundler unifié sur `0.0.0.0:8081` :
 * - Sert le Manifeste Classique JSON Expo SDK 42 (`sdkVersion: "42.0.0"`) aux clients
 *   Android Expo Go (`exps://...` / `https://...`).
 * - Sert une page d'accueil HTML interactive avec QR Code SVG et lien `exps://` dans
 *   l'aperçu navigateur Arena.
 * - Embarque directement le middleware Metro (`@expo/metro-config` + `metro@0.64`) pour
 *   servir `node_modules/expo/AppEntry.bundle` et tous les assets (`/assets/...`).
 * - Pré-compile automatiquement le bundle Android en RAM dès le démarrage pour une
 *   ouverture quasi instantanée (< 1 s) sur téléphone Android.
 */

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

if (!String(process.env.NODE_OPTIONS || "").includes("--openssl-legacy-provider")) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ""} --openssl-legacy-provider`.trim();
}

const origCreateHash = crypto.createHash;
crypto.createHash = function patchedCreateHash(algorithm, options) {
  return origCreateHash.call(
    this,
    algorithm === "md4" ? "md5" : algorithm,
    options
  );
};

const Metro = require("metro");
const QRCode = require("qrcode");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8081);
const HOST = "0.0.0.0";
const SANDBOX_ID = process.env.E2B_SANDBOX_ID || "";
const DEFAULT_PUBLIC_HOST = SANDBOX_ID
  ? `${PORT}-${SANDBOX_ID}.e2b.app`
  : `localhost:${PORT}`;

const appJson = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, "app.json"), "utf8")
);
const expoConfig = appJson.expo || {};

let bundleWarmStatus = "warming";
let bundleWarmBytes = 0;
let bundleWarmMs = 0;
let bundleWarmError = null;

function resolvePublicHost(req) {
  const xfHost = req.headers["x-forwarded-host"];
  const rawHost =
    (Array.isArray(xfHost) ? xfHost[0] : xfHost) ||
    req.headers.host ||
    DEFAULT_PUBLIC_HOST;
  const cleanHost = String(rawHost).split(",")[0].trim();
  if (
    (cleanHost.startsWith("127.0.0.1") || cleanHost.startsWith("localhost")) &&
    SANDBOX_ID
  ) {
    return DEFAULT_PUBLIC_HOST;
  }
  return cleanHost;
}

function resolvePublicScheme(req, publicHost) {
  if (publicHost.endsWith(".e2b.app")) return "https";
  const xfProto = req.headers["x-forwarded-proto"];
  if (xfProto) {
    return String(Array.isArray(xfProto) ? xfProto[0] : xfProto)
      .split(",")[0]
      .trim();
  }
  return "http";
}

function isExpoGoManifestRequest(req, pathname, searchParams) {
  if (pathname === "/manifest" || pathname === "/index.exp") return true;
  if (pathname !== "/") return false;
  if (searchParams.get("format") === "json") return true;
  if (searchParams.get("platform") === "android") return true;

  const h = req.headers;
  if (
    h["exponent-platform"] ||
    h["expo-platform"] ||
    h["exponent-sdk-version"] ||
    h["expo-sdk-version"] ||
    h["exponent-accept-signature"]
  ) {
    return true;
  }

  const ua = String(h["user-agent"] || "").toLowerCase();
  if (ua.includes("okhttp") || ua.includes("exponent") || ua.includes("expo")) {
    return true;
  }

  const accept = String(h.accept || "").toLowerCase();
  if (
    (accept.includes("application/expo+json") ||
      accept.includes("application/json")) &&
    !accept.includes("text/html")
  ) {
    return true;
  }

  return false;
}

function buildSdk42Manifest(publicOrigin, publicHost) {
  return {
    ...expoConfig,
    name: expoConfig.name || "PulseBets",
    slug: expoConfig.slug || "pulsebets-android",
    version: expoConfig.version || "1.0.0",
    sdkVersion: "42.0.0",
    platforms: ["android"],
    orientation: "portrait",
    primaryColor: "#e10014",
    icon: "./assets/icon.png",
    iconUrl: `${publicOrigin}/__expo_static/icon.png`,
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
      imageUrl: `${publicOrigin}/__expo_static/splash-icon.png`,
    },
    android: {
      ...(expoConfig.android || {}),
      package: "app.pulsebets.android",
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#e10014",
        foregroundImageUrl: `${publicOrigin}/__expo_static/adaptive-icon.png`,
      },
    },
    extra: {
      apiBaseUrl: "https://be-plateform.vercel.app",
      ...(expoConfig.extra || {}),
    },
    id: `@anonymous/${expoConfig.slug || "pulsebets-android"}`,
    revisionId: `1.0.0-${Date.now()}`,
    loadedFromCache: false,
    isVerified: true,
    mainModuleName: "node_modules/expo/AppEntry",
    debuggerHost: publicHost,
    hostUri: publicHost,
    logUrl: `${publicOrigin}/logs`,
    bundleUrl: `${publicOrigin}/node_modules/expo/AppEntry.bundle?platform=android&dev=false&minify=false`,
    developer: {
      tool: "expo-cli",
      projectRoot: PROJECT_ROOT,
    },
    packagerOpts: {
      dev: false,
      minify: false,
      https: publicOrigin.startsWith("https://"),
    },
    env: {},
  };
}

async function renderBrowserLauncherHtml(publicOrigin, publicHost) {
  const isHttps = publicOrigin.startsWith("https://");
  const expoUrl = `${isHttps ? "exps" : "exp"}://${publicHost}`;
  const qrSvg = await QRCode.toString(expoUrl, {
    type: "svg",
    margin: 1,
    width: 248,
    color: {
      dark: "#111827",
      light: "#ffffff",
    },
  });

  const statusBadge =
    bundleWarmStatus === "ready"
      ? `<span class="badge ok">● Bundle Android prêt (${(bundleWarmBytes / 1024 / 1024).toFixed(2)} Mo · ${(bundleWarmMs / 1000).toFixed(1)} s)</span>`
      : bundleWarmStatus === "error"
      ? `<span class="badge err">● Erreur Metro : ${String(bundleWarmError || "").slice(0, 120)}</span>`
      : `<span class="badge warm">● Pré-compilation Metro Android en cours…</span>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PulseBets Android · Serveur Expo Go SDK 42</title>
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
      letter-spacing: -0.4px;
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
    }
    .badge.ok { background: #dcfce7; color: #15803d; }
    .badge.warm { background: #fef3c7; color: #b45309; }
    .badge.err { background: #fee2e2; color: #dc2626; }
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
    .actions {
      display: flex;
      gap: 8px;
      margin-bottom: 18px;
    }
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
    .btn-primary {
      background: #e10014;
      color: #ffffff;
    }
    .btn-secondary {
      background: #374151;
      color: #ffffff;
    }
    .steps {
      margin: 0;
      padding-left: 18px;
      color: #4b5563;
      font-size: 13px;
      line-height: 1.6;
    }
    .steps strong { color: #111827; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand-row">
      <div class="brand">
        <span class="brand-dot">⚡</span>
        <span>PulseBets Android</span>
      </div>
      <span class="sdk-pill">Expo Go SDK 42 · Android</span>
    </div>

    ${statusBadge}

    <div class="qr-box">${qrSvg}</div>

    <div class="url-box" id="expoUrl">${expoUrl}</div>

    <div class="actions">
      <a class="btn btn-primary" href="${expoUrl}">Ouvrir dans Expo Go</a>
      <button class="btn btn-secondary" id="copyBtn" type="button">Copier l'URL exps://</button>
    </div>

    <ol class="steps">
      <li>Ouvrez <strong>Expo Go (SDK 42)</strong> sur votre téléphone Android.</li>
      <li>Scannez le <strong>QR Code</strong> ci-dessus ou appuyez sur <strong>« Enter URL manually »</strong> et collez <code>${expoUrl}</code>.</li>
      <li>L'application se connecte directement aux APIs live <strong>be-plateform.vercel.app</strong>.</li>
    </ol>
  </div>
  <script>
    document.getElementById("copyBtn").addEventListener("click", function () {
      var text = document.getElementById("expoUrl").textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      }
      this.textContent = "URL copiée ✓";
      var self = this;
      setTimeout(function () { self.textContent = "Copier l'URL exps://"; }, 1800);
    });
  </script>
</body>
</html>`;
}

async function main() {
  process.chdir(PROJECT_ROOT);

  const metroConfig = await Metro.loadConfig({
    cwd: PROJECT_ROOT,
    config: path.join(PROJECT_ROOT, "metro.config.js"),
  });

  const { middleware, websocketEndpoints } =
    await Metro.createConnectMiddleware(metroConfig);

  const staticFiles = {
    "icon.png": path.join(PROJECT_ROOT, "assets", "icon.png"),
    "adaptive-icon.png": path.join(PROJECT_ROOT, "assets", "adaptive-icon.png"),
    "splash-icon.png": path.join(PROJECT_ROOT, "assets", "splash-icon.png"),
  };

  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS, HEAD"
      );
      res.setHeader("Access-Control-Allow-Headers", "*");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const rawUrl = req.url || "/";
      const parsed = new URL(rawUrl, "http://localhost");
      const pathname = parsed.pathname;

      if (pathname === "/status") {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("packager-status:running");
        return;
      }

      if (pathname === "/logs" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          if (body.length < 32_000) body += chunk.toString("utf8");
        });
        req.on("end", () => {
          if (body) {
            console.log("[ExpoGo Android Log]", body.slice(0, 1000));
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      if (pathname.startsWith("/__expo_static/")) {
        const name = pathname.slice("/__expo_static/".length);
        const diskPath = staticFiles[name];
        if (diskPath && fs.existsSync(diskPath)) {
          const buf = fs.readFileSync(diskPath);
          res.writeHead(200, {
            "Content-Type": "image/png",
            "Content-Length": buf.length,
            "Cache-Control": "public, max-age=3600",
          });
          res.end(buf);
          return;
        }
      }

      const publicHost = resolvePublicHost(req);
      const scheme = resolvePublicScheme(req, publicHost);
      const publicOrigin = `${scheme}://${publicHost}`;

      if (isExpoGoManifestRequest(req, pathname, parsed.searchParams)) {
        const manifest = buildSdk42Manifest(publicOrigin, publicHost);
        const payload = JSON.stringify(manifest);
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Exponent-Server": "expo-sdk42",
          "Cache-Control": "no-store",
        });
        res.end(payload);
        return;
      }

      if (pathname === "/") {
        const html = await renderBrowserLauncherHtml(publicOrigin, publicHost);
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(html);
        return;
      }

      if (pathname.endsWith(".webp")) {
        res.setHeader("Content-Type", "image/webp");
      }

      middleware(req, res, (err) => {
        if (err) {
          console.error("[Metro Middleware Error]", err);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          }
          res.end(String(err.message || err));
          return;
        }
        if (!res.headersSent) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not Found");
        }
      });
    } catch (err) {
      console.error("[Server Request Error]", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      res.end("Internal Server Error");
    }
  });

  if (websocketEndpoints && typeof websocketEndpoints === "object") {
    server.on("upgrade", (req, socket, head) => {
      const parsed = new URL(req.url || "/", "http://localhost");
      const wsServer = websocketEndpoints[parsed.pathname];
      if (wsServer && typeof wsServer.handleUpgrade === "function") {
        wsServer.handleUpgrade(req, socket, head, (ws) => {
          wsServer.emit("connection", ws, req);
        });
      } else {
        socket.destroy();
      }
    });
  }

  server.listen(PORT, HOST, () => {
    const publicUrl = SANDBOX_ID
      ? `https://${DEFAULT_PUBLIC_HOST}`
      : `http://localhost:${PORT}`;
    const expoDeepLink = SANDBOX_ID
      ? `exps://${DEFAULT_PUBLIC_HOST}`
      : `exp://localhost:${PORT}`;

    console.log("==========================================================");
    console.log(" Serveur Expo Go SDK 42 (Android) démarré !");
    console.log(` - Écoute locale : http://${HOST}:${PORT}`);
    console.log(` - Aperçu Web    : ${publicUrl}`);
    console.log(` - Lien Expo Go  : ${expoDeepLink}`);
    console.log("==========================================================");

    // Pré-chauffage immédiat du bundle Android en mémoire RAM
    const t0 = Date.now();
    http
      .get(
        `http://127.0.0.1:${PORT}/node_modules/expo/AppEntry.bundle?platform=android&dev=false&minify=false`,
        (warmRes) => {
          let bytes = 0;
          let errPreview = "";
          warmRes.on("data", (chunk) => {
            bytes += chunk.length;
            if (warmRes.statusCode !== 200 && errPreview.length < 1500) {
              errPreview += chunk.toString("utf8");
            }
          });
          warmRes.on("end", () => {
            bundleWarmMs = Date.now() - t0;
            bundleWarmBytes = bytes;
            if (warmRes.statusCode === 200) {
              bundleWarmStatus = "ready";
              console.log(
                `[Metro Ready] Bundle Android SDK 42 pré-compilé en ${bundleWarmMs} ms (${(
                  bytes /
                  1024 /
                  1024
                ).toFixed(2)} Mo)`
              );
            } else {
              bundleWarmStatus = "error";
              bundleWarmError = errPreview || `HTTP ${warmRes.statusCode}`;
              console.error(
                `[Metro Warmup Error] HTTP ${warmRes.statusCode}:`,
                bundleWarmError
              );
            }
          });
        }
      )
      .on("error", (err) => {
        bundleWarmStatus = "error";
        bundleWarmError = err.message;
        console.error("[Metro Warmup Request Error]", err);
      });
  });
}

main().catch((err) => {
  console.error("Impossible de démarrer le serveur Expo SDK 42 :", err);
  process.exit(1);
});
