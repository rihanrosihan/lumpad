import { useCallback, useEffect, useState } from 'react'
import { Card, Chip } from './ui.jsx'
import { ago } from './sync.js'

const api = async (path, opts) => { const r = await fetch('/api' + path, opts); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j }
const STAGE = { health: 'Sleep & daily activity', hrv: 'Sleep HRV (per week)', resting: 'Resting HR', activities: 'Activities (per month)', laps: 'Run laps', archive: 'Archive', saving: 'Saving', done: 'Done' }
const KIND = { daily: 'Daily', backfill: 'History', archive: 'Archive 2025–now' }
const mb = (b) => (b / 1048576).toFixed(1) + ' MB'

// Dedicated archive (coros.db): every COROS tool from 2025, newest first, a daily call budget until complete.
function ArchivePanel({ running, onRun, busy }) {
  const [a, setA] = useState(null)
  const load = useCallback(() => api('/coros/archive').then(setA).catch(() => setA(null)), [])
  useEffect(() => { load(); const t = setInterval(load, running ? 4000 : 60000); return () => clearInterval(t) }, [load, running])
  if (!a) return null
  const all = a.total.done + a.total.pending, pct = all ? Math.round((a.total.done / all) * 100) : 0
  const limited = a.buckets.filter((b) => b.learned != null || b.blockedToday)
  return <div className="job">
    <h3>COROS archive {a.from.slice(0, 4)}–now · {a.complete ? 'complete ✓' : `${pct}%`}</h3>
    <div className="bar"><i style={{ width: pct + '%' }} /></div>
    <p className="muted">{a.activities.n} activities{a.activities.first ? ` (${a.activities.first} → ${a.activities.last})` : ''} · {a.fit.files} FIT files ({mb(a.fit.bytes)}) · health data since {a.healthFrom || '—'}</p>
    <p className="muted">Today {a.total.used}/{a.total.cap} calls · queue left {a.total.pending}{a.complete ? '' : ` · estimated done in ±${a.etaDays} days`}. Runs automatically every hour (not 07–09 WIB) until the daily budget is used; newest dates first.</p>
    {limited.length > 0 && <p className="muted">COROS limit detected: {limited.map((b) => `${b.bucket} ${b.learned ?? b.cap}/day${b.blockedToday ? ' (used up today)' : ''}`).join(' · ')}</p>}
    <details><summary className="muted">Per-tool detail</summary><ul>{a.tools.map((t) => <li key={t.tool} className="muted">{t.tool}: {t.done + t.empty} done{t.pending ? ` · ${t.pending} queued` : ''}{t.failed ? ` · ${t.failed} failed` : ''}{t.oldest ? ` · ${t.oldest} → ${t.newest}` : ''}</li>)}</ul></details>
    <button className="btn sm full" disabled={busy || running || a.complete && a.total.pending === 0} onClick={() => onRun().then(load)}>Run an archive session now</button>
  </div>
}

export default function CorosCard() {
  const [s, setS] = useState(undefined), [msg, setMsg] = useState(''), [busy, setBusy] = useState('')
  const load = useCallback(() => api('/coros/status').then(setS).catch(() => setS(null)), [])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!s?.running) return; const t = setInterval(load, 3000); return () => clearInterval(t) }, [s?.running, load])
  useEffect(() => { const q = new URLSearchParams(location.search).get('coros'); if (q) setMsg(q === 'ok' ? 'COROS connected. Try "Test connection", then pull data.' : 'Could not connect COROS: ' + (new URLSearchParams(location.search).get('why') || 'try again')) }, [])
  const act = (name, fn) => async () => { setBusy(name); setMsg(''); try { setMsg(await fn()) } catch (e) { setMsg('Failed: ' + e.message) } setBusy(''); load() }
  const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
  const job = s?.jobs?.[0]

  return <Card title="COROS — direct connection" right={s && <Chip tone={s.connected ? 'green' : 'yellow'}>{s.connected ? 'connected' : 'not connected'}</Chip>}>
    {s === undefined && <p className="muted">Loading…</p>}
    {s === null && <p className="muted">Status unreachable.</p>}
    {s && !s.connected && <>
      <p className="muted">Lumpad pulls data straight from COROS (official, OAuth). You log in and consent at COROS once; the token is stored encrypted on your server.</p>
      <a className="btn primary" href="/api/coros/login">Connect COROS</a>
    </>}
    {s?.connected && <>
      <dl className="kv"><div><dt>Access token until</dt><dd>{s.access_expires_at.slice(0, 10)} (renews automatically)</dd></div>
        <div><dt>Daily sync</dt><dd>automatic ±07:50 WIB</dd></div></dl>
      <div className="row2">
        <button className="btn sm" disabled={!!busy} onClick={act('test', async () => { const r = await post('/coros/test'); return 'Connected ✓ — devices: ' + (r.devices.join(', ') || '—') })}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
        <button className="btn sm" disabled={!!busy || s.running} onClick={act('run', async () => { await post('/sync/run'); return 'Sync started…' })}>Sync now</button>
      </div>
      <ArchivePanel running={s.running} busy={!!busy} onRun={act('ar', async () => { await post('/coros/archive/run'); return 'Archive session started — at most 25 minutes / 200 calls.' })} />
    </>}
    {msg && <p role="status" className="note">{msg}</p>}
    {job && <div className="job">
      <h3>{KIND[job.kind] || job.kind} · {job.status === 'running' ? 'running' : job.status === 'done' ? 'done' : job.status}</h3>
      {job.status === 'running' && <><div className="bar"><i style={{ width: Math.round(((job.progress.done || 0) / (job.progress.total || 1)) * 100) + '%' }} /></div><p className="muted">{STAGE[job.progress.stage] || 'Starting…'}{job.progress.tool ? ` · ${job.progress.tool} ${job.progress.day}` : ''} · {job.progress.done ?? 0}/{job.progress.total ?? '?'}</p></>}
      {job.status === 'done' && job.kind === 'archive' && <p className="muted">{job.progress.calls} calls · {job.progress.done} filled · {job.progress.empty} empty{job.progress.failed ? ` · ${job.progress.failed} failed` : ''} · {ago(job.finished_at)}{job.progress.stopped ? ` · stopped: ${job.progress.stopped}` : ''}</p>}
      {job.status === 'done' && job.kind !== 'archive' && <p className="muted">{job.progress.counts?.health} health days · {job.progress.counts?.activities} activities · {job.progress.counts?.laps} laps · {ago(job.finished_at)}{job.progress.rejected ? ` · ${job.progress.rejected} rejected` : ''}{job.progress.stats?.lapsMissing ? ` · missing laps: ${job.progress.stats.lapsMissing} runs` : ''}</p>}
      {job.error && <p className="muted" role="alert">{job.error}</p>}
      {job.status === 'done' && job.progress.notes?.length > 0 && <details><summary className="muted">Notes ({job.progress.notes.length})</summary><ul>{job.progress.notes.map((n, i) => <li key={i} className="muted">{n}</li>)}</ul></details>}
    </div>}
    {s?.connected && <button className="btn sm full ghost" disabled={!!busy} onClick={act('dc', async () => { if (!confirm('Disconnect COROS? Data already stored is kept.')) return ''; await post('/coros/disconnect'); return 'Disconnected.' })}>Disconnect COROS</button>}
  </Card>
}
