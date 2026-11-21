import { useEffect, useState } from 'react'

// Sub-section of a page, kept in the address (?s=sleep) so the desktop side menu, the page's own tabs, the back button and shared links all agree.
// Changing it uses replaceState (tab clicks do not fill the history) and tells the app through a popstate event so the menu highlight follows.
export const readSub = (ids) => { try { const s = new URLSearchParams(location.search).get('s'); return s && (!ids || ids.includes(s)) ? s : null } catch { return null } }
export function setSubInUrl(id) { const q = id ? '?s=' + encodeURIComponent(id) : ''; history.replaceState(null, '', location.pathname + q); window.dispatchEvent(new PopStateEvent('popstate')) }
export function useSub(ids, def) {
  const [s, set] = useState(() => readSub(ids) || def)
  useEffect(() => { const f = () => set(readSub(ids) || def); addEventListener('popstate', f); return () => removeEventListener('popstate', f) }, [])  // eslint-disable-line
  return [s, (id) => { setSubInUrl(id); set(id) }]
}
