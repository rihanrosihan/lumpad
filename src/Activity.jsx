import { useEffect, useMemo, useState } from 'react'
import { paces, fmtPace } from './lib/vdot.js'
import { BY_DATE, today, addDays, fmtLong, MONTHS, KIND } from './lib/calendar.js'
import { Card, Chip, Screen, Sheet, Icon } from './ui.jsx'
import { useApi, fmtDur, fmtPaceS } from './api.js'
import { BarChart, LineChart, Legend } from './charts.jsx'

const CLASSES = [['all', 'Semua'], ['run', 'Lari'], ['walk', 'Jalan'], ['strength', 'Kekuatan']]
const CLS = (a) => 'k-a' + String(a.sport_class).split(':')[0]
const km = (m) => (m == null ? '—' : (m / 1000).toFixed(m < 10000 ? 2 : 1))
const monthRange = (ym) => { const [y, m] = ym.split('-').map(Number); return [`${ym}-01`, `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`] }
const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number), d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const sportLabel = { run: 'Lari', walk: 'Jalan', strength: 'Kekuatan' }

export default function Activity({ vdot, focus }) {
  const T = today(), [ym, setYm] = useState(T.slice(0, 7)), [cls, setCls] = useState('all'), [sel, setSel] = useState(null)
  const [from, to] = monthRange(ym)
  const A = useApi(`/api/activities/merged?from=${from}&to=${to}`), G = useApi('/api/gear')
  const gear = useMemo(() => Object.fromEntries((G.data || []).map((g) => [g.id, g.name])), [G.data])
  useEffect(() => { if (focus?.id) setSel(focus.id) }, [focus])
  const all = A.data || [], list = all.filter((a) => cls === 'all' || a.sport_class === cls)
  const runs = all.filter((a) => a.sport_class === 'run'), tot = { n: list.length, km: runs.reduce((s, a) => s + (a.distance_m || 0), 0) / 1000, time: list.reduce((s, a) => s + (a.duration_s || 0), 0), tl: list.reduce((s, a) => s + (a.training_load || 0), 0) }

  return <Screen title="Aktivitas" sub="Semua latihan dari COROS dan Strava, digabung">
    <div className="monthbar">
      <button onClick={() => setYm(shiftMonth(ym, -1))} aria-label="Bulan sebelumnya"><Icon n="left" /></button>
      <div className="mid"><h2 aria-live="polite">{MONTHS[+ym.slice(5) - 1]} {ym.slice(0, 4)}</h2>{ym !== T.slice(0, 7) && <button onClick={() => setYm(T.slice(0, 7))}>Ke bulan ini</button>}</div>
      <button onClick={() => setYm(shiftMonth(ym, 1))} aria-label="Bulan berikutnya" className="flip"><Icon n="left" /></button>
    </div>
    <div className="seg3" role="group" aria-label="Filter olahraga">{CLASSES.map(([k, l]) => <button key={k} aria-pressed={cls === k} onClick={() => setCls(k)}>{l}</button>)}</div>
    <div className="sumrow"><div><b>{tot.n}</b><small>aktivitas</small></div><div><b>{tot.km.toFixed(1)}</b><small>km lari</small></div><div><b>{fmtDur(tot.time)}</b><small>waktu</small></div><div><b>{tot.tl || '—'}</b><small>load</small></div></div>

    {A.state === 'loading' && <><div className="skel" style={{ height: 72 }} /><div className="skel" style={{ height: 72 }} /></>}
    {A.state === 'error' && <div className="card empty"><b>Gagal memuat</b>Server tidak terjangkau.</div>}
    {A.state === 'ok' && !list.length && <div className="card empty"><b>{all.length ? 'Tidak ada aktivitas untuk filter ini' : 'Belum ada aktivitas bulan ini'}</b>{all.length ? 'Coba filter “Semua”.' : 'Data masuk lewat sync COROS/Strava — cek Profil › Koneksi.'}</div>}
    <div className="alist">{list.map((a) => <button key={a.id} className={`arow ${CLS(a)}`} onClick={() => setSel(a.ids[0])} aria-label={`${fmtLong(a.date)}: ${a.name}, ${a.distance_m ? km(a.distance_m) + ' km, ' : ''}${fmtDur(a.duration_s)}`}>
      <div className="t"><b>{a.name || sportLabel[a.sport_class] || a.sport}</b><small>{a.date.slice(5)} · {sportLabel[a.sport_class] || a.sport}{a.gear_id && gear[a.gear_id] ? ' · ' + gear[a.gear_id] : ''}{a.sources.length > 1 ? '' : ' · ' + a.sources[0]}</small></div>
      <div className="n"><b>{a.distance_m ? km(a.distance_m) + ' km' : fmtDur(a.duration_s)}</b><small>{a.avg_pace_s_km && a.sport_class === 'run' ? fmtPaceS(a.avg_pace_s_km) + '/km' : a.avg_hr ? a.avg_hr + ' bpm' : ''}</small>{a.training_load ? <span className="tlb2">TL {a.training_load}</span> : null}</div>
    </button>)}</div>
    <Detail id={sel} onClose={() => setSel(null)} gear={gear} vdot={vdot} />
  </Screen>
}

