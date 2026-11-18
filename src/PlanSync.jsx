import { useMemo } from 'react'
import { PLAN, today, addDays, mondayOf, fmtShort, PHASE_NAME, PLAN_START } from './lib/calendar.js'
import { weekly, findings, COROS_PLANS } from './lib/corosplan.js'
import { useCorosPlan } from './useCoros.js'
import { useApi } from './api.js'
import { Card, Chip, Screen } from './ui.jsx'

// Plan Sync: how the COROS watch plan and Lumpad's plan fit together, week by week, and where they disagree.
export default function PlanSync({ go }) {
  const T = today(), C = useCorosPlan(), mon = mondayOf(T), A = useApi(`/api/activities/merged?from=${addDays(mon, -28)}&to=${addDays(mon, -1)}`)
  const actualAvg4 = useMemo(() => { if (A.state !== 'ok') return null; return Math.round(((A.data || []).filter((a) => a.sport_class === 'run').reduce((s, a) => s + (a.distance_m || 0) / 1000, 0) / 4) * 10) / 10 }, [A.data, A.state])
  const W = useMemo(() => weekly(PLAN, C.rows).filter((w) => w.lumpad > 0 || w.coros > 0), [C.rows])
  const F = useMemo(() => findings(PLAN, C.rows, { actualAvg4 }), [C.rows, actualAvg4])
  const max = Math.max(1, ...W.map((w) => Math.max(w.lumpad, w.coros)))
  const last = C.rows.at(-1)?.date
  return <Screen title="Plan Sync" sub="COROS watch plan × Lumpad plan">
    <Card title="How they are combined" right={<Chip tone={C.live ? 'green' : undefined}>{C.live ? 'live from COROS' : 'bundled snapshot'}</Chip>}>
      <ul className="rules">
        <li><b>{fmtShort(PLAN_START)} – 31 Dec 2026:</b> the COROS plan <i>is</i> the plan — Lumpad had nothing there, so the season now starts {fmtShort(PLAN_START)}. Home, Calendar and Day Plan show those workouts.</li>
        <li><b>From 1 Jan 2027:</b> Lumpad stays the plan of record (post-injury baseline, checkpoints, gate rules, races, taper). The COROS workout for each date is shown as a second line on its Day Plan page and in the table below.</li>
        <li><b>Read-only:</b> Lumpad never writes to COROS. To change the watch, edit the plan in COROS — the findings below say what.</li>
      </ul>
      <p className="muted">{C.live && C.at ? `Last COROS plan sync: ${C.at.slice(0, 16).replace('T', ' ')} UTC. ` : 'Showing the schedule as it was on 18 Nov 2026; the live copy replaces it after the next COROS sync. '}{C.rows.length} workouts scheduled until {last ? fmtShort(last) : '—'}. COROS plans: {COROS_PLANS.map((p) => `${p.id} ${fmtShort(p.from)}→${fmtShort(p.to)}`).join(' · ')}.</p>
    </Card>
    <Card title={`Findings (${F.length})`}>
      {!F.length && <p className="muted">The two plans agree — nothing to flag.</p>}
      {F.map((f) => <div key={f.id} className="rowbtn plain" style={{ alignItems: 'flex-start' }}><Chip tone={f.tone}>{f.tone === 'red' ? 'check' : f.tone === 'yellow' ? 'note' : 'ok'}</Chip><span><b>{f.title}</b><small style={{ whiteSpace: 'normal' }}>{f.body}</small></span></div>)}
    </Card>
    <Card title="Week by week" right={<span className="muted"><i className="kdot" style={{ background: 'var(--c-long)' }} /> Lumpad · <i className="kdot" style={{ background: 'var(--accent)' }} /> COROS</span>}>
      <div className="psync" role="group" aria-label="Weekly kilometres, Lumpad plan versus COROS plan">
        <div className="psr psh" aria-hidden="true"><span>Week</span><span>Starts</span><span>Lumpad / COROS (km)</span><span>Δ</span></div>
        {W.map((w) => <button key={w.mon} className={`psr ${w.mon === mon ? 'now' : ''}`} onClick={() => go('calendar', w.mon >= PLAN_START ? w.mon : PLAN_START)} aria-label={`Week of ${w.mon}: Lumpad ${w.lumpad} km, COROS ${w.coros} km`}>
          <span><b>{w.id || '—'}</b></span><span>{fmtShort(w.mon)}</span>
          <span className="psb"><i style={{ width: (w.lumpad / max) * 100 + '%', background: 'var(--c-long)' }} /><i style={{ width: (w.coros / max) * 100 + '%', background: 'var(--accent)' }} /><small>{w.lumpad} / {w.coros}</small></span>
          <span className={w.lumpad && Math.abs(w.delta) >= w.lumpad * 0.5 ? 'psd big' : 'psd'}>{w.delta > 0 ? '+' : ''}{w.delta}</span></button>)}
      </div>
      <p className="muted">Weeks run Monday–Sunday. Phases: {[...new Set(PLAN.map((d) => d.phase))].map((p) => PHASE_NAME[p] || p).join(' → ')}. Tap a week to open it in the calendar.</p>
    </Card>
  </Screen>
}
