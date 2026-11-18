import { useEffect, useMemo, useRef, useState } from 'react'
import { paces } from './lib/vdot.js'
import { sessionPaces } from './lib/pace.js'
import { BY_DATE, WEEKS, weekOf, today, parse, iso, addDays, mondayOf, MONTHS, MON3, fmtLong, KIND, PHASE_NAME, PLAN_START, RACE_DATE } from './lib/calendar.js'
import { Chip, Screen, Sheet, Icon, StrengthChips } from './ui.jsx'
import { useApi } from './api.js'
import Checkpoints from './Checkpoints.jsx'
import Race from './Race.jsx'
import { Gantt, Combo } from './charts2.jsx'
import { compliance } from './lib/analysis.js'
import { dailyLoadSeries, pmc } from './lib/load.js'
import { PLAN } from './lib/calendar.js'
import { useStore } from './store.js'

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
  const [regs] = useStore('lumpad.registrations', {}), reg = d && regs?.[d.date]
  const phase = (() => { const c = {}; Object.values(BY_DATE).filter((x) => +x.date.slice(5, 7) === month + 1).forEach((x) => (c[x.phase] = (c[x.phase] || 0) + 1)); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] })()
  const step = (n) => { const t = addDays(sel, n); if (BY_DATE[t]) { setSel(t); setMonth(+t.slice(5, 7) - 1) } }
  const todayMonth = inPlan ? parse(T).getMonth() : null

  const first = `2027-${String(month + 1).padStart(2, '0')}-01`, last = `2027-${String(month + 1).padStart(2, '0')}-31`
  const A = useApi(`/api/activities/merged?from=${first}&to=${last}`)
  const done = useMemo(() => { const m = {}; for (const a of A.data || []) if (a.sport_class === 'run' && a.distance_m) m[a.date] = (m[a.date] || 0) + a.distance_m / 1000; return m }, [A.data])
  const [wsel, setWsel] = useState(null), [macro, setMacro] = useState(false)
  const Y0 = '2026-12-28', Y1 = '2027-12-31'
  const YA = useApi(macro || wsel ? `/api/activities/merged?from=${Y0}&to=${Y1}` : '', macro || !!wsel), YR = useApi(macro || wsel ? `/api/readiness?from=${Y0}&to=${T < Y1 ? T : Y1}` : '', macro || !!wsel)
  const weekStats = useMemo(() => {
    const acts = (YA.data || []).filter((a) => a.sport_class === 'run'), loads = Object.fromEntries((YR.data?.loads || []).map((l) => [l.date, l.load]))
    const series = YR.data?.loads?.length ? dailyLoadSeries(YR.data.loads, Y0, T < Y1 ? T : Y1) : [], P = pmc(series), ctlAt = Object.fromEntries(P.map((x) => [x.date, x.ctl]))
    return WEEKS.map((w) => { const mon = mondayOf(w.days[0].date), ds = Array.from({ length: 7 }, (_, i) => addDays(mon, i)), a = acts.filter((x) => ds.includes(x.date))
      const actual = a.reduce((s, x) => s + x.distance_m / 1000, 0), longest = Math.max(0, ...a.map((x) => x.distance_m / 1000))
      return { id: w.id, mon, plan: w.km, actual: mon <= T ? Math.round(actual * 10) / 10 : null, load: mon <= T ? ds.reduce((s, d) => s + (loads[d] || 0), 0) : null, ctl: ctlAt[ds.find((d) => ctlAt[d] != null && d <= T && d >= ds[0]) || ''] ?? null,
        longPct: actual ? Math.round((longest / actual) * 100) : null, mark: w.days.some((d) => d.kind === 'race') ? 'race' : w.days.some((d) => d.tags.some((t) => /^CP\d+$/.test(t))) ? 'cp' : null, current: ds.includes(T) } })
  }, [YA.data, YR.data, T])
  const segs = useMemo(() => { const out = []; for (const d of PLAN) { const c = d.phase.replace(/[^A-Z]/g, ''); if (out.at(-1)?.cls === c) out.at(-1).n++; else out.push({ cls: c, label: PHASE_NAME[d.phase] || d.phase, n: 1 }) } return out.map((s) => ({ ...s, frac: s.n / PLAN.length })) }, [])
  const todayFrac = T >= PLAN[0].date && T <= PLAN.at(-1).date ? PLAN.findIndex((d) => d.date === T) / PLAN.length : null
  const ws = wsel && weekStats.find((w) => w.mon === wsel)
  return <>
    <p className="sub" style={{ marginTop: -4, marginBottom: 10 }}>{PHASE_NAME[phase] || ''} · {monthKm(month)} km bulan ini · total 2.873 km</p>
    <Gantt segs={segs} todayFrac={todayFrac} label={'Fase 2027: ' + segs.map((s) => s.label).join(' → ')} />
    <Season month={month} setMonth={setMonth} T={T} />
    <details className="card fold" open={macro} onToggle={(e) => setMacro(e.currentTarget.open)}><summary>Volume vs beban (setahun)</summary>
      {YA.state === 'loading' ? <div className="skel" /> : <><Combo weeks={weekStats} label="Km mingguan rencana vs aktual dengan training load dan fitness" />
      <div className="legend"><span><i className="kdot" style={{ border: '1px dashed var(--muted)', background: 'transparent' }} />Rencana km</span><span><i className="kdot" style={{ background: 'var(--c-long)' }} />Aktual km</span><span><i className="ll" style={{ borderColor: 'var(--c-quality)' }} />Training load</span><span><i className="ll" style={{ borderColor: 'var(--c-tt)', borderTopStyle: 'dashed' }} />Fitness (CTL×7)</span><span>◆ CP · <b style={{ color: 'var(--accent)' }}>◆</b> race</span></div></>}
    </details>
    <div className="monthbar">
      <button disabled={month === 0} onClick={() => setMonth(month - 1)} aria-label="Bulan sebelumnya"><Icon n="left" /></button>
      <div className="mid"><h2 aria-live="polite">{MONTHS[month]}</h2>{inPlan && <button onClick={() => { setMonth(todayMonth); setSel(T) }}>Ke hari ini</button>}</div>
      <button disabled={month === 11} onClick={() => setMonth(month + 1)} aria-label="Bulan berikutnya" className="flip"><Icon n="left" /></button>
    </div>
    <div className="cal" role="group" aria-label={`Kalender ${MONTHS[month]} 2027`}>
      <div className="calh" aria-hidden="true"><span title="Minggu dan total km">Mgg</span>{['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((x) => <span key={x}>{x}</span>)}</div>
      {weeks.map((wk, i) => { const w = weekOf(wk.find((x) => BY_DATE[x]) || ''); return <div className="calw" key={i}>
        <button className="wl" onClick={() => w && setWsel(mondayOf(wk[0]) === wsel ? null : mondayOf(wk[0]))} aria-label={w ? `Minggu ${w.id.slice(1)}, rencana ${Math.round(w.km)} km. Ringkasan minggu` : undefined}><b>{w?.id || ''}</b><small>{w ? Math.round(w.km) : ''}</small></button>
        {wk.map((s) => { const x = BY_DATE[s], inm = +s.slice(5, 7) === month + 1, c = cpOf(x)
          return <button key={s} disabled={!x} aria-label={describe(s, x) + (done[s] ? `, sudah lari ${done[s].toFixed(1)} km` : '')} aria-current={s === T ? 'date' : undefined}
            className={`cell ${x ? 'k-' + x.kind : 'k-none'} ${x ? 'cmp-' + compliance(x.km, done[s] || 0, s < T) : ''} ${inm ? '' : 'out'} ${s === T ? 'today' : ''} ${s === raceDate ? 'raceday' : ''}`} onClick={() => setSel(s)}>
            <i>{+s.slice(8)}</i>{done[s] ? <span className="done" aria-hidden="true">✓</span> : null}<b>{x && x.km ? x.km : ''}</b>{c && <em>{c}</em>}{!c && x && <u>{KIND[x.kind].short}</u>}</button> })}
      </div> })}
    </div>
    <div className="legend" aria-label="Keterangan warna">{['easy', 'long', 'quality', 'tt', 'speed', 'race', 'rest'].map((k) => <span key={k}><i className={`kdot k-${k}`} />{KIND[k].label} <b>({KIND[k].short})</b></span>)}</div>
    {ws && <div className="card" role="region" aria-label="Ringkasan minggu"><div className="ch"><h2>{ws.id} · mulai {ws.mon.slice(5)}</h2><button className="link" onClick={() => setWsel(null)}>Tutup</button></div>
      <div className="score-grid"><div><small>Rencana</small><b>{ws.plan}</b><em>km</em></div><div><small>Aktual</small><b>{ws.actual ?? '—'}</b><em>{ws.actual != null && ws.plan ? Math.round((ws.actual / ws.plan) * 100) + '%' : 'km'}</em></div><div><small>Training load</small><b>{ws.load ?? '—'}</b></div>
        <div><small>Long run</small><b>{ws.longPct != null ? ws.longPct + '%' : '—'}</b><em>dari volume</em></div></div></div>}
    <p className="muted">Angka = km rencana · ✓ = sudah dilari · bingkai: hijau ±10% · kuning 10–30% · merah lebih jauh · putus-putus = terlewat. Ketuk nomor minggu untuk ringkasan.</p>

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
        <div className="chips">{reg && <Chip tone="green">terdaftar ✓{reg.bib ? ` · BIB ${reg.bib}` : ''}</Chip>}<StrengthChips day={d} />{d.tags.filter((t) => /^CP|^MP/.test(t)).map((t) => <Chip key={t} tone="cp">{t}</Chip>)}</div>
        {sessionPaces(d, p).length > 0 && <dl className="pace">{sessionPaces(d, p).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
        {d.note && <p className="note">{d.note}</p>}
        {d.event && <p className="note">♥ {d.event}</p>}
        {reg && <p className="note">{reg.event} · {reg.distance} · {reg.category}{reg.start ? ` · ${reg.start} → ${reg.finish}` : ''}</p>}
        <p className="src">Pace dari VDOT {vdot.v.toFixed(1)} · {vdot.src}</p>
      </>}
    </Sheet>
  </>
}

const TITLES = { month: ['Calendar', 'Rencana 2027, ketuk hari untuk preskripsi'], cp: ['Checkpoints', 'CP1–CP20: tes, gate, dan jalur VDOT'], race: ['Races', 'Dari race terdekat sampai JRF sub-4'] }
export default function Calendar({ view = 'month', vdot, results, setResults, focus, settings, go }) {
  return <Screen title={TITLES[view][0]} sub={TITLES[view][1]}>
    {view === 'month' && <MonthView vdot={vdot} focus={typeof focus === 'string' ? focus : null} raceDate={settings.raceDate} />}
    {view === 'cp' && <Checkpoints vdot={vdot} results={results} setResults={setResults} focus={focus?.id} />}
    {view === 'race' && <Race vdot={vdot} results={results} settings={settings} go={go} />}
  </Screen>
}
