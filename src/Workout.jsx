import { describe, summary, estimate, flat, cfgOf, fmtPace, fmtDur, ZONES, hrRange, paceRange } from './lib/zones.js'
import { easy } from './lib/workouts.js'

// The structured workout of a plan day (auto-scaled days fall back to an easy run of the scaled distance)
export function stepsFor(d) {
  if (!d) return []
  if (d.scaled || !d.steps) return d.km > 0 ? easy(d.km).steps : []
  return d.steps
}
export const metaFor = (d, cfg) => { const s = stepsFor(d); if (!s.length) return null; const e = estimate(s, cfg); return { sec: !d.scaled && d.sec ? d.sec : e.sec, tl: !d.scaled && d.tl ? d.tl : e.tl } }
const rng = (r, f = (x) => x) => (r ? `${f(r[0])}–${f(r[1])}` : '—')

// Intensity profile: one bar per step, width ∝ duration, height ∝ zone (COROS-style workout graph)
function Profile({ steps, cfg }) {
  const f = flat(steps), secs = f.map((s) => estimate([s], cfg).sec || 60), tot = secs.reduce((a, b) => a + b, 0) || 1
  return <div className="wprof" role="img" aria-label={'Workout profile: ' + summary(steps)}>
    {f.map((s, i) => { const z = s.t === 'wu' || s.t === 'cd' ? 1 : s.z || 2; return <i key={i} className={'z' + z} style={{ width: (secs[i] / tot) * 100 + '%', height: 20 + z * 13 + '%' }} /> })}
  </div>
}

export function WorkoutDetail({ day, settings }) {
  const cfg = cfgOf(settings), steps = stepsFor(day)
  if (!steps.length) return null
  const m = metaFor(day, cfg), rows = describe(steps, cfg)
  const Row = ({ r }) => <li className="wstep">
    <span className={"wz z" + (r.z || 0)}>{r.z ? 'Z' + r.z : r.what === 'Warm-up' || r.what === 'Cool-down' ? '—' : '·'}</span>
    <span className="wd"><b>{r.what}</b><small>{r.dose}{r.note ? ' · ' + r.note : ''}</small></span>
    <span className="wt">{r.pace ? <b>{rng(r.pace, fmtPace)} /km</b> : <b>easy</b>}<small>{r.hr ? `HR ${rng(r.hr)} bpm` : 'HR zone 1–2'}</small></span>
  </li>
  return <div className="wout">
    <div className="wmeta"><div><small>Distance</small><b>{day.km || '—'}</b><em>km</em></div><div><small>Duration</small><b>{fmtDur(m.sec)}</b><em>est.</em></div><div><small>Training load</small><b>{m.tl}</b><em>TL</em></div></div>
    <Profile steps={steps} cfg={cfg} />
    <ol className="wsteps">{rows.map((r, i) => r.rep ? <li key={i} className="wrep"><p><b>{r.rep}×</b> repeat</p><ol>{r.steps.map((x, j) => <Row key={j} r={x} />)}</ol></li> : <Row key={i} r={r} />)}</ol>
    <p className="src">Targets from your zones: threshold pace {fmtPace(cfg.tpace)}/km, LTHR {cfg.lthr} bpm{settings?.lthr ? '' : ' (estimate — set yours in Profile)'}. The watch runs the HR zone; pace is the matching range.</p>
  </div>
}

// one-line version for lists: "WU 5′ · 4× (1.6 km Z2 + 3 km Z4) · CD 5′" + the main target
export function mainTarget(day, cfg) {
  const f = flat(stepsFor(day)).filter((s) => s.t !== 'wu' && s.t !== 'cd'), top = f.reduce((a, s) => ((s.pace || s.z) && (!a || (s.z || 0) >= (a.z || 0)) ? s : a), null)
  if (!top) return ''
  const pace = top.pace || (top.z ? paceRange(top.z, cfg) : null), hr = top.z ? hrRange(top.z, cfg) : null
  return `${top.z ? 'Z' + top.z + ' ' + ZONES[top.z].name : 'Target'}: ${pace ? fmtPace(pace[0]) + '–' + fmtPace(pace[1]) + '/km' : ''}${hr ? ` · HR ${hr[0]}–${hr[1]}` : ''}`
}
export const WorkoutLine = ({ day }) => { const s = stepsFor(day); return s.length ? <span className="wline">{summary(s)}</span> : null }
