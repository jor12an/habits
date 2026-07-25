/* Habits service worker — minimal, Safari-safe.
 * Does NOT intercept navigations (page loads). That avoids:
 *  - "Response served by service worker has redirections"
 *  - false "Offline" shell after refresh
 * Only caches static assets (css/js/icons/manifest).
 */
const CACHE = 'habits-v14';
const PRECACHE = [
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png',
];

/** Copy body into a fresh Response so `redirected` is never true (Safari PWA). */
async function asCleanResponse(res) {
  if (!res) return res;
  const buf = await res.arrayBuffer();
  const headers = new Headers(res.headers);
  return new Response(buf, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(
      PRECACHE.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (res && res.ok) {
            await cache.put(url, await asCleanResponse(res));
          }
        } catch (_) { /* ignore */ }
      })
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Critical: never handle HTML navigations — browser loads them normally
  if (request.mode === 'navigate' || request.destination === 'document') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Don't SW-handle index.html either
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) {
      // revalidate in background
      fetch(request).then(async (res) => {
        if (res && res.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, await asCleanResponse(res));
        }
      }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(request);
      if (res && res.ok) {
        const clean = await asCleanResponse(res);
        const cache = await caches.open(CACHE);
        await cache.put(request, clean.clone());
        return clean;
      }
      return res;
    } catch (_) {
      return cached || new Response('', { status: 503 });
    }
  })());
});
