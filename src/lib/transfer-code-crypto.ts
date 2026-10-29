import { createHmac, createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomInt } from "node:crypto";
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

/** Enveloppe chiffrée authentifiée, distincte de la clé de recherche HMAC. */
function encryptionKey(secret: string): Buffer {
  if (!/^[a-fA-F0-9]{64}$/.test(secret)) throw new Error("Clé de chiffrement indisponible");
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "hex"), Buffer.from("pulsebet-transfer-code"), Buffer.from("history-aes-256-gcm-v1"), 32));
}
export function encryptTransferCode(code: string, secret: string, owner: number): string {
  if (!/^\d{20}$/.test(code) || !isValidTransferCode(code)) throw new Error("Code invalide");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(`transfer-code:v1:${owner}:${hashTransferCode(code, secret)}`));
  const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}
export function decryptTransferCode(envelope: string, secret: string, owner: number, hash: string): string {
  const [version, nonce, data, tag, extra] = envelope.split(".");
  if (version !== "v1" || !nonce || !data || !tag || extra) throw new Error("Code indisponible");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(nonce, "base64url"));
  decipher.setAAD(Buffer.from(`transfer-code:v1:${owner}:${hash}`));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const code = Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  if (!isValidTransferCode(code) || hashTransferCode(code, secret) !== hash) throw new Error("Code indisponible");
  return code;
}
