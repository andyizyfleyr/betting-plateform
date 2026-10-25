import { createHmac } from "crypto";

/**
 * Graine cryptographique strictement côté serveur (HMAC-SHA256) :
 * - Stable entre deux invocations Serverless pour un même identifiant d'événement
 *   (nécessaire à l'idempotence du rattrapage temporel)
 * - Totalement imprédictible depuis le navigateur ou le dépôt GitHub public, car
 *   dérivée des secrets d'environnement de production (`SESSION_SECRET` / `DATABASE_URL`).
 */
function getServerEntropyKey(): string {
  return [
    process.env.SESSION_SECRET ?? "",
    process.env.DATABASE_URL ?? "",
    process.env.ADMIN_PASSWORD ?? "",
    "pulse-quant-v4-unpredictable-salt-9f4e2a7c",
  ].join("|");
}

/** Retourne un entier 32 bits non signé uniformément distribué via HMAC-SHA256. */
export function hmacUint32(namespace: string): number {
  const digest = createHmac("sha256", getServerEntropyKey())
    .update(namespace)
    .digest();
  return digest.readUInt32BE(0) >>> 0;
}

/** PRNG rapide initialisé par HMAC-SHA256 serveur (séquence de flottants ∈ [0, 1)). */
export function createServerRng(namespace: string): () => number {
  const digest = createHmac("sha256", getServerEntropyKey())
    .update(namespace)
    .digest();
  let s0 = digest.readUInt32BE(0) >>> 0;
  let s1 = digest.readUInt32BE(4) >>> 0;
  let counter = 0;

  return () => {
    counter = (counter + 1) | 0;
    let z = (s0 + Math.imul(s1 ^ counter, 0x9e3779b9) + Math.imul(counter, 0x6d2b79f5)) >>> 0;
    s0 = ((s0 << 13) | (s0 >>> 19)) ^ z;
    z = Math.imul(z ^ (z >>> 15), 1 | z);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}
