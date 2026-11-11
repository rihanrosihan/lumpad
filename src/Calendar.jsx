import { useEffect, useMemo, useRef, useState } from 'react'
import { paces } from './lib/vdot.js'
import { sessionPaces } from './lib/pace.js'
import { BY_DATE, WEEKS, weekOf, today, parse, iso, addDays, mondayOf, MONTHS, MON3, fmtLong, KIND, PHASE_NAME, PLAN_START, RACE_DATE } from './lib/calendar.js'
import { Chip, Screen, Sheet, Icon, StrengthChips } from './ui.jsx'
import { useApi } from './api.js'
import Checkpoints from './Checkpoints.jsx'
import Race from './Race.jsx'

const monthKm = (m) => Math.round(Object.values(BY_DATE).filter((d) => +d.date.slice(5, 7) === m + 1).reduce((a, d) => a + d.km, 0))
const monthOfWeek = (w) => +w.days[Math.floor(w.days.length / 2)].date.slice(5, 7) - 1
const cpOf = (d) => d?.tags.find((t) => /^CP\d+$/.test(t))
const describe = (s, x) => `${fmtLong(s)}: ${x ? (x.label || KIND[x.kind].label) + (x.km ? `, ${x.km} km` : '') + (cpOf(x) ? `, ${cpOf(x)}` : '') : 'tidak ada sesi'}`

// One big touch target instead of 53 five-pixel bars: tap or drag anywhere to jump to that week's month.
function Season({ month, setMonth, T }) {
  const ref = useRef(), max = Math.max(...WEEKS.map((w) => w.km)), cur = weekOf(T)?.id
  const pick = (e) => { const r = ref.current.getBoundingClientRect(), x = Math.min(0.999, Math.max(0, (e.clientX - r.left) / r.width)); setMonth(monthOfWeek(WEEKS[Math.floor(x * WEEKS.length)])) }
  return <>
    <div ref={ref} className="season" role="group" aria-label="Volume mingguan sepanjang 2027. Sentuh atau geser untuk pindah bulan; atau pakai tombol bulan di bawah."
      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); pick(e) }} onPointerMove={(e) => e.buttons && pick(e)}>
      {WEEKS.map((w) => <span key={w.id} aria-hidden="true" className={`sb ph-${w.phase.replace(/[^A-Z]/g, '')} ${w.id === cur ? 'cur' : ''} ${monthOfWeek(w) === month ? 'inm' : ''}`}><i style={{ height: Math.max(4, (w.km / max) * 100) + '%' }} /></span>)}
    </div>
    <div className="smonths" aria-hidden="true">{MON3.map((m, i) => <span key={m} className={i === month ? 'on' : ''}>{m[0]}</span>)}</div>
  </>
}

