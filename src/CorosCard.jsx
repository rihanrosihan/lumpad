import { useCallback, useEffect, useState } from 'react'
import { Card, Chip } from './ui.jsx'
import { ago } from './sync.js'

const api = async (path, opts) => { const r = await fetch('/api' + path, opts); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j }
const STAGE = { health: 'Tidur & aktivitas harian', hrv: 'HRV tidur (per minggu)', resting: 'Resting HR', activities: 'Aktivitas (per bulan)', laps: 'Lap lari', archive: 'Arsip', saving: 'Menyimpan', done: 'Selesai' }
const KIND = { daily: 'Harian', backfill: 'Riwayat', archive: 'Arsip 2025–sekarang' }
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
    <h3>Arsip COROS {a.from.slice(0, 4)}–sekarang · {a.complete ? 'lengkap ✓' : `${pct}%`}</h3>
    <div className="bar"><i style={{ width: pct + '%' }} /></div>
    <p className="muted">{a.activities.n} aktivitas{a.activities.first ? ` (${a.activities.first} → ${a.activities.last})` : ''} · {a.fit.files} file FIT ({mb(a.fit.bytes)}) · data kesehatan sejak {a.healthFrom || '—'}</p>
    <p className="muted">Hari ini {a.total.used}/{a.total.cap} panggilan · sisa antrean {a.total.pending}{a.complete ? '' : ` · perkiraan selesai ±${a.etaDays} hari`}. Berjalan otomatis tiap jam (bukan 07–09 WIB) sampai budget harian habis; urut dari tanggal terbaru.</p>
    {limited.length > 0 && <p className="muted">Batas COROS terdeteksi: {limited.map((b) => `${b.bucket} ${b.learned ?? b.cap}/hari${b.blockedToday ? ' (habis hari ini)' : ''}`).join(' · ')}</p>}
    <details><summary className="muted">Rincian per tool</summary><ul>{a.tools.map((t) => <li key={t.tool} className="muted">{t.tool}: {t.done + t.empty} selesai{t.pending ? ` · ${t.pending} antre` : ''}{t.failed ? ` · ${t.failed} gagal` : ''}{t.oldest ? ` · ${t.oldest} → ${t.newest}` : ''}</li>)}</ul></details>
    <button className="btn sm full" disabled={busy || running || a.complete && a.total.pending === 0} onClick={() => onRun().then(load)}>Jalankan sesi arsip sekarang</button>
  </div>
}

export default function CorosCard() {
  const [s, setS] = useState(undefined), [msg, setMsg] = useState(''), [busy, setBusy] = useState('')
  const load = useCallback(() => api('/coros/status').then(setS).catch(() => setS(null)), [])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!s?.running) return; const t = setInterval(load, 3000); return () => clearInterval(t) }, [s?.running, load])
  useEffect(() => { const q = new URLSearchParams(location.search).get('coros'); if (q) setMsg(q === 'ok' ? 'COROS terhubung. Coba "Tes koneksi", lalu tarik data.' : 'Gagal menghubungkan COROS: ' + (new URLSearchParams(location.search).get('why') || 'coba lagi')) }, [])
  const act = (name, fn) => async () => { setBusy(name); setMsg(''); try { setMsg(await fn()) } catch (e) { setMsg('Gagal: ' + e.message) } setBusy(''); load() }
  const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
  const job = s?.jobs?.[0]

  return <Card title="COROS — koneksi langsung" right={s && <Chip tone={s.connected ? 'green' : 'yellow'}>{s.connected ? 'terhubung' : 'belum terhubung'}</Chip>}>
    {s === undefined && <p className="muted">Memuat…</p>}
    {s === null && <p className="muted">Status tidak terjangkau.</p>}
    {s && !s.connected && <>
      <p className="muted">Lumpad menarik data langsung dari COROS (resmi, OAuth). Kamu login dan setuju di COROS satu kali; token disimpan terenkripsi di servermu.</p>
      <a className="btn primary" href="/api/coros/login">Hubungkan COROS</a>
    </>}
    {s?.connected && <>
      <dl className="kv"><div><dt>Token akses sampai</dt><dd>{s.access_expires_at.slice(0, 10)} (diperbarui otomatis)</dd></div>
        <div><dt>Sync harian</dt><dd>otomatis ±07:50 WIB</dd></div></dl>
      <div className="row2">
        <button className="btn sm" disabled={!!busy} onClick={act('test', async () => { const r = await post('/coros/test'); return 'Terhubung ✓ — perangkat: ' + (r.devices.join(', ') || '—') })}>{busy === 'test' ? 'Menguji…' : 'Tes koneksi'}</button>
        <button className="btn sm" disabled={!!busy || s.running} onClick={act('run', async () => { await post('/sync/run'); return 'Sync dimulai…' })}>Sync sekarang</button>
      </div>
      <ArchivePanel running={s.running} busy={!!busy} onRun={act('ar', async () => { await post('/coros/archive/run'); return 'Sesi arsip dimulai — maksimal 25 menit / 200 panggilan.' })} />
    </>}
    {msg && <p role="status" className="note">{msg}</p>}
    {job && <div className="job">
      <h3>{KIND[job.kind] || job.kind} · {job.status === 'running' ? 'berjalan' : job.status === 'done' ? 'selesai' : job.status}</h3>
      {job.status === 'running' && <><div className="bar"><i style={{ width: Math.round(((job.progress.done || 0) / (job.progress.total || 1)) * 100) + '%' }} /></div><p className="muted">{STAGE[job.progress.stage] || 'Memulai…'}{job.progress.tool ? ` · ${job.progress.tool} ${job.progress.day}` : ''} · {job.progress.done ?? 0}/{job.progress.total ?? '?'}</p></>}
      {job.status === 'done' && job.kind === 'archive' && <p className="muted">{job.progress.calls} panggilan · {job.progress.done} terisi · {job.progress.empty} kosong{job.progress.failed ? ` · ${job.progress.failed} gagal` : ''} · {ago(job.finished_at)}{job.progress.stopped ? ` · berhenti: ${job.progress.stopped}` : ''}</p>}
      {job.status === 'done' && job.kind !== 'archive' && <p className="muted">{job.progress.counts?.health} hari kesehatan · {job.progress.counts?.activities} aktivitas · {job.progress.counts?.laps} lap · {ago(job.finished_at)}{job.progress.rejected ? ` · ${job.progress.rejected} ditolak` : ''}{job.progress.stats?.lapsMissing ? ` · lap kurang: ${job.progress.stats.lapsMissing} lari` : ''}</p>}
      {job.error && <p className="muted" role="alert">{job.error}</p>}
      {job.status === 'done' && job.progress.notes?.length > 0 && <details><summary className="muted">Catatan ({job.progress.notes.length})</summary><ul>{job.progress.notes.map((n, i) => <li key={i} className="muted">{n}</li>)}</ul></details>}
    </div>}
    {s?.connected && <button className="btn sm full ghost" disabled={!!busy} onClick={act('dc', async () => { if (!confirm('Putuskan COROS? Data yang sudah tersimpan tetap ada.')) return ''; await post('/coros/disconnect'); return 'Terputus.' })}>Putuskan COROS</button>}
  </Card>
}
