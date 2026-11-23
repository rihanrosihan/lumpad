// Home: shown from the afternoon when today's planned run has not happened. Evening / tomorrow / let it go, each with the checks behind it.
import { useState } from 'react'
import { useApi } from './api.js'
import { missedPlan, REASONS, AFTERNOON_FROM } from './lib/missed.js'
import { painToday } from './lib/watch.js'
import { BY_DATE } from './lib/calendar.js'
import { useStore } from './store.js'

const wibHour = () => { const q = new URLSearchParams(location.search).get('hour'); if (/^\d{1,2}$/.test(q || '')) return +q; return new Date(Date.now() + 7 * 3600e3).getUTCHours() }
const TAG = { ok: 'Good option', caution: 'Possible, with care', no: 'Not advised' }

export default function MissedSession({ day, date, runsToday, checkin, tier, weekly4w }) {
  const [reason, setReason] = useState('time'), [folded, setFolded] = useState(false), [pick, setPick] = useStore('lumpad.missed.' + date, {})
  const twin = useApi('/api/twin').data?.state
  const hour = wibHour()
  if (!day || runsToday > 0 || hour < AFTERNOON_FROM) return null
  const r = missedPlan(BY_DATE, date, { hour, reason, tier, chose: pick.choice || null, pain: painToday(checkin), load: { tsb: twin?.load ? Math.round((twin.load.ctl - twin.load.atl) * 10) / 10 : null, acwr: twin?.load?.acwr_ewma ?? null }, weekly4w: twin?.load?.weekly_km_4w ?? weekly4w ?? null })
  if (!r) return null
  return <section className="hv2-card hv2m" aria-label="Today's run has not happened yet">
    <div className="hv2m-headrow">
      <div className="hv2m-head"><small>CHECK-IN · {String(hour).padStart(2, '0')}:{String(new Date().getMinutes()).padStart(2, '0')} WIB</small><b>No run yet: {r.day.label || r.day.kind} · {r.km} km</b></div>
      <button type="button" className="hv2-btn" aria-expanded={!folded} onClick={() => setFolded((f) => !f)}>{folded ? 'Expand ⌄' : 'Collapse ⌃'}</button>
    </div>
    {!folded && <>
      <p className="muted">Three ways forward. Moving it to tomorrow can change the whole week, so it is checked against your rules first. This is advice; the plan is not edited.</p>
      <div className="hv2m-reasons" role="group" aria-label="What happened?"><span>What happened?</span><div className="hv2m-seg">{REASONS.map((x) => <button key={x.id} type="button" className={`hv2m-opt ${reason === x.id ? 'on' : ''}`} aria-pressed={reason === x.id} onClick={() => setReason(x.id)}>{x.label}</button>)}</div></div>
      {r.note && <p className="hv2m-note" role="note">{r.note}</p>}
      <div className="hv2m-grid">{r.scenarios.map((s) => <div key={s.id} className={`hv2m-sc v-${s.verdict} ${r.recommended === s.id ? 'rec' : ''}`}>
        <div className="hv2m-top"><b>{s.title}</b><span className={`hv2-tag v-${s.verdict}`}>{r.recommended === s.id ? 'Recommended' : TAG[s.verdict]}</span></div>
        <p className="hv2m-do">{s.do}</p>
        <div className="hv2m-body">
          {(() => { const sorted = [...s.checks.filter((c) => !c.ok), ...s.checks.filter((c) => c.ok)], top = sorted.slice(0, 5), more = sorted.slice(5)
            const li = (c, i) => <li key={i} className={`c-${c.level}`}><span aria-hidden="true">{c.ok ? '✓' : c.level === 'fail' ? '✕' : '!'}</span><span>{c.text}</span></li>
            return <><ul className="hv2m-checks">{top.map(li)}</ul>{more.length > 0 && <details className="hv2m-more"><summary>{more.length} more check{more.length > 1 ? 's' : ''}</summary><ul className="hv2m-checks">{more.map(li)}</ul></details>}</> })()}
          {s.revisit && <small className="muted">{s.revisit}</small>}
        </div>
        <div className="hv2m-foot"><code>{s.week}</code>
          {s.verdict !== 'no' && <button type="button" className={`hv2-btn ${r.chose === s.id ? 'on' : ''}`} aria-pressed={r.chose === s.id} onClick={() => setPick({ choice: r.chose === s.id ? null : s.id, at: Date.now() })}>{r.chose === s.id ? (s.id === 'evening' ? 'Chosen: I run tonight (decide again at 20:00)' : 'Chosen') : 'Choose this'}</button>}</div>
      </div>)}</div>
    </>}
  </section>
}
