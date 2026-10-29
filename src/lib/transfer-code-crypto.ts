import { createHmac, randomInt } from "node:crypto";
import { isValidTransferCode } from "./transfer-code";

/** Génère un secret de 20 chiffres avec contrôle Luhn. Ne jamais journaliser sa valeur. */
export function generateTransferCode(): string {
  let prefix = "";
  for (let i = 0; i < 19; i++) prefix += String(randomInt(10));
  // La recherche du dernier chiffre ne dépend que du préfixe aléatoire.
  for (let digit = 0; digit <= 9; digit++) {
    const candidate = prefix + digit;
    if (isValidTransferCode(candidate)) return candidate;
  }
  throw new Error("Impossible de générer le chiffre de contrôle");
}

/** HMAC avec une clé dédiée fournie par le serveur, jamais de secret par défaut. */
export function hashTransferCode(code: string, secret: string): string {
  if (!/^\d{20}$/.test(code) || !isValidTransferCode(code)) throw new Error("Code invalide");
  if (!/^[a-fA-F0-9]{64}$/.test(secret)) throw new Error("Clé de hachage indisponible");
  return createHmac("sha256", Buffer.from(secret, "hex"))
    .update("pulsebet:transfer-code:v1:", "utf8")
    .update(code, "utf8")
    .digest("hex");
}
