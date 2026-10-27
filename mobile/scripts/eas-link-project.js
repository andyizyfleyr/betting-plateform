#!/usr/bin/env node
/**
 * Hook `eas-build-pre-install` exécuté sur les workers Expo EAS Build :
 * lie automatiquement `app.json` à `EAS_BUILD_PROJECT_ID` (ou via `eas init`)
 * afin que `eas build:internal` en mode `--non-interactive` résolve toujours `extra.eas.projectId`.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const appJsonPath = path.resolve(__dirname, "..", "app.json");
const raw = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
const existingId = raw?.expo?.extra?.eas?.projectId;

if (typeof existingId === "string" && UUID_RE.test(existingId)) {
  console.log(`[eas-link-project] Project already linked (${existingId}).`);
  process.exit(0);
}

const envId = (
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
  process.env.EAS_PROJECT_ID ||
  process.env.EAS_BUILD_PROJECT_ID ||
  ""
).trim();

if (UUID_RE.test(envId)) {
  raw.expo = raw.expo || {};
  raw.expo.owner = raw.expo.owner || "andyizyfleur";
  raw.expo.extra = raw.expo.extra || {};
  raw.expo.extra.eas = { ...(raw.expo.extra.eas || {}), projectId: envId };
  fs.writeFileSync(appJsonPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  console.log(`[eas-link-project] Linked app.json to EAS project ${envId}.`);
  process.exit(0);
}

try {
  execFileSync(
    "eas",
    ["init", "--account", "andyizyfleur", "--force", "--non-interactive"],
    {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
    }
  );
} catch (err) {
  console.warn(
    "[eas-link-project] Automatic eas init skipped:",
    err instanceof Error ? err.message : String(err)
  );
}
