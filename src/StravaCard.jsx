import { useState } from 'react'
import { Card, Chip } from './ui.jsx'
import { useApi } from './api.js'

// Strava is only needed for the shoe of each run (COROS does not know it). Connect once; then "Tarik sepatu" matches runs by start time.
export default function StravaCard() {
  const S = useApi('/api/sources'), [busy, setBusy] = useState(false), [res, setRes] = useState(null), [err, setErr] = useState('')
  const st = S.data?.strava
  const sync = () => { setBusy(true); setErr(''); fetch('/api/strava/sync-shoes', { method: 'POST' }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); setRes(j) }).catch((e) => setErr(e.message)).finally(() => setBusy(false)) }
  return <Card title="Strava · sepatu per lari" right={<Chip tone={st?.connected ? 'green' : 'yellow'}>{st?.connected ? 'terhubung' : st?.configured ? 'belum terhubung' : 'belum diatur'}</Chip>}>
    <p className="muted">COROS tidak tahu sepatu yang kamu pakai; Strava tahu. Dipakai untuk menganalisis efisiensi vs jarak tempuh sepatu.</p>
    {st?.configured && !st.connected && <a className="btn primary" href="/api/strava/login">Hubungkan Strava</a>}
    {st?.connected && <button className="btn primary" disabled={busy} onClick={sync}>{busy ? 'Menarik…' : 'Tarik sepatu dari Strava'}</button>}
    {res && <p className="muted">{res.matched} lari dicocokkan ke sepatu · {res.shoes} sepatu · cakupan 2026: {res.coverage2026 ?? '—'}% {res.unmatched ? `· ${res.unmatched} tidak cocok` : ''}</p>}
    {err && <p className="err" role="alert">{err}</p>}
  </Card>
}
