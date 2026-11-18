import { useEffect, useState } from 'react'
import { getJson } from './net.js'
// GET helper: {data, state: 'loading'|'ok'|'error'}. Never invents data: callers show "not pulled yet" for empty results.
export function useApi(path, enabled = true) {
  const [s, setS] = useState({ data: null, state: enabled ? 'loading' : 'idle' })
  useEffect(() => {
    if (!enabled || !path) return
    let dead = false; setS((x) => ({ data: x.data, state: 'loading' }))
    getJson(path).then((d) => !dead && setS({ data: d, state: 'ok' })).catch(() => !dead && setS({ data: null, state: 'error' }))
    return () => { dead = true }
  }, [path, enabled])
  return s
}
export const fmtDur = (s) => { if (s == null) return '—'; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}` }
export const fmtPaceS = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)
export const hm = (min) => (min == null ? '—' : `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`)