function MonthView({ vdot, focus, raceDate }) {
  const T = today(), p = paces(vdot.v)
  const inPlan = T >= PLAN_START && T <= '2027-12-31'
  const [month, setMonth] = useState(inPlan ? parse(T).getMonth() : 0), [sel, setSel] = useState(null)
  useEffect(() => { if (focus && BY_DATE[focus]) { setMonth(+focus.slice(5, 7) - 1); setSel(focus) } }, [focus])
  const weeks = useMemo(() => {
    const first = `2027-${String(month + 1).padStart(2, '0')}-01`, last = iso(new Date(2027, month + 1, 0, 12))
    const out = []; for (let m = mondayOf(first); m <= last; m = addDays(m, 7)) out.push(Array.from({ length: 7 }, (_, i) => addDays(m, i)))
    return out
  }, [month])
  const d = sel && BY_DATE[sel], cp = cpOf(d)
  const phase = (() => { const c = {}; Object.values(BY_DATE).filter((x) => +x.date.slice(5, 7) === month + 1).forEach((x) => (c[x.phase] = (c[x.phase] || 0) + 1)); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] })()
  const step = (n) => { const t = addDays(sel, n); if (BY_DATE[t]) { setSel(t); setMonth(+t.slice(5, 7) - 1) } }
  const todayMonth = inPlan ? parse(T).getMonth() : null

  const first = `2027-${String(month + 1).padStart(2, '0')}-01`, last = `2027-${String(month + 1).padStart(2, '0')}-31`
  const A = useApi(`/api/activities/merged?from=${first}&to=${last}`)
  const done = useMemo(() => { const m = {}; for (const a of A.data || []) if (a.sport_class === 'run' && a.distance_m) m[a.date] = (m[a.date] || 0) + a.distance_m / 1000; return m }, [A.data])
  return <>
    <p className="sub" style={{ marginTop: -4, marginBottom: 10 }}>{PHASE_NAME[phase] || ''} · {monthKm(month)} km bulan ini · total 2.873 km</p>
    <Season month={month} setMonth={setMonth} T={T} />
    <div className="monthbar">
      <button disabled={month === 0} onClick={() => setMonth(month - 1)} aria-label="Bulan sebelumnya"><Icon n="left" /></button>
      <div className="mid"><h2 aria-live="polite">{MONTHS[month]}</h2>{inPlan && <button onClick={() => { setMonth(todayMonth); setSel(T) }}>Ke hari ini</button>}</div>
      <button disabled={month === 11} onClick={() => setMonth(month + 1)} aria-label="Bulan berikutnya" className="flip"><Icon n="left" /></button>
    </div>
    <div className="cal" role="group" aria-label={`Kalender ${MONTHS[month]} 2027`}>
      <div className="calh" aria-hidden="true"><span title="Minggu dan total km">Mgg</span>{['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((x) => <span key={x}>{x}</span>)}</div>
      {weeks.map((wk, i) => { const w = weekOf(wk.find((x) => BY_DATE[x]) || ''); return <div className="calw" key={i}>
        <span className="wl" aria-label={w ? `Minggu ${w.id.slice(1)}, ${Math.round(w.km)} km` : undefined}><b>{w?.id || ''}</b><small>{w ? Math.round(w.km) : ''}</small></span>
        {wk.map((s) => { const x = BY_DATE[s], inm = +s.slice(5, 7) === month + 1, c = cpOf(x)
          return <button key={s} disabled={!x} aria-label={describe(s, x) + (done[s] ? `, sudah lari ${done[s].toFixed(1)} km` : '')} aria-current={s === T ? 'date' : undefined}
            className={`cell ${x ? 'k-' + x.kind : 'k-none'} ${inm ? '' : 'out'} ${s === T ? 'today' : ''} ${s === raceDate ? 'raceday' : ''}`} onClick={() => setSel(s)}>
            <i>{+s.slice(8)}</i>{done[s] ? <span className="done" aria-hidden="true">✓</span> : null}<b>{x && x.km ? x.km : ''}</b>{c && <em>{c}</em>}{!c && x && <u>{KIND[x.kind].short}</u>}</button> })}
      </div> })}
    </div>
    <div className="legend" aria-label="Keterangan warna">{['easy', 'long', 'quality', 'tt', 'speed', 'race', 'rest'].map((k) => <span key={k}><i className={`kdot k-${k}`} />{KIND[k].label} <b>({KIND[k].short})</b></span>)}</div>
    <p className="muted">Angka = km rencana · ✓ = sudah dilari · kolom kiri = nomor minggu dan total km minggu.</p>

    <Sheet open={!!d} onClose={() => setSel(null)} label={d ? fmtLong(d.date) : ''}>
      {d && <>
        <div className="snav">
          <button onClick={() => step(-1)} disabled={!BY_DATE[addDays(sel, -1)]} aria-label="Hari sebelumnya"><Icon n="left" /></button>
          <p>{fmtLong(d.date)}</p>
          <button onClick={() => step(1)} disabled={!BY_DATE[addDays(sel, 1)]} aria-label="Hari berikutnya" className="flip"><Icon n="left" /></button>
        </div>
        <div className="sess-top"><Chip kind={d.kind}>{KIND[d.kind].label}</Chip><span className="muted">{d.week} · {PHASE_NAME[d.phase] || d.phase}</span></div>
        <h2 className="sess-title">{d.label || KIND[d.kind].label}</h2>
        {d.km > 0 && <div className="bigkm"><b>{d.km}</b><span>km</span></div>}
        <div className="chips"><StrengthChips day={d} />{d.tags.filter((t) => /^CP|^MP/.test(t)).map((t) => <Chip key={t} tone="cp">{t}</Chip>)}</div>
        {sessionPaces(d, p).length > 0 && <dl className="pace">{sessionPaces(d, p).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
        {d.note && <p className="note">{d.note}</p>}
        {d.event && <p className="note">♥ {d.event}</p>}
        <p className="src">Pace dari VDOT {vdot.v.toFixed(1)} · {vdot.src}</p>
      </>}
    </Sheet>
  </>
}

export default function Calendar({ vdot, results, setResults, focus, settings, go }) {
  const [view, setView] = useState('month')
  useEffect(() => { if (focus && typeof focus === 'object') setView(focus.view === 'cp' ? 'cp' : focus.view === 'race' ? 'race' : 'month'); else if (focus) setView('month') }, [focus])
  return <Screen title="Kalender" sub="Rencana 2027, checkpoint dan race">
    <div className="seg3" role="group" aria-label="Tampilan kalender">{[['month', 'Kalender'], ['cp', 'Checkpoint'], ['race', 'Race']].map(([k, l]) => <button key={k} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}</div>
    {view === 'month' && <MonthView vdot={vdot} focus={typeof focus === 'string' ? focus : null} raceDate={settings.raceDate} />}
    {view === 'cp' && <Checkpoints vdot={vdot} results={results} setResults={setResults} focus={focus?.id} />}
    {view === 'race' && <Race vdot={vdot} results={results} settings={settings} go={go} />}
  </Screen>
}
