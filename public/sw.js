/* Habits service worker — Safari-safe (never serve redirected responses). */
const CACHE = 'habits-v11';
const PRECACHE = [
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png',
];

function isCacheable(res) {
  return !!(res && res.ok && !res.redirected && (res.type === 'basic' || res.type === 'cors'));
}

async function putSafe(cache, request, response) {
  if (!isCacheable(response)) return;
  try {
    await cache.put(request, response.clone());
  } catch (_) { /* ignore quota / invalid */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const path of PRECACHE) {
      try {
        // cache: 'reload' bypasses HTTP cache; avoid following redirects into cache
        const res = await fetch(path, { cache: 'reload', redirect: 'follow' });
        if (isCacheable(res)) {
          // Store under the path we asked for, not a redirected URL
          await cache.put(path, res.clone());
        }
      } catch (_) { /* offline during install */ }
    }
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

/** Navigation / HTML: network → clean index.html, never a redirect response. */
async function handleNavigate() {
  try {
    const res = await fetch('./index.html', { cache: 'no-cache', redirect: 'follow' });
    if (isCacheable(res)) {
      const cache = await caches.open(CACHE);
      await putSafe(cache, './index.html', res);
      return res;
    }
    // Redirected or bad: try cache
  } catch (_) { /* network fail */ }

  const cached = await caches.match('./index.html', { ignoreSearch: true });
  if (cached && !cached.redirected) return cached;

  // Last resort: empty shell message (must not be a redirect)
  return new Response(
    '<!DOCTYPE html><title>Habits</title><p>Offline. Reconnect and reopen.</p>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

async function handleAsset(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached && !cached.redirected) {
    // Stale-while-revalidate
    fetch(request, { redirect: 'follow' }).then(async (res) => {
      if (isCacheable(res)) {
        const cache = await caches.open(CACHE);
        await putSafe(cache, request, res);
      }
    }).catch(() => {});
    return cached;
  }

  try {
    const res = await fetch(request, { redirect: 'follow' });
    if (isCacheable(res)) {
      const cache = await caches.open(CACHE);
      await putSafe(cache, request, res);
      return res;
    }
    // Do not return redirected responses to Safari (standalone PWA bug)
    if (res.redirected) {
      const again = await caches.match(request, { ignoreSearch: true });
      if (again && !again.redirected) return again;
    }
    return res.redirected
      ? new Response('', { status: 502, statusText: 'Bad redirect' })
      : res;
  } catch (_) {
    if (cached && !cached.redirected) return cached;
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Same-origin only
  if (url.origin !== self.location.origin) return;

  // App shell navigations (/, /index.html, path without extension)
  const isNav = request.mode === 'navigate'
    || request.destination === 'document'
    || url.pathname.endsWith('/')
    || url.pathname.endsWith('/index.html');

  if (isNav) {
    event.respondWith(handleNavigate());
    return;
  }

  event.respondWith(handleAsset(request));
});
