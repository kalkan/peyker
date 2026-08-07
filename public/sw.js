/**
 * Peyker service worker.
 *
 * Conservative caching so deploys never serve stale pages:
 *   - hashed /assets/ bundles: stale-while-revalidate (safe — content-hashed)
 *   - page navigations / HTML: network-first, cache as offline fallback
 *   - everything else (API'ler, TLE kaynakları, harita karoları): untouched
 *
 * Bump CACHE_VERSION to force a clean slate on structural changes.
 */

const CACHE_VERSION = 'peyker-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;  // never touch cross-origin (tiles, APIs)

  if (url.pathname.includes('/assets/')) {
    event.respondWith(staleWhileRevalidate(request));
  } else if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(request));
  }
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || refresh;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('offline and uncached');
  }
}
