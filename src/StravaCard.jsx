import { useState } from 'react'
import { Card, Chip } from './ui.jsx'
import { useApi } from './api.js'

// Strava is only needed for the shoe of each run (COROS does not know it). Connect once; then "Pull shoes" matches runs by start time.
export default function StravaCard() {
  const S = useApi('/api/sources'), [busy, setBusy] = useState(false), [res, setRes] = useState(null), [err, setErr] = useState('')
  const st = S.data?.strava
  const sync = () => { setBusy(true); setErr(''); fetch('/api/strava/sync-shoes', { method: 'POST' }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); setRes(j) }).catch((e) => setErr(e.message)).finally(() => setBusy(false)) }
  return <Card title="Strava · shoe per run" right={<Chip tone={st?.connected ? 'green' : 'yellow'}>{st?.connected ? 'connected' : st?.configured ? 'not connected' : 'not configured'}</Chip>}>
    <p className="muted">COROS does not know which shoe you wore; Strava does. Used to analyse efficiency against shoe mileage.</p>
    {st?.configured && !st.connected && <a className="btn primary" href="/api/strava/login">Connect Strava</a>}
    {st?.connected && <button className="btn primary" disabled={busy} onClick={sync}>{busy ? 'Pulling…' : 'Pull shoes from Strava'}</button>}
    {res && <p className="muted">{res.matched} runs matched to a shoe · {res.shoes} shoes · 2026 coverage: {res.coverage2026 ?? '—'}% {res.unmatched ? `· ${res.unmatched} unmatched` : ''}</p>}
    {err && <p className="err" role="alert">{err}</p>}
  </Card>
}
