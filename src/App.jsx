import { useMemo, useState } from 'react'
import { useStore, useSyncStatus } from './store.js'
import { paces, fmtPace, fmtTime, vdotFromRace, parseTime } from './lib/vdot.js'
import { TARGET, TEMPLATE, CHECKPOINTS, tone, killGate } from './lib/plan.js'
import { evaluate } from './lib/gate.js'
import Data from './Data.jsx'

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
const todayStr = () => new Date().toISOString().slice(0, 10)
const Tag = ({ t }) => <span className={'tag ' + t.replace(/[^a-z]/gi, '')}>{t}</span>

function latestVdot(results) {
  const done = CHECKPOINTS.filter((c) => results[c.id]?.vdot != null)
  const last = done[done.length - 1]
  return last ? { v: results[last.id].vdot, src: `CP${last.id} (${last.date})` } : { v: TARGET.baseline, src: 'Baseline 10K resmi 1:00:55 (CP1 belum dilari)' }
}

function Today({ results, vdot }) {
  const [date, setDate] = useState(todayStr())
  const [f, setF] = useStore('lumpad.daily.' + date, { sleepHR: '', hrv: '', pain: '', tibia: false, te: '', mealBufferMin: '', plannedMin: '', fasted: false, override: '' })
  const day = new Date(date + 'T12:00:00').getDay()
  const t = TEMPLATE[day], cp = CHECKPOINTS.find((c) => c.date === date)
  const g = evaluate(f, day), p = paces(vdot.v)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? (e.target.value === '' ? '' : +e.target.value) : e.target.value })
  const label = { green: 'Jalankan', yellow: 'Turunkan', red: 'Ganti easy / istirahat' }[g.level]
  return <>
    <label className="row">Tanggal <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /> <b>{DAYS[day]}</b></label>
    <section className={'card gate ' + g.level}>
      <h2>Gate: {label}</h2>
      <ul>{g.reasons.length ? g.reasons.map((r) => <li key={r}>{r}</li>) : <li>Belum ada sinyal merah. Isi data pagi di bawah.</li>}</ul>
      {g.level !== 'green' && <input placeholder="Alasan override (wajib disimpan)" value={f.override} onChange={set('override')} />}
    </section>
    <section className="card">
      <h2>{cp ? `CP${cp.id} · ${cp.name}` : t.run}</h2>
      <p><b>Tujuan:</b> {cp ? cp.note : t.goal}</p>
      {t.note && !cp && <p className="muted">{t.note}</p>}
      <p><b>Strength:</b> {t.strength}</p>
      <h3>Pace dari VDOT {vdot.v.toFixed(1)} <Tag t="ALGORITHMIC" /></h3>
      <p className="muted">Sumber: {vdot.src}</p>
      <table><tbody>
        <tr><td>Easy</td><td>{fmtPace(p.E[1])}–{fmtPace(p.E[0])} /km</td></tr>
        <tr><td>Sub-T</td><td>{fmtPace(p.subT)}</td></tr>
        <tr><td>T</td><td>{fmtPace(p.T)}</td></tr>
        <tr><td>I</td><td>{fmtPace(p.I)}</td></tr>
        <tr><td>Race MP</td><td>{TARGET.mp} (dipakai setelah CP14 & CP16 bersih)</td></tr>
      </tbody></table>
      <p className="muted">Catat suhu/RH/jam start untuk setiap sesi key. Belum ditarik: mileage sepatu, data COROS/Strava.</p>
    </section>
    <section className="card">
      <h2>Data pagi</h2>
      <div className="grid">
        <label>Sleep HR<input type="number" value={f.sleepHR} onChange={set('sleepHR')} /></label>
        <label>HRV<select value={f.hrv} onChange={set('hrv')}><option value="">—</option><option value="normal">Normal</option><option value="reduced">Reduced</option></select></label>
        <label>Nyeri (0–10)<input type="number" min="0" max="10" value={f.pain} onChange={set('pain')} /></label>
        <label>TE kemarin<input type="number" step="0.1" value={f.te} onChange={set('te')} /></label>
        <label>Buffer makan (mnt)<input type="number" value={f.mealBufferMin} onChange={set('mealBufferMin')} /></label>
        <label>Durasi rencana (mnt)<input type="number" value={f.plannedMin} onChange={set('plannedMin')} /></label>
        <label className="chk"><input type="checkbox" checked={f.tibia} onChange={set('tibia')} /> Tibia nyeri tekan</label>
        <label className="chk"><input type="checkbox" checked={f.fasted} onChange={set('fasted')} /> Fasted</label>
      </div>
    </section>
  </>
}

