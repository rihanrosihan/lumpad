import { useMemo, useState } from 'react'
import { SegmentedTabs, Card, Chip } from './ui.jsx'
import { WEEKS, weekOf, today, PHASE_NAME, PLAN_KM, KIND, fmtShort, fmtLong, DAYS3 } from './lib/calendar.js'
import { CHECKPOINTS, TARGET } from './lib/plan.js'
import { paces, fmtPace } from './lib/vdot.js'
import { useStore } from './store.js'
import { WorkoutLine, metaFor } from './Workout.jsx'
import { cfgOf, fmtDur } from './lib/zones.js'

// Season Hub: one header and one tab row (Calendar | Plan | Checkpoints | Races) over the existing pages. The tab is the route, so links and the back button keep working.
const TABS = [{ id: 'calendar', label: 'Calendar' }, { id: 'season', label: 'Plan' }, { id: 'checkpoint', label: 'Checkpoints' }, { id: 'race', label: 'Races' }]

export function HubHeader({ active, go }) {
  const T = today(), w = weekOf(T), phase = w ? (PHASE_NAME[w.phase] || w.phase) : 'Off plan'
  return <div className="hub-head">
    <div className="hub-title"><div><h1>Season Hub</h1><p className="sub">2027 Season · {PLAN_KM.toLocaleString('en-US')} km roadmap</p></div>{w && <span className="hub-pill">{phase} · {w.id}</span>}</div>
    <div className="hub-tabs"><SegmentedTabs tabs={TABS} value={active} onChange={(id) => go(id)} label="Season hub sections" /></div>
  </div>
}

// Plan tab: the upcoming week with tick-off circles, today's training paces, and the checkpoint ladder
export function PlanView({ vdot, settings, go }) {
  const T = today(), cfg = cfgOf(settings), p = paces(vdot.v)
  const w = weekOf(T) || WEEKS.find((x) => x.days.at(-1).date >= T) || WEEKS[0]
  const [done, setDone] = useStore('lumpad.plan.done', {})
  const days = w.days.filter((d) => d.km > 0 || d.kind === 'gym' || d.kind === 'race'), nDone = days.filter((d) => done[d.date]).length
  const tot = useMemo(() => w.days.reduce((s, d) => s + d.km, 0), [w])
  const next = CHECKPOINTS.filter((c) => c.date >= T)
  return <div className="hub-two">
    <Card title={`Upcoming Week · ${w.id} (${fmtShort(w.days[0].date)} – ${fmtShort(w.days.at(-1).date)})`} right={<Chip tone="green">{nDone} / {days.length} done</Chip>}>
      <p className="muted" style={{ margin: '0 0 8px', fontSize: '.8rem' }}>{PHASE_NAME[w.phase] || w.phase} · {Math.round(tot)} km target · tap the circle to mark done</p>
      <div className="plan-days">{w.days.map((d) => { const m = metaFor(d, cfg), isDone = !!done[d.date], off = !(d.km > 0 || d.kind === 'gym' || d.kind === 'race')
        return <div key={d.date} className={`plan-day ${d.date === T ? 'today' : ''} ${off ? 'off' : ''}`}>
          <button type="button" className={`plan-tick ${isDone ? 'on' : ''}`} disabled={off} aria-pressed={isDone} aria-label={`${fmtLong(d.date)} ${isDone ? 'done' : 'not done'}`} onClick={() => setDone({ ...done, [d.date]: !isDone })}>{isDone ? '✓' : ''}</button>
          <button type="button" className="plan-body" onClick={() => go('calendar', d.date)}>
            <span className="plan-dd"><b>{DAYS3[new Date(d.date + 'T12:00:00').getDay()]}</b> {+d.date.slice(8)}</span>
            <span className="plan-t"><b>{d.label || KIND[d.kind].label}</b>{d.km > 0 ? <small> {d.km} km{m?.sec ? ' · ' + fmtDur(m.sec) : ''}</small> : null}</span>
            <WorkoutLine day={d} />
          </button>
        </div> })}</div>
    </Card>
    <div>
      <Card title="Current Training Paces" right={<span className="muted">VDOT {vdot.v.toFixed(1)} → {TARGET.vdotNeeded}</span>}>
        <div className="hub-kpis"><div><small>Easy (E)</small><b>{fmtPace(p.E[0])}–{fmtPace(p.E[1])}</b></div><div><small>Marathon</small><b>{fmtPace(p.M)} /km</b></div><div><small>Threshold</small><b>{fmtPace(p.T)} /km</b></div></div>
        <p className="src-note">From your latest checkpoint result ({vdot.src}). Daniels/Gilbert pace model.</p>
      </Card>
      <Card title={`Season Checkpoints (CP1–${CHECKPOINTS.length})`} right={<button type="button" className="link" onClick={() => go('checkpoint')}>All →</button>}>
        <div className="hub-cps">{(next.length ? next : CHECKPOINTS).slice(0, 6).map((c) => <button type="button" key={c.id} className="hub-cp" onClick={() => go('checkpoint', { id: c.id })}><b>CP{c.id}</b><span>{c.name}</span><small>{fmtShort(c.date)}</small></button>)}</div>
      </Card>
    </div>
  </div>
}