function Detail({ id, onClose, gear, vdot }) {
  const D = useApi(id ? `/api/activities/detail?id=${encodeURIComponent(id)}` : '', !!id), a = D.data
  const p = paces(vdot.v), plan = a ? BY_DATE[a.date] : null, laps = a?.laps || []
  const E = [p.E[1], p.E[0]] // fast..slow, s/km
  const verdict = (() => {
    if (!a || a.sport_class !== 'run' || !a.avg_pace_s_km || !plan || !['easy', 'social', 'long', 'speed'].includes(plan.kind)) return null
    const x = a.avg_pace_s_km; return x < E[0] - 3 ? ['yellow', `Lebih cepat dari easy (${fmtPace(E[0])}–${fmtPace(E[1])})`] : x > E[1] + 3 ? ['yellow', 'Lebih lambat dari rentang easy'] : ['green', 'Dalam rentang easy']
  })()
  return <Sheet open={!!id} onClose={onClose} label={a?.name || 'Detail aktivitas'}>
    {D.state === 'loading' && <div className="skel" style={{ height: 120 }} />}
    {D.state === 'error' && <p className="muted">Gagal memuat detail.</p>}
    {a && <>
      <p className="muted">{fmtLong(a.date)}</p>
      <h2 className="sess-title">{a.name}</h2>
      <div className="chips"><Chip>{sportLabel[a.sport_class] || a.sport}</Chip>{a.sources.map((s) => <Chip key={s}>{s}</Chip>)}{a.training_focus && <Chip tone="str">{a.training_focus}</Chip>}</div>
      <dl className="kv" style={{ marginTop: 10 }}>
        {[['Jarak', a.distance_m ? km(a.distance_m) + ' km' : null], ['Waktu', fmtDur(a.duration_s)], ['Pace', a.avg_pace_s_km && a.sport_class === 'run' ? fmtPaceS(a.avg_pace_s_km) + ' /km' : null], ['HR rata-rata', a.avg_hr ? a.avg_hr + ' bpm' : null],
          ['Cadence', a.cadence ? a.cadence + ' spm' : null], ['Power', a.power ? a.power + ' W' : null], ['Elevasi', a.elevation_m != null ? a.elevation_m + ' m' : null], ['Kalori', a.calories ? a.calories + ' kkal' : null],
          ['Training Load', a.training_load], ['Aerobic / Anaerobic TE', a.aerobic_te != null ? `${a.aerobic_te} / ${a.anaerobic_te ?? '—'}` : null], ['Performa', a.performance],
          ['Cuaca', a.temp_c != null ? `${a.temp_c}°C · RH ${a.humidity ?? '—'}%` : 'belum ditarik'], ['Sepatu', a.gear_id ? gear[a.gear_id] || a.gear_id : 'belum ditarik'], ['Lokasi', a.location]]
          .filter(([, v]) => v != null && v !== '').map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {plan && <Card title="Rencana vs aktual">
        <div className="vs"><div><small>Rencana</small><b>{plan.label}{plan.km ? ` · ${plan.km} km` : ''}</b></div><div><small>Aktual</small><b>{a.distance_m ? km(a.distance_m) + ' km' : fmtDur(a.duration_s)}</b></div></div>
        {a.distance_m && plan.km ? <p className="muted">Selisih jarak: {((a.distance_m / 1000) - plan.km >= 0 ? '+' : '') + ((a.distance_m / 1000) - plan.km).toFixed(2)} km ({Math.round(((a.distance_m / 1000) / plan.km) * 100)}% dari rencana)</p> : null}
        {verdict && <p><Chip tone={verdict[0]}>{verdict[1]}</Chip></p>}
      </Card>}
      {laps.length > 0 ? <Card title="Lap per km">
        <BarChart data={laps.map((l) => ({ date: 'lap' + l.idx, value: l.avg_pace_s_km ? Math.round(3600 / l.avg_pace_s_km * 10) / 10 : 0, tick: String(l.idx) }))} label={`Kecepatan per lap (km/jam): ${laps.map((l) => l.avg_pace_s_km ? (3600 / l.avg_pace_s_km).toFixed(1) : '-').join(', ')}`} />
        <p className="muted">Tinggi batang = kecepatan (km/jam); lebih tinggi = lebih cepat.</p>
        <table className="lapt"><thead><tr><th>Lap</th><th>Jarak</th><th>Pace</th><th>HR</th><th>Cad</th><th>W</th></tr></thead><tbody>
          {(() => { const fast = Math.min(...laps.filter((l) => l.distance_m >= 900).map((l) => l.avg_pace_s_km)); return laps.map((l) => <tr key={l.idx}><td>{l.idx}</td><td>{l.distance_m >= 1000 ? '1,00' : (l.distance_m / 1000).toFixed(2)}</td><td className={l.avg_pace_s_km === fast ? 'fast' : ''}>{fmtPaceS(l.avg_pace_s_km)}</td><td>{l.avg_hr ?? '—'}</td><td>{l.cadence ?? '—'}</td><td>{l.power ?? '—'}</td></tr>) })()}
        </tbody></table>
        <p className="src-note">Sumber: COROS (lap 1 km). Collapse didiagnosis dari pace, power, cadence, HR bersama — bukan satu label.</p>
      </Card> : a.sport_class === 'run' && <p className="muted">Lap belum ditarik untuk lari ini.</p>}
    </>}
  </Sheet>
}
