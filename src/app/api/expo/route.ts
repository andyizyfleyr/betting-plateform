import { NextRequest, NextResponse } from "next/server";
import sdk52Meta from "@/lib/expo-sdk52-meta.json";

function resolvePublicOrigin(req: NextRequest): {
  origin: string;
  host: string;
  isHttps: boolean;
} {
  const xfHost = req.headers.get("x-forwarded-host");
  const rawHost =
    xfHost?.split(",")[0]?.trim() ||
    req.headers.get("host")?.trim() ||
    "be-plateform.vercel.app";
  const cleanHost = rawHost.replace(/:443$/, "");
  const xfProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const isHttps =
    cleanHost.endsWith(".vercel.app") ||
    cleanHost.endsWith(".e2b.app") ||
    xfProto === "https" ||
    req.nextUrl.protocol === "https:";
  const scheme = isHttps ? "https" : "http";
  return {
    origin: `${scheme}://${cleanHost}`,
    host: cleanHost,
    isHttps,
  };
}

function isExpoUpdatesClient(req: NextRequest): boolean {
  const sp = req.nextUrl.searchParams;
  if (sp.get("format") === "json" || sp.get("platform") === "android") {
    return true;
  }

  const h = req.headers;
  if (
    h.get("expo-platform") ||
    h.get("exponent-platform") ||
    h.get("expo-protocol-version") ||
    h.get("expo-runtime-version") ||
    h.get("expo-sdk-version") ||
    h.get("exponent-sdk-version") ||
    h.get("expo-updates-environment") ||
    h.get("eas-client-id")
  ) {
    return true;
  }

  const ua = (h.get("user-agent") || "").toLowerCase();
  if (ua.includes("okhttp") || ua.includes("exponent") || ua.includes("expo")) {
    return true;
  }

  const accept = (h.get("accept") || "").toLowerCase();
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

export async function GET(req: NextRequest) {
  const { origin, host, isHttps } = resolvePublicOrigin(req);

  if (isExpoUpdatesClient(req)) {
    const reqProtocol = req.headers.get("expo-protocol-version") === "1" ? "1" : "0";
    const manifest = {
      id: sdk52Meta.id,
      createdAt: sdk52Meta.createdAt,
      runtimeVersion: sdk52Meta.runtimeVersion,
      launchAsset: {
        hash: sdk52Meta.launchAsset.hash,
        key: sdk52Meta.launchAsset.key,
        contentType: sdk52Meta.launchAsset.contentType,
        fileExtension: sdk52Meta.launchAsset.fileExtension,
        url: `${origin}${sdk52Meta.launchAsset.relativePath}`,
      },
      assets: sdk52Meta.assets.map((asset) => ({
        hash: asset.hash,
        key: asset.key,
        contentType: asset.contentType,
        fileExtension: asset.fileExtension,
        url: `${origin}${asset.relativePath}`,
      })),
      metadata: {},
      extra: {
        eas: {},
        expoClient: {
          name: "Pulse Bet",
          slug: "pulsebets-android",
          version: "1.1.0",
          sdkVersion: "52.0.0",
          platforms: ["android"],
          orientation: "portrait",
          primaryColor: "#e10014",
          userInterfaceStyle: "light",
          backgroundColor: "#090D16",
          jsEngine: "hermes",
          hostUri: `${host}/api/expo`,
          icon: "./assets/icon.png",
          iconUrl: `${origin}/expo-sdk52/icon.png`,
          notification: {
            icon: "./assets/notification-icon.png",
            color: "#e10014",
            iconUrl: `${origin}/expo-sdk52/notification-icon.png`,
          },
          splash: {
            image: "./assets/splash-icon.png",
            resizeMode: "contain",
            backgroundColor: "#090D16",
            imageUrl: `${origin}/expo-sdk52/splash-icon.png`,
          },
          android: {
            package: "app.pulsebets.android",
            versionCode: 2,
            backgroundColor: "#090D16",
            adaptiveIcon: {
              foregroundImage: "./assets/adaptive-icon.png",
              backgroundImage: "./assets/adaptive-icon-background.png",
              monochromeImage: "./assets/monochrome-icon.png",
              backgroundColor: "#e10014",
              foregroundImageUrl: `${origin}/expo-sdk52/adaptive-icon.png`,
              backgroundImageUrl: `${origin}/expo-sdk52/adaptive-icon-background.png`,
              monochromeImageUrl: `${origin}/expo-sdk52/monochrome-icon.png`,
            },
          },
          extra: {
            apiBaseUrl: origin,
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

    return new NextResponse(JSON.stringify(manifest), {
      status: 200,
      headers: {
        "Content-Type": "application/expo+json; charset=utf-8",
        "expo-protocol-version": reqProtocol,
        "expo-sfv-version": "0",
        "Cache-Control": "private, max-age=0",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  const expoUrl = isHttps
    ? `exp://${host}:443/api/expo`
    : `exp://${host}/api/expo`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pulse Bet Android · Expo Go SDK 52 (24h/24)</title>
  <link rel="icon" type="image/png" href="/expo-sdk52/favicon.png" />
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
    .btn-primary { background: #e10014; color: #ffffff; }
    .btn-secondary { background: #374151; color: #ffffff; }
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
        <img src="/expo-sdk52/icon.png" alt="Pulse Bet" style="width:32px;height:32px;border-radius:8px;display:block;" />
        <span>PULSE <span style="background:#e10014;color:#fff;padding:2px 6px;border-radius:6px;font-size:12px;font-style:italic;vertical-align:middle;">BET</span></span>
      </div>
      <span class="sdk-pill">Expo Go SDK 52 · Hermes</span>
    </div>

    <span class="badge">● En ligne 24h/24 · Compatible Supported version 52</span>

    <div class="qr-box">${sdk52Meta.qrSvg}</div>

    <div class="url-box" id="expoUrl">${expoUrl}</div>

    <div class="actions">
      <a class="btn btn-primary" href="${expoUrl}">Ouvrir dans Expo Go</a>
      <button class="btn btn-secondary" id="copyBtn" type="button">Copier l'URL exp://</button>
    </div>

    <ol class="steps">
      <li>Ouvrez <strong>Expo Go (Supported version 52)</strong> sur votre Android.</li>
      <li>Scannez le <strong>QR Code</strong> ci-dessus ou appuyez sur <strong>« Enter URL manually »</strong> et collez <code>${expoUrl}</code>.</li>
      <li>Le bundle Hermes SDK 52 et les assets sont servis en permanence 24h/24.</li>
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
      setTimeout(function () { self.textContent = "Copier l'URL exp://"; }, 1800);
    });
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
