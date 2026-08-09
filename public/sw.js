/**
 * Offline cache.
 *
 * No build-time precache manifest: the shell is small and the cache is filled
 * from real requests, which keeps the service worker independent of Vite's
 * hashed filenames. What matters on a phone is that the editor opens with no
 * network — a train, a plane, a basement — and that your document, which lives
 * in localStorage, is there when it does.
 */
const CACHE = 'peditor-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add('./')).catch(() => undefined));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: try the network so a deployed update is picked up, but fall
  // back to the cached shell the moment the network is unavailable or slow.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put('./', response.clone());
          return response;
        } catch {
          const cached = await caches.match('./');
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Assets are content-hashed, so serving from cache is always correct; the
  // background revalidate keeps the cache warm for the next version.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      const network = fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE);
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => undefined);

      return cached ?? (await network) ?? Response.error();
    })(),
  );
});
