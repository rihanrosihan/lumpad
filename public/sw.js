// Lumpad service worker (v2): installable app, instant start, whole app available offline.
//  - on install it stores every built file (asset-list.json), so every page also works offline after the first visit
//  - /assets/*, /icons/*  cache first (hashed file names never go stale)
//  - page navigations     network first (3 s), cached app shell when offline
//  - GET /api/*           network first; if the network fails, the last good answer from this device is shown (flagged by the app as offline)
//  - /api/map/static      cache first (route thumbnails never change for a finished run)
//  - POST, map tiles, other origins: left to the browser
const V = 'v2', SHELL = 'lumpad-shell-' + V, ASSETS = 'lumpad-assets-' + V, DATA = 'lumpad-data-' + V, THUMBS = 'lumpad-thumbs-' + V
const KEEP = [SHELL, ASSETS, DATA, THUMBS], MAX = { [DATA]: 80, [THUMBS]: 150 }
const NO_STORE = /^\/api\/(ingest|map\/tile|google|coach\/run|geo\/streetview)/
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL); await shell.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png'])
    try { // best effort: a failure here must not block the install
      const list = await (await fetch('/asset-list.json', { cache: 'no-store' })).json(), a = await caches.open(ASSETS)
      await Promise.all(list.map((u) => a.match(u).then((h) => h || a.add(u).catch(() => {}))))
    } catch {}
    await self.skipWaiting()
  })())
})
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim())) })
async function trim(name) { const c = await caches.open(name), ks = await c.keys(), max = MAX[name]; for (const k of ks.slice(0, Math.max(0, ks.length - max))) await c.delete(k) }
const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url)
  if (r.method !== 'GET' || u.origin !== location.origin) return
  if (u.pathname.startsWith('/api/')) {
    if (u.pathname === '/api/map/static') {
      e.respondWith(caches.open(THUMBS).then(async (c) => { const hit = await c.match(r); if (hit) return hit; const res = await fetch(r); if (res.ok) { c.put(r, res.clone()); trim(THUMBS) } return res }))
      return
    }
    if (NO_STORE.test(u.pathname)) return
    e.respondWith((async () => {
      try {
        const res = await fetch(r)
        if (res.ok && res.headers.get('content-type')?.includes('json')) { const c = await caches.open(DATA); c.put(r, res.clone()); trim(DATA) }
        return res
      } catch (err) {
        const hit = await (await caches.open(DATA)).match(r)
        if (hit) { const h = new Headers(hit.headers); h.set('x-lumpad-offline', '1'); return new Response(hit.body, { status: 200, headers: h }) }
        throw err
      }
    })())
    return
  }
  if (r.mode === 'navigate') {
    e.respondWith(Promise.race([fetch(r), timeout(3000)]).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('/', copy)) } return res }).catch(() => caches.match('/').then((m) => m || fetch(r))))
    return
  }
  if (u.pathname.startsWith('/assets/') || u.pathname.startsWith('/icons/') || u.pathname === '/manifest.webmanifest') {
    e.respondWith(caches.open(ASSETS).then(async (c) => { const hit = await c.match(r); if (hit) return hit; const res = await fetch(r); if (res.ok) c.put(r, res.clone()); return res }))
  }
})
