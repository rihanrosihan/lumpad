import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import '@fontsource-variable/inter'
import '@fontsource-variable/plus-jakarta-sans'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'
import './home-v2.css'
// CSRF guard: every same-origin write carries a custom header the server requires
const _fetch = window.fetch.bind(window)
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url, m = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase()
  if (m !== 'GET' && m !== 'HEAD' && (url.startsWith('/') || url.startsWith(location.origin))) { const h = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined)); h.set('X-Lumpad', '1'); init = { ...init, headers: h } }
  return _fetch(input, init)
}

// Charts are drawn in a ~300–640 unit viewBox and scale with their card. On a wide desktop card that blew the axis text up to 20–37 px
// (Race prediction, Fitness path, ...). Cap each text-bearing chart at 1.3x its drawing width and centre it, so text stays 10–16 px.
function capCharts() {
  for (const svg of document.querySelectorAll('svg[viewBox]')) {
    if (svg.hasAttribute('width') || svg.hasAttribute('data-fit') || svg.closest('.bsq-side,.rml,.leaflet-container') || !svg.querySelector('text')) continue
    const vw = svg.viewBox.baseVal && svg.viewBox.baseVal.width
    if (!vw || vw < 200) continue
    const cap = Math.round(vw * 1.3) + 'px'
    if (svg.style.maxWidth !== cap) { svg.style.maxWidth = cap; svg.style.marginLeft = 'auto'; svg.style.marginRight = 'auto' }
  }
}
let capQ = 0
new MutationObserver(() => { cancelAnimationFrame(capQ); capQ = requestAnimationFrame(capCharts) }).observe(document.documentElement, { childList: true, subtree: true })
createRoot(document.getElementById('root')).render(<App />)

// A deploy replaced the files this tab still points at (lazy chunk gone): reload once to pick up the new build
addEventListener('vite:preloadError', () => { try { if (sessionStorage.getItem('lumpad-reload')) return; sessionStorage.setItem('lumpad-reload', '1') } catch {} location.reload() })

// Warm the other pages while the phone is idle, so tab switches do not wait for the network
const idle = window.requestIdleCallback || ((f) => setTimeout(f, 2500))
addEventListener('load', () => idle(() => { for (const f of [() => import('./Readiness.jsx'), () => import('./ActivityHub.jsx'), () => import('./Calendar.jsx'), () => import('./Coach.jsx')]) f().catch(() => {}) }))

// PWA: register the service worker in production builds only (a worker in the dev server would cache hot-reload files)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const had = !!navigator.serviceWorker.controller
  addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })
  // a new version took over: offer a one-tap reload instead of switching under the user's fingers
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!had || document.getElementById('upd')) return
    const b = document.createElement('button'); b.id = 'upd'; b.type = 'button'; b.textContent = 'New version ready — tap to reload'
    b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(88px + env(safe-area-inset-bottom));z-index:99;padding:10px 16px;border-radius:999px;border:0;background:#4658D6;color:#fff;font:600 13px system-ui;box-shadow:0 6px 20px rgba(0,0,0,.25)'
    b.onclick = () => location.reload(); document.body.appendChild(b)
  })
}
