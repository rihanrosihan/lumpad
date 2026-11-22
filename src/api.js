import { useEffect, useState } from 'react'
import { getJson } from './net.js'
// GET helper: {data, state: 'loading'|'ok'|'error'}. Never invents data: callers show "not pulled yet" for empty results.
// Stale-while-revalidate: the last answer for a path (kept 10 min in memory) is shown at once and refreshed in the background,
// so going back to a tab no longer starts from an empty screen.
const memo = new Map(), TTL = 10 * 60 * 1000
const fromMemo = (path) => { const m = memo.get(path); return m && Date.now() - m.t < TTL ? m.d : null }
// drop cached responses whose path contains `prefix`, so the next render refetches (e.g. after the coach finishes an analysis)
export const invalidate = (prefix) => { for (const k of [...memo.keys()]) if (k.includes(prefix)) memo.delete(k) }
export function useApi(path, enabled = true) {
  const [s, setS] = useState(() => { const d = enabled && path ? fromMemo(path) : null; return { data: d, state: d ? 'ok' : enabled ? 'loading' : 'idle' } })
  useEffect(() => {
    if (!enabled || !path) return
    let dead = false; const hit = fromMemo(path)
    setS((x) => (hit ? { data: hit, state: 'ok' } : { data: x.data, state: 'loading' }))
    getJson(path).then((d) => { memo.set(path, { d, t: Date.now() }); if (memo.size > 120) memo.delete(memo.keys().next().value); !dead && setS({ data: d, state: 'ok' }) }).catch(() => !dead && setS(hit ? { data: hit, state: 'ok' } : { data: null, state: 'error' }))
    return () => { dead = true }
  }, [path, enabled])
  return s
}
export const fmtDur = (s) => { if (s == null) return '—'; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}` }
export const fmtPaceS = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)
export const hm = (min) => (min == null ? '—' : `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`)
