import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import '@fontsource-variable/inter'
import '@fontsource-variable/plus-jakarta-sans'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'
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

// PWA: register the service worker in production builds only (a worker in the dev server would cache hot-reload files)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
