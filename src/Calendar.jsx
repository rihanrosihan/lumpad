import { useEffect, useMemo, useState } from 'react'
import { paces } from './lib/vdot.js'
import { sessionPaces } from './lib/pace.js'
import { BY_DATE, WEEKS, weekOf, today, parse, iso, addDays, mondayOf, MONTHS, DAYS, fmtLong, KIND, PHASE_NAME, PLAN_START, RACE_DATE } from './lib/calendar.js'
import { CHECKPOINTS } from './lib/plan.js'
import { Card, Chip, Screen, Sheet, Icon, StrengthChips } from './ui.jsx'

const monthKm = (m) => Math.round(Object.values(BY_DATE).filter((d) => +d.date.slice(5, 7) === m + 1).reduce((a, d) => a + d.km, 0))

function Season({ month, setMonth, T }) {
  const max = Math.max(...WEEKS.map((w) => w.km)), cur = weekOf(T)?.id
  return <div className="season" role="list" aria-label="Volume mingguan">
    {WEEKS.map((w) => { const m = +w.days[Math.floor(w.days.length / 2)].date.slice(5, 7) - 1
      return <button key={w.id} role="listitem" className={`sb ph-${w.phase.replace(/[^A-Z]/g, '')} ${w.id === cur ? 'cur' : ''} ${m === month ? 'inm' : ''}`} onClick={() => setMonth(m)} title={`${w.id} · ${w.km} km`}>
        <i style={{ height: Math.max(4, (w.km / max) * 100) + '%' }} /></button> })}
  </div>
}

export default function Calendar({ vdot, focus }) {
  const T = today(), p = paces(vdot.v)
  const start = T >= PLAN_START && T <= '2027-12-31' ? parse(T).getMonth() : 0
  const [month, setMonth] = useState(start), [sel, setSel] = useState(null)
  useEffect(() => { if (focus && BY_DATE[focus]) { setMonth(+focus.slice(5, 7) - 1); setSel(focus) } }, [focus])
  const weeks = useMemo(() => {
    const first = `2027-${String(month + 1).padStart(2, '0')}-01`, last = iso(new Date(2027, month + 1, 0, 12))
    const out = []; for (let m = mondayOf(first); m <= last; m = addDays(m, 7)) out.push(Array.from({ length: 7 }, (_, i) => addDays(m, i)))
    return out
  }, [month])
  const d = sel && BY_DATE[sel], cp = d?.tags.find((t) => /^CP\d+$/.test(t))
  const phase = (() => { const ds = Object.values(BY_DATE).filter((x) => +x.date.slice(5, 7) === month + 1); const c = {}; ds.forEach((x) => (c[x.phase] = (c[x.phase] || 0) + 1)); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] })()

  return <Screen title="Kalender 2027" sub={`${PHASE_NAME[phase] || ''} · ${monthKm(month)} km bulan ini · total 2.873 km`}>
    <Season month={month} setMonth={setMonth} T={T} />
    <div className="monthbar">
      <button disabled={month === 0} onClick={() => setMonth(month - 1)} aria-label="Bulan sebelumnya"><Icon n="left" /></button>
      <h2>{MONTHS[month]}</h2>
      <button disabled={month === 11} onClick={() => setMonth(month + 1)} aria-label="Bulan berikutnya" className="flip"><Icon n="left" /></button>
    </div>
    <div className="cal" role="grid">
      <div className="calh"><span /> {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((x) => <span key={x}>{x}</span>)}</div>
      {weeks.map((wk, i) => { const w = weekOf(wk.find((x) => BY_DATE[x]) || ''); return <div className="calw" key={i}>
        <span className="wl"><b>{w?.id || ''}</b><small>{w ? Math.round(w.km) : ''}</small></span>
        {wk.map((s) => { const x = BY_DATE[s], inm = +s.slice(5, 7) === month + 1, c = x?.tags.find((t) => /^CP\d+$/.test(t))
          return <button key={s} disabled={!x} className={`cell ${x ? 'k-' + x.kind : 'k-none'} ${inm ? '' : 'out'} ${s === T ? 'today' : ''} ${s === RACE_DATE ? 'raceday' : ''}`} onClick={() => setSel(s)} aria-label={fmtLong(s)}>
            <i>{+s.slice(8)}</i><b>{x && x.km ? x.km : ''}</b>{c && <em>{c}</em>}{!c && x && <u>{KIND[x.kind].short}</u>}</button> })}
      </div> })}
    </div>
    <div className="legend">{['easy', 'long', 'quality', 'tt', 'speed', 'race', 'rest'].map((k) => <span key={k}><i className={`kdot k-${k}`} />{KIND[k].label}</span>)}</div>

    <Sheet open={!!d} onClose={() => setSel(null)}>
      {d && <>
        <p className="muted">{fmtLong(d.date)}</p>
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
  </Screen>
}
