#!/usr/bin/env node
/**
 * Exporte le bundle Android minifié Expo SDK 42 et ses assets binaires hachés
 * dans `../public/expo-sdk42/` + métadonnées dans `../src/lib/expo-sdk42-meta.json`
 * afin que `exps://be-plateform.vercel.app/api/expo` fonctionne 24h/24 et 7j/7
 * sur Expo Go SDK 42 (Android), sans dépendre de la mise en veille du sandbox.
 */

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const QRCode = require("qrcode");

const MOBILE_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(MOBILE_ROOT, "..");
const OUT_DIR = path.join(REPO_ROOT, "public", "expo-sdk42");
const ASSETS_OUT_DIR = path.join(OUT_DIR, "assets");
const META_OUT_FILE = path.join(REPO_ROOT, "src", "lib", "expo-sdk42-meta.json");
const METRO_PORT = Number(process.env.PORT || 8081);

function fetchLocal(urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: METRO_PORT, path: urlPath }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode !== 200) {
            reject(
              new Error(
                `HTTP ${res.statusCode} sur ${urlPath}: ${buf
                  .toString("utf8")
                  .slice(0, 500)}`
              )
            );
            return;
          }
          resolve(buf);
        });
      })
      .on("error", reject);
  });
}

function md5ToUuidV4(md5Hex) {
  const h = md5Hex.toLowerCase().padEnd(32, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(
    17,
    20
  )}-${h.slice(20, 32)}`;
}

async function run() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(ASSETS_OUT_DIR, { recursive: true });

  console.log("[1/3] Compilation du bundle Android minifié (ES6 / JSC SDK 42)…");
  const bundleBuf = await fetchLocal(
    "/node_modules/expo/AppEntry.bundle?platform=android&dev=false&minify=true"
  );
  const bundleKey = crypto.createHash("md5").update(bundleBuf).digest("hex");
  const bundleFilename = `bundle-android-${bundleKey.slice(0, 10)}.js`;
  fs.writeFileSync(path.join(OUT_DIR, bundleFilename), bundleBuf);

  console.log("[2/3] Extraction des assets binaires Metro…");
  const assetsRaw = await fetchLocal(
    "/node_modules/expo/AppEntry.assets?platform=android&dev=false&minify=true"
  );
  const assetsList = JSON.parse(assetsRaw.toString("utf8"));

  const bundledAssets = [];
  for (const asset of assetsList) {
    const srcFile = asset.files && asset.files[0];
    if (!srcFile || !fs.existsSync(srcFile)) {
      throw new Error(`Fichier asset introuvable : ${srcFile}`);
    }
    const hash = asset.hash;
    const ext = asset.type || "";
    fs.copyFileSync(srcFile, path.join(ASSETS_OUT_DIR, hash));
    bundledAssets.push(ext ? `asset_${hash}.${ext}` : `asset_${hash}`);
  }

  for (const iconName of ["icon.png", "adaptive-icon.png", "splash-icon.png"]) {
    fs.copyFileSync(
      path.join(MOBILE_ROOT, "assets", iconName),
      path.join(OUT_DIR, iconName)
    );
  }

  const commitTime = new Date().toISOString();
  const releaseId = md5ToUuidV4(bundleKey);
  const permanentExpsUrl = "exps://be-plateform.vercel.app/api/expo";
  const qrSvg = await QRCode.toString(permanentExpsUrl, {
    type: "svg",
    margin: 1,
    width: 248,
    color: {
      dark: "#111827",
      light: "#ffffff",
    },
  });

  const meta = {
    releaseId,
    revisionId: `1.0.0-${bundleKey.slice(0, 8)}`,
    commitTime,
    publishedTime: commitTime,
    bundleKey,
    bundlePath: `/expo-sdk42/${bundleFilename}`,
    bundledAssets,
    qrSvg,
  };

  fs.writeFileSync(META_OUT_FILE, JSON.stringify(meta, null, 2) + "\n", "utf8");
  console.log(
    `[3/3] Export terminé : ${bundleFilename} (${(
      bundleBuf.length /
      1024 /
      1024
    ).toFixed(2)} Mo) + ${bundledAssets.length} assets -> public/expo-sdk42/`
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
