import { NextRequest, NextResponse } from "next/server";
import sdk52Meta from "@/lib/expo-sdk52-meta.json";

const MULTIPART_BOUNDARY = "pulse-expo-ota-v1";
const STANDALONE_RUNTIME = sdk52Meta.runtimeVersion || "pulse-sdk52-v1";
const EXPO_GO_RUNTIME = sdk52Meta.expoGoRuntimeVersion || "exposdk:52.0.0";
const APP_VERSION = sdk52Meta.appVersion || "1.2.4";
const ANDROID_VERSION_CODE = sdk52Meta.versionCode || 7;

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

function buildMultipartResponse(
  parts: Array<{
    name: "manifest" | "extensions" | "directive";
    contentType: string;
    body: string;
  }>,
  protocolVersion: "0" | "1"
): NextResponse {
  const chunks: string[] = [];
  for (const part of parts) {
    chunks.push(
      `--${MULTIPART_BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="${part.name}"\r\n` +
        `Content-Type: ${part.contentType}\r\n` +
        `\r\n` +
        `${part.body}\r\n`
    );
  }
  chunks.push(`--${MULTIPART_BOUNDARY}--\r\n`);

  return new NextResponse(chunks.join(""), {
    status: 200,
    headers: {
      "Content-Type": `multipart/mixed; boundary=${MULTIPART_BOUNDARY}`,
      "expo-protocol-version": protocolVersion,
      "expo-sfv-version": "0",
      "expo-manifest-filters": "",
      "expo-server-defined-headers": "",
      "Cache-Control": "private, no-store, max-age=0",
      "CDN-Cache-Control": "private, no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function buildNoOpResponse(acceptMultipart: boolean): NextResponse {
  if (acceptMultipart) {
    return buildMultipartResponse(
      [
        {
          name: "directive",
          contentType: "application/json; charset=utf-8",
          body: JSON.stringify({ type: "noUpdateAvailable" }),
        },
      ],
      "1"
    );
  }
  return new NextResponse(null, {
    status: 204,
    headers: {
      "expo-protocol-version": "1",
      "expo-sfv-version": "0",
      "expo-manifest-filters": "",
      "expo-server-defined-headers": "",
      "Cache-Control": "private, no-store, max-age=0",
      "CDN-Cache-Control": "private, no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function GET(req: NextRequest) {
  const { origin, host, isHttps } = resolvePublicOrigin(req);

  if (isExpoUpdatesClient(req)) {
    const platform = (
      req.headers.get("expo-platform") ||
      req.headers.get("exponent-platform") ||
      req.nextUrl.searchParams.get("platform") ||
      "android"
    ).toLowerCase();

    if (platform !== "android" && platform !== "ios") {
      return NextResponse.json(
        { error: "Plateforme non prise en charge (android attendu)." },
        { status: 400 }
      );
    }

    const reqProtocol: "0" | "1" =
      req.headers.get("expo-protocol-version") === "1" ? "1" : "0";
    const updatesEnv = (
      req.headers.get("expo-updates-environment") || ""
    ).toUpperCase();
    const isBareStandalone = updatesEnv === "BARE";
    const requestedRuntime = (
      req.headers.get("expo-runtime-version") ||
      req.nextUrl.searchParams.get("runtime-version") ||
      ""
    ).trim();
    const acceptHeader = (req.headers.get("accept") || "").toLowerCase();
    const acceptsMultipart =
      acceptHeader.includes("multipart/mixed") &&
      req.nextUrl.searchParams.get("format") !== "json";

    // Vérification stricte de compatibilité du runtime natif pour les builds APK autonomes
    let effectiveRuntimeVersion = EXPO_GO_RUNTIME;
    if (requestedRuntime === STANDALONE_RUNTIME) {
      effectiveRuntimeVersion = STANDALONE_RUNTIME;
    } else if (
      requestedRuntime === EXPO_GO_RUNTIME ||
      requestedRuntime === "52.0.0" ||
      requestedRuntime === ""
    ) {
      effectiveRuntimeVersion = isBareStandalone
        ? STANDALONE_RUNTIME
        : EXPO_GO_RUNTIME;
    } else if (reqProtocol === "1") {
      // Un binaire natif d'une autre génération ne doit pas charger ce bundle SDK 52
      return buildNoOpResponse(acceptsMultipart);
    }

    // Si l'APK exécute déjà exactement cette mise à jour OTA, renvoyer noUpdateAvailable (protocole v1)
    const currentUpdateId = (
      req.headers.get("expo-current-update-id") || ""
    ).trim();
    if (
      reqProtocol === "1" &&
      currentUpdateId &&
      currentUpdateId.toLowerCase() === sdk52Meta.id.toLowerCase()
    ) {
      return buildNoOpResponse(acceptsMultipart);
    }

    const expoClientConfig = {
      name: "Pulse Bet",
      slug: "pulsebets-android",
      owner: "andyizyfleur",
      version: APP_VERSION,
      runtimeVersion: effectiveRuntimeVersion,
      sdkVersion: "52.0.0",
      platforms: ["android"],
      orientation: "portrait",
      primaryColor: "#e10014",
      userInterfaceStyle: "light",
      backgroundColor: "#090D16",
      jsEngine: "hermes",
      ...(isBareStandalone ? {} : { hostUri: `${host}/api/expo` }),
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
        versionCode: ANDROID_VERSION_CODE,
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
      updates: {
        enabled: true,
        url: `${origin}/api/expo`,
        checkAutomatically: "ALWAYS",
        fallbackToCacheTimeout: 0,
      },
      extra: {
        apiBaseUrl: origin,
        partykitHost: "pulse-bet.matiasanauld.workers.dev",
      },
    };

    const manifest = {
      id: sdk52Meta.id,
      createdAt: sdk52Meta.createdAt,
      runtimeVersion: effectiveRuntimeVersion,
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
        expoClient: expoClientConfig,
        ...(isBareStandalone
          ? {}
          : {
              expoGo: {
                debuggerHost: `${host}:443`,
                mainModuleName: "node_modules/expo/AppEntry",
                packagerOpts: {
                  dev: false,
                },
              },
            }),
        scopeKey: "@andyizyfleur/pulsebets-android",
      },
    };

    if (reqProtocol === "1" && isBareStandalone && acceptsMultipart) {
      return buildMultipartResponse(
        [
          {
            name: "manifest",
            contentType: "application/json; charset=utf-8",
            body: JSON.stringify(manifest),
          },
          {
            name: "extensions",
            contentType: "application/json",
            body: JSON.stringify({ assetRequestHeaders: {} }),
          },
        ],
        "1"
      );
    }

    return new NextResponse(JSON.stringify(manifest), {
      status: 200,
      headers: {
        "Content-Type": "application/expo+json; charset=utf-8",
        "expo-protocol-version": reqProtocol,
        "expo-sfv-version": "0",
        "expo-manifest-filters": "",
        "expo-server-defined-headers": "",
        "Cache-Control": "private, no-store, max-age=0",
        "CDN-Cache-Control": "private, no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  const expoUrl = isHttps
    ? `exp://${host}:443/api/expo`
    : `exp://${host}/api/expo`;
  const otaHttpsUrl = `${origin}/api/expo`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pulse Bet Android · Serveur OTA expo-updates &amp; Expo Go SDK 52</title>
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
      padding: 16px;
    }
    .card {
      width: 100%;
      max-width: 520px;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 20px;
      padding: 20px;
      box-shadow: 0 12px 32px rgba(17, 24, 39, 0.07);
    }
    .brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 17px;
      letter-spacing: -0.3px;
    }
    .sdk-pill {
      background: #fef2f2;
      color: #e10014;
      border: 1px solid #fecaca;
      font-size: 11px;
      font-weight: 500;
      padding: 4px 9px;
      border-radius: 999px;
    }
    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 500;
      padding: 4px 10px;
      border-radius: 999px;
      margin-bottom: 14px;
      background: #dcfce7;
      color: #15803d;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 14px;
    }
    .meta-cell {
      background: #f8fafc;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 8px 10px;
    }
    .meta-label {
      font-size: 10px;
      color: #6b7280;
      margin-bottom: 2px;
    }
    .meta-val {
      font-size: 11.5px;
      font-weight: 500;
      color: #111827;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      word-break: break-all;
    }
    .qr-box {
      width: 244px;
      height: 244px;
      margin: 4px auto 14px;
      padding: 10px;
      border-radius: 16px;
      border: 1px solid #e5e7eb;
      background: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .qr-box svg { width: 100%; height: 100%; display: block; }
    .url-box {
      background: #f1f3f5;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 9px 11px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11.5px;
      word-break: break-all;
      color: #111827;
      margin-bottom: 10px;
    }
    .actions {
      display: flex;
      gap: 8px;
      margin-bottom: 14px;
    }
    .btn {
      flex: 1;
      height: 38px;
      border-radius: 10px;
      border: none;
      font-weight: 500;
      font-size: 12px;
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
      padding-left: 16px;
      color: #4b5563;
      font-size: 12px;
      line-height: 1.55;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand-row">
      <div class="brand">
        <img src="/expo-sdk52/icon.png" alt="Pulse Bet" style="width:28px;height:28px;border-radius:7px;display:block;" />
        <span>PULSE <span style="background:#e10014;color:#fff;padding:2px 6px;border-radius:5px;font-size:11px;font-style:italic;vertical-align:middle;">BET</span></span>
      </div>
      <span class="sdk-pill">OTA v1 · SDK 52 Hermes</span>
    </div>

    <span class="badge">● Mises à jour OTA automatiques actives 24h/24 (v${APP_VERSION})</span>

    <div class="meta-grid">
      <div class="meta-cell">
        <div class="meta-label">Runtime APK</div>
        <div class="meta-val">${STANDALONE_RUNTIME}</div>
      </div>
      <div class="meta-cell">
        <div class="meta-label">Bundle OTA actif</div>
        <div class="meta-val">#${sdk52Meta.id.slice(0, 8)}</div>
      </div>
      <div class="meta-cell">
        <div class="meta-label">Endpoint expo-updates</div>
        <div class="meta-val">${otaHttpsUrl}</div>
      </div>
      <div class="meta-cell">
        <div class="meta-label">Publié le</div>
        <div class="meta-val">${sdk52Meta.createdAt.slice(0, 19).replace("T", " ")} UTC</div>
      </div>
    </div>

    <div class="qr-box">${sdk52Meta.qrSvg}</div>

    <div class="url-box" id="expoUrl">${expoUrl}</div>

    <div class="actions">
      <a class="btn btn-primary" href="${expoUrl}">Ouvrir dans Expo Go</a>
      <button class="btn btn-secondary" id="copyBtn" type="button">Copier l'URL exp://</button>
    </div>

    <ol class="steps">
      <li>Les APK Android compilés avec <strong>expo-updates</strong> (runtime <code>${STANDALONE_RUNTIME}</code>) téléchargent automatiquement chaque nouvelle version depuis <code>${otaHttpsUrl}</code>.</li>
      <li>Sur <strong>Expo Go SDK 52</strong>, scannez le QR Code ci-dessus ou collez <code>${expoUrl}</code>.</li>
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
