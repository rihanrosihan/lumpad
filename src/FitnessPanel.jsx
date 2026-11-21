import { useMemo } from 'react'
import { Card, Chip, ProgressBar, StatusPill } from './ui.jsx'
import { useApi } from './api.js'
import { CHECKPOINTS, TARGET } from './lib/plan.js'
import { paces, fmtTime, fmtPace } from './lib/vdot.js'
import { today, fmtShort } from './lib/calendar.js'

// Fitness: where you are (status), what you are measured against (baseline), and how it is moving (progress). Every number comes from the app's own model,
// your checkpoint results or the digital twin; nothing is estimated here.
const f1 = (x, d = 1) => (x == null || !Number.isFinite(+x) ? '—' : (+x).toFixed(d))
const sgn = (x, d = 1) => (x == null ? '—' : (x > 0 ? '+' : '') + (+x).toFixed(d))

export default function FitnessPanel({ vdot, results, M, go }) {
  const T = today(), twin = useApi('/api/twin'), B = twin.data?.state?.baselines, p = paces(vdot.v)
  const need = TARGET.vdotNeeded, pctToGoal = Math.max(0, Math.min(100, ((vdot.v - TARGET.baseline) / (need - TARGET.baseline)) * 100))
  const done = useMemo(() => CHECKPOINTS.filter((c) => results?.[c.id]?.vdot != null).map((c) => ({ ...c, v: results[c.id].vdot })), [results])
  const next = CHECKPOINTS.find((c) => c.date >= T)
  const rd = M?.readiness, cur = M?.cur
  const rows = [['EF (efficiency factor)', 'ef', 3, 'higher is fitter'], ['HR at 8:00/km', 'hr_at_800', 1, 'lower is fitter'], ['Pace at HR 150 (s/km)', 'pace_at_hr150_s', 0, 'lower is fitter'], ['Cadence (spm)', 'cadence_spm', 0, ''], ['Ground contact (ms)', 'gct_ms', 0, ''], ['Stride (m)', 'stride_m', 3, '']]
  return <div className="fit-grid">
    <Card title="Current Status" right={<StatusPill tone="cobalt">VDOT {vdot.v.toFixed(1)}</StatusPill>}>
      <div className="fit-kpis">
        <div><small>VDOT now → needed</small><b>{vdot.v.toFixed(1)} → {need}</b><em>from {vdot.src}</em></div>
        <div><small>Marathon at this fitness</small><b>{fmtTime(p.full)}</b><em>goal: sub-4:00</em></div>
        <div><small>Threshold / marathon pace</small><b>{fmtPace(p.T)} · {fmtPace(p.M)}</b><em>/km</em></div>
        <div><small>Readiness</small><b>{rd?.score ?? '—'}{rd?.score != null ? ' / 100' : ''}</b><em>{rd?.tier?.label || 'not enough data'}</em></div>
        <div><small>Fitness (CTL)</small><b>{cur?.ctl ?? '—'}</b><em>ATL {cur?.atl ?? '—'}</em></div>
        <div><small>Form (TSB)</small><b>{cur?.tsb != null ? sgn(cur.tsb) : '—'}</b><em>ACWR {cur?.acwr ?? '—'}</em></div>
      </div>
      <p className="src-note">VDOT comes from your latest time-trial checkpoint (Daniels/Gilbert), so it moves only when you log a checkpoint result.</p>
    </Card>

    <Card title="Current Baseline" right={<Chip>30 d vs 90 d</Chip>}>
      {!B ? <p className="muted">Baselines appear once the pipeline has analysed enough steady runs. {twin.state === 'loading' ? 'Loading…' : ''}</p> : <>
        <div className="scroll" tabIndex={0}><table className="lapt"><thead><tr><th>Metric</th><th>30 days</th><th>90 days</th><th>Δ</th></tr></thead><tbody>
          {rows.map(([label, k, d, hint]) => <tr key={k} title={hint}><td>{label}</td><td>{f1(B.d30?.[k], d)}</td><td>{f1(B.d90?.[k], d)}</td><td>{sgn(B.delta_30_vs_90?.[k], d)}</td></tr>)}
        </tbody></table></div>
        <p className="src-note">Means of steady 3–15 km runs (n = {B.d30?.n ?? 0} in 30 d, {B.d90?.n ?? 0} in 90 d); small n is noisy. EF up, HR@8:00 down or pace@HR150 lower means fitter.</p></>}
      <p className="src-note">Plan baseline: 5K TT VDOT {TARGET.baseline} (checkpoint B0).</p>
    </Card>

    <Card title="Current Progress" right={<button type="button" className="link" onClick={() => go('checkpoint')}>Checkpoints →</button>}>
      <ProgressBar value={pctToGoal} label={`VDOT ${TARGET.baseline} → ${need}`} />
      <p className="muted" style={{ margin: '6px 0 10px', fontSize: '.8rem' }}>{vdot.v.toFixed(1)} now: {Math.round(pctToGoal)}% of the way to the VDOT needed for sub-4:00 ({sgn(vdot.v - TARGET.baseline)} since baseline).</p>
      {done.length ? <div className="fit-cps">{done.map((c) => <div key={c.id}><b>CP{c.id}</b><span>{c.name}</span><em>VDOT {f1(c.v)}</em><small>{fmtShort(c.date)}</small></div>)}</div>
        : <p className="muted">No checkpoint result logged yet.{next ? ` Next: CP${next.id} · ${next.name} on ${fmtShort(next.date)}.` : ''}</p>}
      {next && done.length > 0 && <p className="src-note">Next checkpoint: CP{next.id} · {next.name} · {fmtShort(next.date)}</p>}
    </Card>
  </div>
}
