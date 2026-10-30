import assert from "node:assert/strict";
import { publicJsonWithEdgeCache, jsonWithEtag, hasUnexpectedSearchParams } from "../src/lib/response-cache";

async function main() {
const payload = { matches: [{ id: 1, odds: 2.1 }] };
const policy = { sMaxAge: 10, staleWhileRevalidate: 1, tags: ["api-matches"] };
const request = new Request("https://example.com/api/matches/slim");
const publicResponse = publicJsonWithEdgeCache(request, payload, undefined, policy);
assert.match(publicResponse.headers.get("Vercel-CDN-Cache-Control") ?? "", /s-maxage=10/);
assert.equal(publicResponse.headers.get("Vary"), "Accept-Encoding");
assert.deepEqual(await publicResponse.json(), payload);
const etag = publicResponse.headers.get("etag")!;
const conditional = publicJsonWithEdgeCache(new Request(request.url, { headers: { "if-none-match": etag } }), payload, undefined, policy);
assert.equal(conditional.status, 304);
for (const url of ["https://example.com/api/matches/slim?refresh=1", "https://example.com/api/matches/slim?_=123"]) {
  const response = publicJsonWithEdgeCache(new Request(url), payload, undefined, policy);
  assert.match(response.headers.get("Vercel-CDN-Cache-Control") ?? "", /private, no-store/);
}
const privateResponse = jsonWithEtag(request, { balance: 42 });
assert.match(privateResponse.headers.get("Vercel-CDN-Cache-Control") ?? "", /private, no-store/);
assert.match(privateResponse.headers.get("Vary") ?? "", /Authorization/);
assert.equal(hasUnexpectedSearchParams(new URLSearchParams("refresh=1")), false);
assert.equal(hasUnexpectedSearchParams(new URLSearchParams("user=1")), true);

// Modèle synthétique : 100 requêtes/s réparties sur 60 s, un seul cache,
// sans purge, revalidation anticipée ou requête de rafraîchissement manuel.
function originRequests(ttl: number): number {
  let expiry = -1, origin = 0;
  for (let i = 0; i < 6000; i++) {
    const t = i / 100;
    if (t >= expiry) { origin++; expiry = t + ttl; }
  }
  return origin;
}
const before = originRequests(1), after = originRequests(10);
assert.equal(before, 60);
assert.equal(after, 6);
console.log(`Cache simulé : ${before} → ${after} appels origine (1 PoP, sans purge). Ce n'est pas une mesure Neon.`);
console.log("En-têtes publics, privés, refresh et ETag vérifiés.");

}
main().catch((error) => { console.error(error); process.exitCode = 1; });
