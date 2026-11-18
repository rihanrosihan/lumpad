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
  if (m !== 'GET' && m !== 'HEAD' && (url.startsWith('/') || url.startsWith(location.origin))) init = { ...init, headers: { ...(init.headers || {}), 'X-Lumpad': '1' } }
  return _fetch(input, init)
}
createRoot(document.getElementById('root')).render(<App />)
