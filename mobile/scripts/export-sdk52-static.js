#!/usr/bin/env node
/**
 * Exporte l'application Android pour Expo Go SDK 52 (Hermes `.hbc` + 12 assets)
 * via `@expo/cli` officiel (`npx expo export --platform android`), calcule les
 * empreintes SHA-256 base64url exigées par `expo-updates` SDK 52 (protocole v0/v1),
 * et publie les fichiers statiques dans `../public/expo-sdk52/` + `../src/lib/expo-sdk52-meta.json`.
 */

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const QRCode = require("qrcode");

const MOBILE_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(MOBILE_ROOT, "..");
const PUBLIC_OUT = path.join(REPO_ROOT, "public", "expo-sdk52");
const ASSETS_OUT = path.join(PUBLIC_OUT, "assets");
const META_FILE = path.join(REPO_ROOT, "src", "lib", "expo-sdk52-meta.json");

const MIME_BY_EXT = {
  ttf: "font/ttf",
  otf: "font/otf",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

function sha256Base64Url(buf) {
  return crypto.createHash("sha256").update(buf).digest("base64url");
}

// Les anciens bundles peuvent encore être demandés par des APK existantes.
// Un nom à empreinte ne doit jamais être écrasé par des octets différents.
function writeImmutable(file, data) {
  if (fs.existsSync(file)) {
    if (!fs.readFileSync(file).equals(data)) throw new Error(`Asset immuable différent : ${file}`);
    return;
  }
  fs.writeFileSync(file, data);
}

function md5ToUuidV4(hex) {
  const h = hex.toLowerCase().padEnd(32, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(
    17,
    20
  )}-${h.slice(20, 32)}`;
}

async function main() {
  const tmpExportDir = fs.mkdtempSync(path.join(os.tmpdir(), "expo-sdk52-"));
  try {
    console.log("[1/3] Compilation officielle Expo SDK 52 Android (Hermes .hbc)…");
    execFileSync(
      process.execPath,
      [
        path.join(MOBILE_ROOT, "node_modules", "expo", "bin", "cli"),
        "export",
        "--platform",
        "android",
        "--output-dir",
        tmpExportDir,
      ],
      {
        cwd: MOBILE_ROOT,
        stdio: "inherit",
        env: { ...process.env, EXPO_NO_TELEMETRY: "1", CI: "1" },
      }
    );

    const metadata = JSON.parse(
      fs.readFileSync(path.join(tmpExportDir, "metadata.json"), "utf8")
    );
    const androidMeta = metadata.fileMetadata && metadata.fileMetadata.android;
    if (!androidMeta || !androidMeta.bundle) {
      throw new Error("metadata.json Android invalide");
    }

    fs.mkdirSync(ASSETS_OUT, { recursive: true });

    console.log("[2/3] Calcul des empreintes SHA-256 base64url et copie des assets…");
    const bundleSrc = path.join(tmpExportDir, androidMeta.bundle);
    const bundleBuf = fs.readFileSync(bundleSrc);
    const bundleMd5 = crypto.createHash("md5").update(bundleBuf).digest("hex");
    const bundleSha256B64Url = sha256Base64Url(bundleBuf);
    const bundleExt = path.extname(androidMeta.bundle) || ".hbc";
    const bundleFileName = `AppEntry-${bundleMd5.slice(0, 12)}${bundleExt}`;
    writeImmutable(path.join(PUBLIC_OUT, bundleFileName), bundleBuf);

    const assetsManifest = [];
    for (const item of androidMeta.assets || []) {
      const assetSrc = path.join(tmpExportDir, item.path);
      const assetBuf = fs.readFileSync(assetSrc);
      const key = path.basename(item.path);
      const ext = String(item.ext || "").replace(/^\./, "");
      writeImmutable(path.join(ASSETS_OUT, key), assetBuf);

      assetsManifest.push({
        hash: sha256Base64Url(assetBuf),
        key,
        contentType: MIME_BY_EXT[ext] || "application/octet-stream",
        fileExtension: ext ? `.${ext}` : "",
        relativePath: `/expo-sdk52/assets/${key}`,
      });
    }

    for (const ic of [
      "icon.png",
      "adaptive-icon.png",
      "adaptive-icon-background.png",
      "monochrome-icon.png",
      "notification-icon.png",
      "splash-icon.png",
      "favicon.png",
      "feature-graphic.png",
    ]) {
      const srcAsset = path.join(MOBILE_ROOT, "assets", ic);
      if (fs.existsSync(srcAsset)) {
        fs.copyFileSync(srcAsset, path.join(PUBLIC_OUT, ic));
      }
    }

    const expoGoUrl = "exp://be-plateform.vercel.app:443/api/expo";
    const qrSvg = await QRCode.toString(expoGoUrl, {
      type: "svg",
      margin: 1,
      width: 248,
      color: { dark: "#111827", light: "#ffffff" },
    });

    const appJson = JSON.parse(
      fs.readFileSync(path.join(MOBILE_ROOT, "app.json"), "utf8")
    );
    const appExpo = appJson.expo || {};
    const appVersion = String(appExpo.version || "1.2.4");
    const versionCode = Number(appExpo.android?.versionCode || 7);
    const standaloneRuntimeVersion = String(
      appExpo.runtimeVersion || "pulse-sdk52-v1"
    );

    const createdAt = new Date().toISOString();
    const outMeta = {
      id: md5ToUuidV4(bundleMd5),
      createdAt,
      appVersion,
      versionCode,
      runtimeVersion: standaloneRuntimeVersion,
      expoGoRuntimeVersion: "exposdk:52.0.0",
      sdkVersion: "52.0.0",
      launchAsset: {
        hash: bundleSha256B64Url,
        key: bundleMd5,
        contentType: "application/javascript",
        fileExtension: bundleExt,
        relativePath: `/expo-sdk52/${bundleFileName}`,
      },
      assets: assetsManifest,
      qrSvg,
    };

    fs.writeFileSync(META_FILE, JSON.stringify(outMeta, null, 2) + "\n", "utf8");
    console.log(
      `[3/3] Export SDK 52 prêt : ${bundleFileName} (${(
        bundleBuf.length /
        1024 /
        1024
      ).toFixed(2)} Mo) + ${assetsManifest.length} assets.`
    );
  } finally {
    fs.rmSync(tmpExportDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
