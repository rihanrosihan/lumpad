import { useEffect, useMemo, useRef, useState } from 'react'
import { paces } from './lib/vdot.js'
import { BY_DATE, WEEKS, weekOf, today, iso, addDays, mondayOf, MON3, DAYS3, fmtShort, fmtLong, KIND, PHASE_NAME, PLAN_START, PLAN_END, PLAN_KM, PLAN_MONTHS, monthLabel, PLAN } from './lib/calendar.js'
import { Chip, Icon, SegmentedTabs, StatusPill } from './ui.jsx'
import { useApi } from './api.js'
import Checkpoints from './Checkpoints.jsx'
import Race from './Race.jsx'
import { HubHeader, PlanView } from './SeasonHub.jsx'
import { Gantt, Combo } from './charts2.jsx'
import { effectiveDay } from './lib/scaler.js'
import { compliance } from './lib/analysis.js'
import { dailyLoadSeries, pmc } from './lib/load.js'
import { useStore } from './store.js'
import { WorkoutLine, mainTarget, metaFor } from './Workout.jsx'
import { cfgOf, fmtDur } from './lib/zones.js'

const monthKm = (key) => Math.round(Object.values(BY_DATE).filter((d) => d.date.startsWith(key)).reduce((a, d) => a + d.km, 0))
const monthOfWeek = (w) => w.days[Math.floor(w.days.length / 2)].date.slice(0, 7)
const cpOf = (d) => d?.tags.find((t) => /^CP\d+$/.test(t))
const describe = (s, x) => `${fmtLong(s)}: ${x ? (x.label || KIND[x.kind].label) + (x.km ? `, ${x.km} km` : '') + (cpOf(x) ? `, ${cpOf(x)}` : '') : 'no session'}`

