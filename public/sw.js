// Lumpad service worker: makes the app installable and the shell load offline. It never stores your data.
//  - /api/*            network only (health data stays fresh and is never kept in a cache)
//  - /assets/*         cache first (file names carry a content hash, so a cached file never goes stale)
//  - page navigations  network first, cached app shell when offline
//  - everything else (map tiles, other origins, non-GET) is left to the browser
const SHELL = 'lumpad-shell-v1', ASSETS = 'lumpad-assets-v1', KEEP = [SHELL, ASSETS], MAX_ASSETS = 120
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png'])).then(() => self.skipWaiting())) })
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim())) })
async function trim(cache) { const ks = await cache.keys(); for (const k of ks.slice(0, Math.max(0, ks.length - MAX_ASSETS))) await cache.delete(k) }
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url)
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('/', copy)) } return res }).catch(() => caches.match('/').then((m) => m || Response.error())))
    return
  }
  if (u.pathname.startsWith('/assets/') || u.pathname.startsWith('/icons/') || u.pathname === '/manifest.webmanifest') {
    e.respondWith(caches.open(ASSETS).then(async (c) => { const hit = await c.match(r); if (hit) return hit; const res = await fetch(r); if (res.ok) { c.put(r, res.clone()); trim(c) } return res }))
  }
})