function Checkpoints({ results, setResults, vdot }) {
  const kg = killGate(results)
  const upd = (id, patch) => setResults({ ...results, [id]: { ...results[id], ...patch } })
  return <>
    <section className={'card ' + (kg.fired ? 'gate red' : '')}>
      <h2>Kill gate: {kg.fired ? 'AKTIF' : 'belum menyala'}</h2>
      <p>{kg.fired ? kg.why + ' → pindah ke tier terukur (4:15 / 4:30 / finish-first). Race tetap dilari.' : 'Dua TT merah berturut-turut mulai CP4, atau rasio CP11 < 0,85.'}</p>
    </section>
    {CHECKPOINTS.map((c) => {
      const r = results[c.id] || {}
      const tt = c.kind === 'tt'
      const t = tt && r.vdot != null ? tone(r.vdot, c.line) : null
      return <section key={c.id} className={'card cp ' + (t || '')}>
        <h3>CP{c.id} · {c.date.slice(5)} · {c.name}{tt && <span className="muted"> · line {c.line}</span>}</h3>
        <p className="muted">{c.note}</p>
        {tt && <label className="row">Waktu TT (mm:ss / h:mm:ss)
          <input defaultValue={r.time || ''} placeholder="mis. 29:18" onBlur={(e) => {
            const s = e.target.value; if (!s) return upd(c.id, { time: '', vdot: null })
            const m = /10K/.test(c.name) ? 10000 : 5000
            try { upd(c.id, { time: s, vdot: vdotFromRace(m, parseTime(s)) }) } catch {}
          }} />{r.vdot != null && <b> VDOT {r.vdot.toFixed(1)} → {t}</b>}</label>}
        {c.kind === 'ratio' && <label className="row">Rasio HM (VDOT HM ÷ VDOT 5K/10K terbaru)
          <input type="number" step="0.01" value={r.ratio ?? ''} onChange={(e) => upd(c.id, { ratio: e.target.value === '' ? null : +e.target.value })} /></label>}
        <div className="grid">
          {['Sleep HR', 'HRV', 'Pain', '°C', 'RH %'].map((k) => <label key={k}>{k}<input value={r[k] || ''} onChange={(e) => upd(c.id, { [k]: e.target.value })} /></label>)}
        </div>
      </section>
    })}
  </>
}

function Pace({ vdot }) {
  const [custom, setCustom] = useState('')
  const rows = [31.7, 33.0, 36.0, 38.0, 39.9, ...(+custom ? [+custom] : [])]
  return <section className="card">
    <h2>Tabel pace <Tag t="ALGORITHMIC" /></h2>
    <label className="row">VDOT kustom <input type="number" step="0.1" value={custom} onChange={(e) => setCustom(e.target.value)} /></label>
    <div className="scroll"><table><thead><tr><th>VDOT</th><th>5K</th><th>Easy</th><th>Sub-T</th><th>T</th><th>I</th><th>M</th><th>FM</th></tr></thead><tbody>
      {rows.map((v) => { const p = paces(v); return <tr key={v}><td>{v}</td><td>{fmtTime(p.fiveK)}</td><td>{fmtPace(p.E[1])}–{fmtPace(p.E[0])}</td><td>{fmtPace(p.subT)}</td><td>{fmtPace(p.T)}</td><td>{fmtPace(p.I)}</td><td>{fmtPace(p.M)}</td><td>{fmtTime(p.full)}</td></tr> })}
    </tbody></table></div>
    <p className="muted">Kolom FM = prediksi rasio 1,00. Race sub-4 tetap 5:41/km (rasio 0,95).</p>
    <h3>Jalur vs garis</h3>
    <p>Dibutuhkan {TARGET.vdotNeeded} (rasio 0,95). Saat ini {vdot.v.toFixed(1)} · selisih {(TARGET.vdotNeeded - vdot.v).toFixed(1)} · butuh 1,02 VDOT/bln vs laju terbaik teramati 0,74 <Tag t="HYPOTHESIS n=2" /></p>
  </section>
}

export default function App() {
  const [tab, setTab] = useState('today')
  const [results, setResults] = useStore('lumpad.results', {})
  const vdot = useMemo(() => latestVdot(results), [results])
  const sync = useSyncStatus()
  return <main>
    <header><h1>Lumpad <small className={'sync ' + sync}>{{ ok: '● tersimpan di server', saving: '● menyimpan…', offline: '● offline — hanya di browser ini' }[sync]}</small></h1><p className="muted">{TARGET.goal}</p>
      <div className="banner">Konflik data: berat badan Strava 86,0 kg vs COROS 75,3 kg — COROS/Omron dipakai sampai ditimbang ulang.</div></header>
    <nav>{[['today', 'Hari ini'], ['cp', 'Checkpoint'], ['pace', 'Pace'], ['data', 'Data']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
    {tab === 'today' && <Today results={results} vdot={vdot} />}
    {tab === 'cp' && <Checkpoints results={results} setResults={setResults} vdot={vdot} />}
    {tab === 'pace' && <Pace vdot={vdot} />}
    {tab === 'data' && <Data />}
  </main>
}