function Season({ month, setMonth, T }) {
  const ref = useRef(), max = Math.max(...WEEKS.map((w) => w.km)), cur = weekOf(T)?.id
  const pick = (e) => { const r = ref.current.getBoundingClientRect(), x = Math.min(0.999, Math.max(0, (e.clientX - r.left) / r.width)); setMonth(monthOfWeek(WEEKS[Math.floor(x * WEEKS.length)])) }
  return <>
    <div ref={ref} className="season" role="group" aria-label="Weekly volume across the season. Touch or drag to change month."
      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); pick(e) }} onPointerMove={(e) => e.buttons && pick(e)}>
      {WEEKS.map((w) => <span key={w.id} aria-hidden="true" className={`sb ph-${w.phase.replace(/[^A-Z]/g, '')} ${w.id === cur ? 'cur' : ''} ${monthOfWeek(w) === month ? 'inm' : ''}`}><i style={{ height: Math.max(4, (w.km / max) * 100) + '%' }} /></span>)}
    </div>
    <div className="smonths" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${PLAN_MONTHS.length},1fr)` }}>{PLAN_MONTHS.map((mo) => <span key={mo.key} className={mo.key === month ? 'on' : ''}>{MON3[mo.m][0]}</span>)}</div>
  </>
}

function MonthView({ vdot, focus, raceDate, onOpen }) {
  const T = today(), [scale] = useStore('lumpad.scale', {})
  const inPlan = T >= PLAN_START && T <= PLAN_END
  const [month, setMonth] = useState(inPlan ? T.slice(0, 7) : PLAN_MONTHS[0].key)
  useEffect(() => { if (focus && BY_DATE[focus]) setMonth(focus.slice(0, 7)) }, [focus])
  const mi = Math.max(0, PLAN_MONTHS.findIndex((x) => x.key === month)), mo = PLAN_MONTHS[mi]
  const weeks = useMemo(() => {
    const first = `${month}-01`, last = iso(new Date(mo.y, mo.m + 1, 0, 12))
    const out = []; for (let m = mondayOf(first); m <= last; m = addDays(m, 7)) out.push(Array.from({ length: 7 }, (_, i) => addDays(m, i)))
    return out
  }, [month, mo])
  const phase = (() => { const c = {}; Object.values(BY_DATE).filter((x) => x.date.startsWith(month)).forEach((x) => (c[x.phase] = (c[x.phase] || 0) + 1)); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] })()
  const todayMonth = inPlan ? T.slice(0, 7) : null

  const first = `${month}-01`, last = `${month}-31`
  const A = useApi(`/api/activities/merged?from=${first}&to=${last}`)
  const done = useMemo(() => { const m = {}; for (const a of A.data || []) if (a.sport_class === 'run' && a.distance_m) m[a.date] = (m[a.date] || 0) + a.distance_m / 1000; return m }, [A.data])
  const [wsel, setWsel] = useState(null), [macro, setMacro] = useState(false)
  const Y0 = addDays(PLAN_START, -56), Y1 = PLAN_END
  const YA = useApi(macro || wsel ? `/api/activities/merged?from=${Y0}&to=${Y1}` : '', macro || !!wsel), YR = useApi(macro || wsel ? `/api/readiness?from=${Y0}&to=${T < Y1 ? T : Y1}` : '', macro || !!wsel)
  const weekStats = useMemo(() => {
    const acts = (YA.data || []).filter((a) => a.sport_class === 'run'), loads = Object.fromEntries((YR.data?.loads || []).map((l) => [l.date, l.load]))
    const series = YR.data?.loads?.length ? dailyLoadSeries(YR.data.loads, Y0, T < Y1 ? T : Y1) : [], P = pmc(series), ctlAt = Object.fromEntries(P.map((x) => [x.date, x.ctl]))
    return WEEKS.map((w) => { const mon = mondayOf(w.days[0].date), ds = Array.from({ length: 7 }, (_, i) => addDays(mon, i)), a = acts.filter((x) => ds.includes(x.date))
      const actual = a.reduce((s, x) => s + x.distance_m / 1000, 0), longest = Math.max(0, ...a.map((x) => x.distance_m / 1000))
      return { id: w.id, mon, plan: w.km, actual: mon <= T ? Math.round(actual * 10) / 10 : null, load: mon <= T ? ds.reduce((s, d) => s + (loads[d] || 0), 0) : null, ctl: ctlAt[ds.find((d) => ctlAt[d] != null && d <= T && d >= ds[0]) || ''] ?? null,
        longPct: actual ? Math.round((longest / actual) * 100) : null, mark: w.days.some((d) => d.kind === 'race') ? 'race' : w.days.some((d) => d.tags.some((t) => /^CP\d+$/.test(t))) ? 'cp' : null, current: ds.includes(T) } })
  }, [YA.data, YR.data, T])
  const ws = wsel && weekStats.find((w) => w.mon === wsel)

  return <>
    <div className="card">
      <div className="prof-cmd-top" style={{ marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: '.82rem' }}><b>{PHASE_NAME[phase] || ''}</b> · {monthKm(month)} km this month</span>
        <StatusPill tone="cobalt">{monthLabel(mo)}</StatusPill>
      </div>
      <Season month={month} setMonth={setMonth} T={T} />
    </div>
    <details className="card fold" open={macro} onToggle={(e) => setMacro(e.currentTarget.open)}><summary>Volume vs load (full season)</summary>
      {YA.state === 'loading' ? <div className="skel" /> : <><Combo weeks={weekStats} label="Weekly km planned vs actual with training load and fitness" />
      <div className="legend"><span><i className="kdot" style={{ border: '1px dashed var(--muted)', background: 'transparent' }} />Planned km</span><span><i className="kdot" style={{ background: 'var(--c-long)' }} />Actual km</span><span><i className="ll" style={{ borderColor: 'var(--c-quality)' }} />Training load</span><span><i className="ll" style={{ borderColor: 'var(--c-tt)', borderTopStyle: 'dashed' }} />Fitness (CTL×7)</span><span>◆ CP · <b style={{ color: 'var(--accent)' }}>◆</b> race</span></div></>}
    </details>
    <div className="card">
      <div className="monthbar" style={{ marginTop: 0 }}>
        <button disabled={mi === 0} onClick={() => setMonth(PLAN_MONTHS[mi - 1].key)} aria-label="Previous month"><Icon n="left" /></button>
        <div className="mid"><h2 aria-live="polite">{monthLabel(mo)}</h2>{inPlan && <button onClick={() => { setMonth(todayMonth) }}>Go to today</button>}</div>
        <button disabled={mi === PLAN_MONTHS.length - 1} onClick={() => setMonth(PLAN_MONTHS[mi + 1].key)} aria-label="Next month" className="flip"><Icon n="left" /></button>
      </div>
      <div className="cal" role="group" aria-label={`${monthLabel(mo)} calendar`}>
        <div className="calh" aria-hidden="true"><span title="Week and total km">Wk</span>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => <span key={x}>{x}</span>)}</div>
        {weeks.map((wk, i) => { const w = weekOf(wk.find((x) => BY_DATE[x]) || ''); return <div className="calw" key={i}>
          <button className="wl" onClick={() => w && setWsel(mondayOf(wk[0]) === wsel ? null : mondayOf(wk[0]))} aria-label={w ? `Week ${w.id.slice(1)}, planned ${Math.round(w.km)} km` : undefined}><b>{w?.id || ''}</b><small>{w ? Math.round(w.km) : ''}</small></button>
          {wk.map((s) => { const x = effectiveDay(BY_DATE[s], scale.items?.[s], T), inm = s.startsWith(month), c = cpOf(x)
            return <button key={s} disabled={!x} aria-label={describe(s, x) + (done[s] ? `, already ran ${done[s].toFixed(1)} km` : '')} aria-current={s === T ? 'date' : undefined}
              className={`cell ${x ? 'k-' + x.kind : 'k-none'} ${x ? 'cmp-' + compliance(x.km, done[s] || 0, s < T) : ''} ${inm ? '' : 'out'} ${s === T ? 'today' : ''} ${s === raceDate ? 'raceday' : ''}`} onClick={() => onOpen(s)}>
              <i>{+s.slice(8)}</i>{done[s] ? <span className="done" aria-hidden="true">✓</span> : null}<b>{x && x.km ? x.km : ''}</b>{c && <em>{c}</em>}{!c && x && <u>{KIND[x.kind].short}</u>}</button> })}
        </div> })}
      </div>
      <div className="legend" aria-label="Workout legend">{['easy', 'long', 'quality', 'tt', 'speed', 'race', 'rest'].map((k) => <span key={k}><i className={`kdot k-${k}`} />{KIND[k].label} <b>({KIND[k].short})</b></span>)}</div>
      <p className="src-note">Number = planned km · ✓ = already run · tap any day for its dedicated workout page, or tap a week number for its summary.</p>
    </div>
    {ws && <div className="card" role="region" aria-label="Week summary"><div className="ch"><h2>{ws.id} · starts {ws.mon.slice(5)}</h2><button className="link" onClick={() => setWsel(null)}>Close</button></div>
      <div className="score-grid"><div><small>Planned</small><b>{ws.plan}</b><em>km</em></div><div><small>Actual</small><b>{ws.actual ?? '—'}</b><em>{ws.actual != null && ws.plan ? Math.round((ws.actual / ws.plan) * 100) + '%' : 'km'}</em></div><div><small>Training load</small><b>{ws.load ?? '—'}</b></div>
        <div><small>Long run</small><b>{ws.longPct != null ? ws.longPct + '%' : '—'}</b><em>of volume</em></div></div></div>}
  </>
}

const weekTotals = (w, cfg) => w.days.reduce((a, d) => { const m = metaFor(d, cfg); return { km: a.km + d.km, sec: a.sec + (m?.sec || 0), tl: a.tl + (m?.tl || 0), runs: a.runs + (d.km > 0 ? 1 : 0) } }, { km: 0, sec: 0, tl: 0, runs: 0 })
function Trend({ sel, setSel, T, cfg }) {
  const tot = useMemo(() => WEEKS.map((w) => ({ id: w.id, ...weekTotals(w, cfg), phase: w.phase })), [cfg])
  const W = 640, H = 120, maxT = Math.max(...tot.map((x) => x.tl)), maxK = Math.max(...tot.map((x) => x.km)), bw = W / tot.length, cur = weekOf(T)?.id
  const line = tot.map((x, i) => `${i ? 'L' : 'M'}${(i + 0.5) * bw},${H - 16 - (x.km / maxK) * (H - 30)}`).join('')
  return <figure className="trend"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Season trend: weekly training load and distance">
    {tot.map((x, i) => <rect key={x.id} x={i * bw + 1} y={H - 16 - (x.tl / maxT) * (H - 30)} width={bw - 2} height={(x.tl / maxT) * (H - 30)} className={`trb ph-${x.phase.replace(/[^A-Z]/g, '')} ${x.id === sel ? 'on' : ''} ${x.id === cur ? 'cur' : ''}`} onClick={() => setSel(x.id)} />)}
    <path d={line} className="tl" />
    {WEEKS.filter((w, i) => i % 8 === 0).map((w) => <text key={w.id} x={(WEEKS.indexOf(w) + 0.5) * bw} y={H - 3} className="gt" textAnchor="middle">{fmtShort(w.days[0].date)}</text>)}
  </svg><figcaption className="legend"><span><i className="kdot" style={{ background: 'var(--c-quality)' }} />Training load / week</span><span><i className="ll" style={{ borderColor: 'var(--text)' }} />Distance</span><span>Tap a bar to open that week</span></figcaption></figure>
}

function WeekView({ T, settings, onOpen }) {
  const cfg = cfgOf(settings), [sel, setSel] = useState(() => weekOf(T)?.id || WEEKS[0].id), i = Math.max(0, WEEKS.findIndex((w) => w.id === sel)), w = WEEKS[i]
  const t = weekTotals(w, cfg), p = i > 0 ? weekTotals(WEEKS[i - 1], cfg) : null, pct = (a, b) => (b ? `${a >= b ? '+' : ''}${Math.round((a / b - 1) * 100)}%` : '')
  return <>
    <div className="card"><Trend sel={sel} setSel={setSel} T={T} cfg={cfg} /></div>
    <div className="card">
      <div className="monthbar" style={{ marginTop: 0 }}>
        <button disabled={i === 0} onClick={() => setSel(WEEKS[i - 1].id)} aria-label="Previous week"><Icon n="left" /></button>
        <div className="mid"><h2 aria-live="polite">{w.id} · {fmtShort(w.days[0].date)} – {fmtShort(w.days.at(-1).date)}</h2><small className="muted">{PHASE_NAME[w.phase] || w.phase}</small>{weekOf(T) && <button onClick={() => setSel(weekOf(T).id)}>This week</button>}</div>
        <button disabled={i === WEEKS.length - 1} onClick={() => setSel(WEEKS[i + 1].id)} aria-label="Next week" className="flip"><Icon n="left" /></button>
      </div>
      <div className="wmeta wk4"><div><small>Distance</small><b>{Math.round(t.km * 10) / 10}</b><em>km {p ? pct(t.km, p.km) : ''}</em></div><div><small>Duration</small><b>{fmtDur(t.sec)}</b><em>est.</em></div><div><small>Training load</small><b>{t.tl}</b><em>TL {p ? pct(t.tl, p.tl) : ''}</em></div><div><small>Runs</small><b>{t.runs}</b><em>days</em></div></div>
      <div className="wlist">{w.days.map((d) => { const m = metaFor(d, cfg), cp = cpOf(d), mt = mainTarget(d, cfg); return <button key={d.date} className={`wday ${d.date === T ? 'today' : ''}`} onClick={() => onOpen(d.date)} aria-label={describe(d.date, d)}>
        <span className="wdd"><b>{DAYS3[(new Date(d.date + 'T12:00:00').getDay())]}</b><small>{+d.date.slice(8)}</small></span>
        <span className={`kbar k-${d.kind}`} aria-hidden="true" />
        <span className="wdm"><b>{d.label || KIND[d.kind].label}{cp && <Chip tone="cp">{cp}</Chip>}</b>
          {d.km > 0 ? <small>{d.km} km · {fmtDur(m?.sec)} · {m?.tl} TL</small> : <small>{d.kind === 'gym' ? 'strength / no running' : d.note && d.note !== 'REST DAY' ? d.note : 'rest'}</small>}
          <WorkoutLine day={d} />{mt && <small className="wtg">{mt}</small>}</span>
        <Icon n="chev" size={18} /></button> })}</div>
    </div>
  </>
}

export default function Calendar({ view = 'month', vdot, results, setResults, focus, settings, go }) {
  const [mode, setMode] = useStore('lumpad.calmode', 'month')
  const T = today()
  const segs = useMemo(() => { const out = []; for (const d of PLAN) { const c = d.phase.replace(/[^A-Z]/g, ''); if (out.at(-1)?.cls === c) out.at(-1).n++; else out.push({ cls: c, label: PHASE_NAME[d.phase] || d.phase, n: 1 }) } return out.map((s) => ({ ...s, frac: s.n / PLAN.length })) }, [])
  const todayFrac = T >= PLAN[0].date && T <= PLAN.at(-1).date ? PLAN.findIndex((d) => d.date === T) / PLAN.length : null

  if (view === 'race') return <section className="screen"><HubHeader active="race" go={go} /><Race vdot={vdot} results={results} settings={settings} go={go} /></section>
  if (view === 'cp') return <section className="screen"><HubHeader active="checkpoint" go={go} /><Checkpoints vdot={vdot} results={results} setResults={setResults} focus={focus?.id} go={go} /></section>

  return <section className="screen">
    <HubHeader active="calendar" go={go} />
    {/* Unified Macrocycle Command Header + Annual Phase Ribbon */}
    <div className="card prof-cmd">
      <div className="prof-cmd-top">
        <div>
          <h1>2027 Macrocycle Calendar ({PLAN_KM.toLocaleString('en-US')} km)</h1>
          <p className="sub">Click any date cell to open its dedicated full-page workout prescription (VDOT paces, gates &amp; shoe pairing)</p>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <Gantt segs={segs} todayFrac={todayFrac} label={'Phases: ' + segs.map((s) => s.label).join(' → ')} />
      </div>

      <div className="prof-cmd-bar">
        <SegmentedTabs tabs={[{ id: 'month', label: 'Month Grid' }, { id: 'week', label: 'Week Detail' }, { id: 'checklist', label: 'Week Checklist' }]} value={mode} onChange={setMode} label="Calendar view" />
      </div>
    </div>

    {mode === 'checklist' ? <PlanView vdot={vdot} settings={settings} go={go} /> : mode === 'week'
      ? <WeekView T={T} settings={settings} onOpen={(d) => go('calendar', d)} />
      : <MonthView vdot={vdot} focus={typeof focus === 'string' ? focus : null} raceDate={settings.raceDate} onOpen={(d) => go('calendar', d)} />}
  </section>
}
