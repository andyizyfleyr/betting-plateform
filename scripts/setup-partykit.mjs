#!/usr/bin/env node
/**
 * Script clé en main (`npm run party:setup`) — PartyServer officiel sur Cloudflare Workers
 * (remplace l'ancien dashboard.partykit.io obsolète par Cloudflare Workers + Durable Objects SQLite gratuits) :
 *
 *  1. Lance `npx wrangler login` (ouverture automatique de https://dash.cloudflare.com dans le navigateur).
 *  2. Génère automatiquement un `PARTYKIT_SECRET` cryptographique 256 bits (ou réutilise celui de `.env.local`).
 *  3. Déploie `party/index.ts` (`pulse-bet`) avec `PARTYKIT_SECRET` chiffré et `APP_URL` en une seule passe,
 *     en conservant le terminal interactif (TTY) au cas où Cloudflare demande de choisir ton sous-domaine `workers.dev`.
 *  4. Récupère automatiquement l'URL `pulse-bet.<sous-domaine>.workers.dev`, met à jour `.env.local` et affiche
 *     les 2 lignes prêtes à coller dans Vercel -> Settings -> Environment Variables.
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_LOCAL_PATH = path.join(ROOT, ".env.local");
const SECRETS_TMP_PATH = path.join(ROOT, ".wrangler-secrets.tmp.json");
const DEPLOY_OUT_TMP_PATH = path.join(ROOT, ".wrangler-deploy.tmp.jsonl");
const DEFAULT_APP_URL =
  process.env.APP_URL?.trim() || "https://be-plateform.vercel.app";

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
      content = `${content.replace(/\s*$/, "")}\n${nextLine}\n`.replace(
        /^\n/,
        ""
      );
    }
  }
  fs.writeFileSync(filePath, content, "utf8");
}

function extractWorkersHost(outputJsonlPath) {
  if (!fs.existsSync(outputJsonlPath)) return null;
  const raw = fs.readFileSync(outputJsonlPath, "utf8");
  const match = raw.match(/([a-z0-9-]+\.[a-z0-9-]+\.workers\.dev)/i);
  return match ? match[1] : null;
}

function safeUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

async function main() {
  console.log("\n==========================================================");
  console.log("  Configuration & Déploiement Temps Réel (PartyServer)");
  console.log("==========================================================\n");

  // 1. Vérifie si Wrangler est déjà connecté, sinon ouvre https://dash.cloudflare.com
  const whoamiRes = spawnSync("npx", ["wrangler", "whoami"], {
    cwd: ROOT,
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  const whoamiOut = `${whoamiRes.stdout?.toString() ?? ""}${whoamiRes.stderr?.toString() ?? ""}`;
  const alreadyLoggedIn =
    whoamiRes.status === 0 && !/not authenticated/i.test(whoamiOut);

  if (!alreadyLoggedIn) {
    console.log(
      "[1/3] Connexion à ton compte Cloudflare gratuit (ouverture du navigateur)…"
    );
    console.log(
      "      (Si tu n'as pas encore de compte Cloudflare, clique sur Sign Up gratuitement puis Authorize)\n"
    );
    const loginRes = spawnSync("npx", ["wrangler", "login"], {
      cwd: ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (loginRes.status !== 0) {
      process.exit(loginRes.status ?? 1);
    }
  } else {
    console.log("[1/3] Session Cloudflare déjà active — connexion validée.");
  }

  // 2. Génération ou réutilisation du secret partagé 256 bits
  const existingSecret =
    process.env.PARTYKIT_SECRET?.trim() ||
    readExistingEnvVar(ENV_LOCAL_PATH, "PARTYKIT_SECRET");
  const secret =
    existingSecret && existingSecret.length >= 24
      ? existingSecret
      : crypto.randomBytes(32).toString("hex");

  safeUnlink(DEPLOY_OUT_TMP_PATH);
  fs.writeFileSync(
    SECRETS_TMP_PATH,
    JSON.stringify({ PARTYKIT_SECRET: secret }, null, 2),
    "utf8"
  );

  let detectedHost = null;
  try {
    console.log(
      `\n[2/3] Déploiement de pulse-bet sur Cloudflare Workers (APP_URL=${DEFAULT_APP_URL})…`
    );
    console.log(
      "      (Si Cloudflare te demande 'Would you like to register a workers.dev subdomain now?', tape y puis Entrée)\n"
    );

    const deployRes = spawnSync(
      "npx",
      [
        "wrangler",
        "deploy",
        "-c",
        "wrangler.jsonc",
        "--autoconfig=false",
        "--var",
        `APP_URL:${DEFAULT_APP_URL}`,
        "--secrets-file",
        SECRETS_TMP_PATH,
      ],
      {
        cwd: ROOT,
        stdio: "inherit",
        shell: process.platform === "win32",
        env: {
          ...process.env,
          WRANGLER_OUTPUT_FILE_PATH: DEPLOY_OUT_TMP_PATH,
        },
      }
    );

    if (deployRes.status !== 0) {
      process.exit(deployRes.status ?? 1);
    }

    detectedHost = extractWorkersHost(DEPLOY_OUT_TMP_PATH);
  } finally {
    safeUnlink(SECRETS_TMP_PATH);
    safeUnlink(DEPLOY_OUT_TMP_PATH);
  }

  const finalHost =
    detectedHost || "pulse-bet.<ton-sous-domaine>.workers.dev";

  upsertEnvVars(ENV_LOCAL_PATH, {
    PARTYKIT_HOST: detectedHost ? finalHost : undefined,
    NEXT_PUBLIC_PARTYKIT_HOST: detectedHost ? finalHost : undefined,
    PARTYKIT_SECRET: secret,
  });

  console.log("\n==========================================================");
  console.log("  Serveur Temps Réel déployé avec succès !");
  console.log("==========================================================");
  console.log(
    "\n[3/3] Copie ces 2 variables dans Vercel (Settings -> Environment Variables) :\n"
  );
  console.log(`PARTYKIT_HOST=${finalHost}`);
  console.log(`PARTYKIT_SECRET=${secret}`);
  console.log(
    "\nPuis clique sur Redeploy dans Vercel : le site Web et l'app Android basculeront"
  );
  console.log("automatiquement sur les WebSockets temps réel (< 50 ms) !\n");
}

main().catch((err) => {
  console.error("\nErreur :", err instanceof Error ? err.message : err);
  process.exit(1);
});
