/* Cache des images publiques locales uniquement : jamais les API ou les pages. */
const CACHE = "pulse-static-images-v1";
const MAX_ENTRIES = 150;
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("pulse-static-images-") && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin ||
      !/^\/(?:brand|icons|images)\//.test(url.pathname) ||
      !/\.(?:png|jpe?g|webp|gif|svg|ico)$/i.test(url.pathname) || url.search) return;
  // waitUntil doit être enregistré pendant la distribution de l'événement,
  // et non après un await (certains navigateurs rejettent alors l'appel).
  const result = (async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    const refresh = async () => {
      const response = await fetch(request);
      if (response.ok && response.type === "basic" && !/no-store|private/i.test(response.headers.get("cache-control") || "")) {
        try {
          await cache.put(request, response.clone());
          const keys = await cache.keys();
          for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) await cache.delete(key);
        } catch { /* quota ou stockage désactivé */ }
      }
      return response;
    };
    if (cached) return { response: cached, background: refresh().catch(() => {}) };
    return { response: await refresh(), background: Promise.resolve() };
  })();
  event.respondWith(result.then(({ response }) => response));
  event.waitUntil(result.then(({ background }) => background).catch(() => {}));
});
