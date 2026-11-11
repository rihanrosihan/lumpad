import { useEffect, useState } from 'react'
// Sync status + synced health rows (COROS via the daily routine). Everything shows its source and pull time.
export function useSyncStatus2() {
  const [s, setS] = useState(undefined) // undefined = loading, null = unavailable
  useEffect(() => { fetch('/api/sync/status').then((r) => (r.ok ? r.json() : null)).then(setS).catch(() => setS(null)) }, [])
  return s
}
export function useHealthDay(date) {
  const [h, setH] = useState(undefined)
  useEffect(() => { setH(undefined); fetch(`/api/health/range?from=${date}&to=${date}`).then((r) => (r.ok ? r.json() : [])).then((a) => setH(a[0] || null)).catch(() => setH(null)) }, [date])
  return h
}
// "2026-11-11T01:02:03Z" → "08:02" in Jakarta
export const wib = (iso) => iso ? new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)).replace('.', ':') : ''
export const ago = (iso) => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 90 ? `${m} mnt lalu` : m < 2880 ? `${Math.round(m / 60)} jam lalu` : `${Math.round(m / 1440)} hari lalu` }
export const hrvLow = (status) => /below|low|rendah|reduced/i.test(status || '')
