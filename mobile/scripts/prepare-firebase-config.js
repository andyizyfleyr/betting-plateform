#!/usr/bin/env node
// Configuration Firebase Android fournie par Codemagic, jamais journalisée ni commise.
const fs = require("fs");
const path = require("path");

const content = process.env.FIREBASE_GOOGLE_SERVICES_JSON;
if (!content) {
  console.error("FIREBASE_GOOGLE_SERVICES_JSON est absent du groupe Codemagic firebase_credentials.");
  process.exit(1);
}
let config;
try {
  config = JSON.parse(content);
} catch {
  console.error("FIREBASE_GOOGLE_SERVICES_JSON doit contenir le JSON complet de google-services.json.");
  process.exit(1);
}
const matchingClient = Array.isArray(config?.client) && config.client.some(
  (client) => client?.client_info?.android_client_info?.package_name === "app.pulsebets.android"
);
if (!config?.project_info?.project_id || !matchingClient) {
  console.error("Le fichier Firebase ne correspond pas au package Android app.pulsebets.android.");
  process.exit(1);
}
const target = path.resolve(__dirname, "..", "google-services.json");
fs.writeFileSync(target, JSON.stringify(config), { mode: 0o600 });
console.log("Configuration Firebase Android validée et préparée pour le build.");
