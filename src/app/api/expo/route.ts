import { NextRequest, NextResponse } from "next/server";
import sdk42Meta from "@/lib/expo-sdk42-meta.json";

export const runtime = "edge";

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
  const xfProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const isHttps =
    rawHost.endsWith(".vercel.app") ||
    rawHost.endsWith(".e2b.app") ||
    xfProto === "https" ||
    req.nextUrl.protocol === "https:";
  const scheme = isHttps ? "https" : "http";
  return {
    origin: `${scheme}://${rawHost}`,
    host: rawHost,
    isHttps,
  };
}

function isExpoGoClient(req: NextRequest): boolean {
  const sp = req.nextUrl.searchParams;
  if (sp.get("format") === "json" || sp.get("platform") === "android") {
    return true;
  }

  const h = req.headers;
  if (
    h.get("expo-platform") ||
    h.get("exponent-platform") ||
    h.get("expo-sdk-version") ||
    h.get("exponent-sdk-version") ||
    h.get("expo-updates-environment") ||
    h.get("expo-accept-signature") ||
    h.get("exponent-accept-signature")
  ) {
    return true;
  }

  const ua = (h.get("user-agent") || "").toLowerCase();
  if (ua.includes("okhttp") || ua.includes("exponent") || ua.includes("expo")) {
    return true;
  }

  const accept = (h.get("accept") || "").toLowerCase();
  if (
    (accept.includes("application/expo+json") ||
      accept.includes("application/json")) &&
    !accept.includes("text/html")
  ) {
    return true;
  }

  return false;
}

export async function GET(req: NextRequest) {
  const { origin, host, isHttps } = resolvePublicOrigin(req);

  if (isExpoGoClient(req)) {
    const manifest = {
      name: "PulseBets",
      slug: "pulsebets-android",
      version: "1.0.0",
      sdkVersion: "42.0.0",
      platforms: ["android"],
      orientation: "portrait",
      primaryColor: "#e10014",
      userInterfaceStyle: "light",
      backgroundColor: "#f4f5f7",
      id: "@anonymous/pulsebets-android",
      scopeKey: "@anonymous/pulsebets-android",
      releaseId: sdk42Meta.releaseId,
      revisionId: sdk42Meta.revisionId,
      commitTime: sdk42Meta.commitTime,
      publishedTime: sdk42Meta.publishedTime,
      bundleUrl: `${origin}${sdk42Meta.bundlePath}`,
      bundleKey: sdk42Meta.bundleKey,
      bundledAssets: sdk42Meta.bundledAssets,
      assetUrlOverride: "/expo-sdk42/assets",
      icon: "./assets/icon.png",
      iconUrl: `${origin}/expo-sdk42/icon.png`,
      splash: {
        image: "./assets/splash-icon.png",
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        imageUrl: `${origin}/expo-sdk42/splash-icon.png`,
      },
      android: {
        package: "app.pulsebets.android",
        versionCode: 1,
        adaptiveIcon: {
          foregroundImage: "./assets/adaptive-icon.png",
          backgroundColor: "#e10014",
          foregroundImageUrl: `${origin}/expo-sdk42/adaptive-icon.png`,
        },
      },
      extra: {
        apiBaseUrl: origin,
      },
    };

    return new NextResponse(JSON.stringify(manifest), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  const expoUrl = `${isHttps ? "exps" : "exp"}://${host}/api/expo`;
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PulseBets Android · Expo Go SDK 42 (24h/24)</title>
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
        <span class="brand-dot">⚡</span>
        <span>PulseBets Android</span>
      </div>
      <span class="sdk-pill">Expo Go SDK 42 · 24h/24</span>
    </div>

    <span class="badge">● En ligne en permanence 24h/24 (aucune expiration de sandbox)</span>

    <div class="qr-box">${sdk42Meta.qrSvg}</div>

    <div class="url-box" id="expoUrl">${expoUrl}</div>

    <div class="actions">
      <a class="btn btn-primary" href="${expoUrl}">Ouvrir dans Expo Go</a>
      <button class="btn btn-secondary" id="copyBtn" type="button">Copier l'URL exps://</button>
    </div>

    <ol class="steps">
      <li>Ouvrez <strong>Expo Go (SDK 42)</strong> sur votre téléphone Android.</li>
      <li>Scannez le <strong>QR Code</strong> ci-dessus ou appuyez sur <strong>« Enter URL manually »</strong> et collez <code>${expoUrl}</code>.</li>
      <li>Ce lien permanent ne s'éteint jamais (0 erreur <code>502</code> ni <code>Remote update request not successful</code>).</li>
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

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
