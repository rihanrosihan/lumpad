// Home: shown from the afternoon when today's planned run has not happened. Evening / tomorrow / let it go, each with the checks behind it.
import { useState } from 'react'
import { useApi } from './api.js'
import { missedPlan, REASONS, AFTERNOON_FROM } from './lib/missed.js'
import { painToday } from './lib/watch.js'
import { BY_DATE } from './lib/calendar.js'

const wibHour = () => { const q = new URLSearchParams(location.search).get('hour'); if (/^\d{1,2}$/.test(q || '')) return +q; return new Date(Date.now() + 7 * 3600e3).getUTCHours() }
const TAG = { ok: 'Good option', caution: 'Possible, with care', no: 'Not advised' }

export default function MissedSession({ day, date, runsToday, checkin, tier, weekly4w }) {
  const [reason, setReason] = useState('time'), [open, setOpen] = useState(null)
  const twin = useApi('/api/twin').data?.state
  const hour = wibHour()
  if (!day || runsToday > 0 || hour < AFTERNOON_FROM) return null
  const r = missedPlan(BY_DATE, date, { hour, reason, tier, pain: painToday(checkin), load: { tsb: twin?.load ? Math.round((twin.load.ctl - twin.load.atl) * 10) / 10 : null, acwr: twin?.load?.acwr_ewma ?? null }, weekly4w: twin?.load?.weekly_km_4w ?? weekly4w ?? null })
  if (!r) return null
  const show = open || r.recommended
  return <section className="card missed" aria-label="Today's run has not happened yet">
    <div className="missed-head"><small>Afternoon check · {hour}:00 WIB</small><b>No run yet: {r.day.label || r.day.kind} · {r.km} km</b></div>
    <p className="muted">Three ways forward. Moving it to tomorrow can change the whole week, so it is checked against your rules first. This is advice; the plan is not edited.</p>
    <div className="chips" role="group" aria-label="Why it did not happen">{REASONS.map((x) => <button key={x.id} type="button" className={`chip ${reason === x.id ? 'on' : ''}`} aria-pressed={reason === x.id} onClick={() => setReason(x.id)}>{x.label}</button>)}</div>
    {r.note && <p className="missed-note" role="note">{r.note}</p>}
    <div className="missed-grid">{r.scenarios.map((s) => <div key={s.id} className={`missed-sc v-${s.verdict} ${show === s.id ? 'open' : ''}`}>
      <button type="button" className="missed-top" aria-expanded={show === s.id} onClick={() => setOpen(show === s.id && open ? null : s.id)}>
        <b>{s.title}</b><span className={`tmr-pill v-${s.verdict}`}>{r.recommended === s.id ? 'Recommended' : TAG[s.verdict]}</span>
      </button>
      <p className="missed-do">{s.do}</p>
      <small className="muted">{s.week}</small>
      {show === s.id && <>
        <ul className="missed-checks">{s.checks.map((c, i) => <li key={i} className={`c-${c.level}`}><span aria-hidden="true">{c.ok ? '✓' : c.level === 'fail' ? '✕' : '!'}</span> {c.text}</li>)}</ul>
        {s.revisit && <small className="muted">{s.revisit}</small>}
      </>}
    </div>)}</div>
  </section>
}
