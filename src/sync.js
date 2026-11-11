import { useEffect, useState } from 'react'
// Sync status + synced health rows (COROS via the daily routine). Everything shows its source and pull time.
export function useSyncStatus2() {
  const [s, setS] = useState(undefined) // undefined = loading, null = unavailable
  useEffect(() => { fetch('/api/sync/status').then((r) => (r.ok ? r.json() : null)).then(setS).catch(() => setS(null)) }, [])
  return s
}
// state: 'loading' | 'none' (no row for that day) | 'error' (server unreachable) | 'ok'
export function useHealthDay(date) {
  const [h, setH] = useState({ state: 'loading', row: null })
  useEffect(() => {
    let dead = false; setH({ state: 'loading', row: null })
    fetch(`/api/health/range?from=${date}&to=${date}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then((a) => !dead && setH(a[0] ? { state: 'ok', row: a[0] } : { state: 'none', row: null })).catch(() => !dead && setH({ state: 'error', row: null }))
    return () => { dead = true }
  }, [date])
  return h
}
// "2026-11-11T01:02:03Z" → "08:02" in Jakarta
export const wib = (iso) => iso ? new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)).replace('.', ':') : ''
export const ago = (iso) => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 90 ? `${m} mnt lalu` : m < 2880 ? `${Math.round(m / 60)} jam lalu` : `${Math.round(m / 1440)} hari lalu` }
export const hrvLow = (status) => /below|low|rendah|reduced/i.test(status || '')
