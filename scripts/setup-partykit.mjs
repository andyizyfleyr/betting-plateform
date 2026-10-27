#!/usr/bin/env node
/**
 * Script clé en main (`npm run party:setup`) pour connecter et déployer PartyKit en 1 seule commande :
 *  1. Lance `npx partykit login` (ouverture automatique du navigateur OAuth GitHub/Cloudflare).
 *  2. Génère automatiquement un `PARTYKIT_SECRET` cryptographique 256 bits (ou réutilise celui de `.env.local`).
 *  3. Déploie `party/index.ts` avec `PARTYKIT_SECRET` et `APP_URL` injectés en une seule passe (`--var`).
 *  4. Extrait l'URL publique `pulse-bet.<pseudo>.partykit.dev`, sauvegarde dans `.env.local` et affiche
 *     les 2 lignes prêtes à coller dans Vercel -> Settings -> Environment Variables.
 */

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_LOCAL_PATH = path.join(ROOT, ".env.local");
const DEFAULT_APP_URL = process.env.APP_URL?.trim() || "https://be-plateform.vercel.app";

function readExistingEnvVar(filePath, key) {
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    if (k === key) {
      return trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
    }
  }
  return null;
}

function upsertEnvVars(filePath, entries) {
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  for (const [key, value] of Object.entries(entries)) {
    if (!value) continue;
    const regex = new RegExp(`^${key}=.*$`, "m");
    const nextLine = `${key}=${value}`;
    if (regex.test(content)) {
      content = content.replace(regex, nextLine);
    } else {
      content = `${content.replace(/\s*$/, "")}\n${nextLine}\n`.replace(/^\n/, "");
    }
  }
  fs.writeFileSync(filePath, content, "utf8");
}

function runDeployCapture(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", args, {
      cwd: ROOT,
      shell: process.platform === "win32",
      stdio: ["inherit", "pipe", "pipe"],
    });
    let combined = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      combined += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      combined += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`partykit deploy a échoué (code ${code})`));
      } else {
        resolve(combined);
      }
    });
  });
}

async function main() {
  console.log("\n==========================================================");
  console.log("  Configuration & Déploiement automatique PartyKit");
  console.log("==========================================================\n");

  // 1. Connexion OAuth PartyKit (GitHub / Cloudflare)
  console.log("[1/3] Connexion à ton compte PartyKit (ouverture du navigateur)…");
  const loginRes = spawnSync("npx", ["partykit", "login"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (loginRes.status !== 0) {
    process.exit(loginRes.status ?? 1);
  }

  // 2. Génération ou réutilisation du secret partagé 256 bits
  const existingSecret =
    process.env.PARTYKIT_SECRET?.trim() ||
    readExistingEnvVar(ENV_LOCAL_PATH, "PARTYKIT_SECRET");
  const secret =
    existingSecret && existingSecret.length >= 24
      ? existingSecret
      : crypto.randomBytes(32).toString("hex");

  console.log(`\n[2/3] Déploiement de pulse-bet avec APP_URL=${DEFAULT_APP_URL}…`);
  const output = await runDeployCapture([
    "partykit",
    "deploy",
    "--var",
    `PARTYKIT_SECRET=${secret}`,
    "--var",
    `APP_URL=${DEFAULT_APP_URL}`,
  ]);

  // 3. Extraction automatique du domaine `pulse-bet.<pseudo>.partykit.dev`
  const hostMatch = output.match(/([a-z0-9-]+\.[a-z0-9-]+\.partykit\.dev)/i);
  const detectedHost = hostMatch ? hostMatch[1] : "pulse-bet.<ton-pseudo>.partykit.dev";

  upsertEnvVars(ENV_LOCAL_PATH, {
    PARTYKIT_HOST: hostMatch ? detectedHost : undefined,
    NEXT_PUBLIC_PARTYKIT_HOST: hostMatch ? detectedHost : undefined,
    PARTYKIT_SECRET: secret,
  });

  console.log("\n==========================================================");
  console.log("  Serveur PartyKit déployé avec succès !");
  console.log("==========================================================");
  console.log("\n[3/3] Copie ces 2 variables dans Vercel (Settings -> Environment Variables) :\n");
  console.log(`PARTYKIT_HOST=${detectedHost}`);
  console.log(`PARTYKIT_SECRET=${secret}`);
  console.log("\nPuis clique sur Redeploy dans Vercel : le Web et l'app Android basculeront");
  console.log("automatiquement sur les WebSockets PartyKit (< 50 ms) !\n");
}

main().catch((err) => {
  console.error("\nErreur :", err instanceof Error ? err.message : err);
  process.exit(1);
});
