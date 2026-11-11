import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

// Sync status shown in the header: 'ok' | 'saving' | 'offline'
let status = 'ok'; const subs = new Set()
const setStatus = (s) => { if (s !== status) { status = s; subs.forEach((f) => f()) } }
export const useSyncStatus = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => status)

const readLocal = (key, init) => { try { const r = localStorage.getItem(key); return r == null ? init : JSON.parse(r) } catch { return init } }
const hasLocal = (key) => { try { return localStorage.getItem(key) != null } catch { return false } }
const writeLocal = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }

const timers = {}
function schedulePut(key, value) {
  clearTimeout(timers[key]); setStatus('saving')
  timers[key] = setTimeout(() => put(key, value), 500)
}
async function put(key, value) {
  try {
    const r = await fetch('/api/kv?key=' + encodeURIComponent(key), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) })
    setStatus(r.ok ? 'ok' : 'offline')
  } catch { setStatus('offline') }
}

// Server is the source of truth. localStorage = instant cache + one-time migration:
// if the server has nothing for this key but the browser does, the browser copy is uploaded.
export function useStore(key, init) {
  const [v, setV] = useState(() => readLocal(key, init))
  const ref = useRef(v), keyRef = useRef(key)
  useEffect(() => {
    let dead = false; keyRef.current = key
    const local = readLocal(key, init); ref.current = local; setV(local)
    fetch('/api/kv?key=' + encodeURIComponent(key)).then((r) => r.json()).then((r) => {
      if (dead) return
      setStatus('ok')
      if (r.found) { ref.current = r.value; setV(r.value); writeLocal(key, r.value) }
      else if (hasLocal(key)) put(key, readLocal(key, init))
    }).catch(() => setStatus('offline'))
    return () => { dead = true }
  }, [key]) // eslint-disable-line
  const set = useCallback((next) => {
    const val = typeof next === 'function' ? next(ref.current) : next
    ref.current = val; setV(val); writeLocal(keyRef.current, val); schedulePut(keyRef.current, val)
  }, [])
  return [v, set]
}
