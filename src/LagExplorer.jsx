import { useMemo, useState } from 'react'
import { useApi } from './api.js'
import { Card, Chip } from './ui.jsx'
import { scan, strongest } from './lib/xcorr.js'
import { today, addDays } from './lib/calendar.js'

const EXPOSURES = [['load', 'Daily training load (TL)', (r) => r.load], ['sleep', 'Sleep duration (min)', (r) => r.sleep_total_min], ['rhr', 'Resting HR (bpm)', (r) => r.resting_hr]]
const OUTCOMES = [['hrv', 'Overnight HRV (ms)', (r) => r.hrv_avg], ['rhr', 'Resting HR (bpm)', (r) => r.resting_hr], ['shr', 'Sleep HR (bpm)', (r) => r.sleep_hr_avg], ['sleep', 'Sleep duration (min)', (r) => r.sleep_total_min]]

// Interactive 1–28 day lagged cross-correlation: exposure at day t−lag against outcome at day t, from your own synced data.
export default function LagExplorer() {
  const T = today(), R = useApi(`/api/readiness?from=${addDays(T, -240)}&to=${T}`), [xk, setXk] = useState('load'), [yk, setYk] = useState('hrv'), [max, setMax] = useState(28)
  const rows = useMemo(() => {
    if (!R.data) return null
    const days = {}; for (const h of R.data.health || []) days[h.date] = { ...h }; for (const l of R.data.loads || []) days[l.date] = { ...(days[l.date] || {}), load: l.load }
    const series = (f) => Object.fromEntries(Object.entries(days).map(([d, r]) => [d, f(r)]).filter(([, v]) => v != null))
    // missing load days on a day with health data count as rest (0), as in the load model
    const xs = series((r) => (xk === 'load' ? r.load ?? 0 : EXPOSURES.find((e) => e[0] === xk)[2](r))), ys = series(OUTCOMES.find((o) => o[0] === yk)[2])
    return scan(xs, ys, 1, max)
  }, [R.data, xk, yk, max])
  const best = rows && strongest(rows), W = 300, H = 110, bw = rows ? W / rows.length : 0, mid = H / 2
  return <Card title="Lagged cross-correlation explorer" right={<Chip>exploratory</Chip>}>
    <div className="form">
      <label className="fld"><span>Exposure (day t − lag)</span><select value={xk} onChange={(e) => setXk(e.target.value)}>{EXPOSURES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="fld"><span>Outcome (day t)</span><select value={yk} onChange={(e) => setYk(e.target.value)}>{OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="fld" style={{ gridColumn: 'span 2' }}><span>Longest lag: <b>{max} days</b></span><input type="range" min={7} max={28} value={max} onChange={(e) => setMax(+e.target.value)} aria-label="Longest lag in days" /></label>
    </div>
    {!rows ? <div className="skel" style={{ height: 110 }} /> : rows.every((r) => r.r == null) ? <p className="muted">Not enough overlapping days yet (needs ≥ 20 per lag).</p> : <>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="chart" role="img" aria-label={`Correlation by lag, 1 to ${max} days. Strongest: lag ${best?.lag} days, r ${best?.r}`}>
        <line x1="0" x2={W} y1={mid} y2={mid} className="gridl" />
        {rows.map((r, i) => r.r != null && <rect key={r.lag} x={i * bw + 1} width={Math.max(1, bw - 2)} y={r.r >= 0 ? mid - r.r * (mid - 4) : mid} height={Math.max(1, Math.abs(r.r) * (mid - 4))} rx="1.5" style={{ fill: r.lo > 0 || r.hi < 0 ? 'var(--c-long)' : 'var(--c-rest)' }} />)}
        {[1, Math.round(max / 2), max].map((l) => <text key={l} x={(l - 1) * bw + bw / 2} y={H + 12} className="gt" textAnchor="middle">{l}d</text>)}
      </svg>
      <div className="legend"><span><i className="kdot" style={{ background: 'var(--c-long)' }} />95% interval excludes 0</span><span><i className="kdot" style={{ background: 'var(--c-rest)' }} />interval includes 0</span></div>
      {best && <p><b>Strongest: lag {best.lag} d · r = {best.r}</b> (95% CI {best.lo} … {best.hi}, n = {best.n})</p>}
    </>}
    <p className="src-note">Association, not cause. Up to {max} lags are compared at once with no multiple-comparison correction here, so a single standout lag is a hypothesis to test, not a finding. Confirmed edges (with FDR control) live under Memory → Correlations.</p>
  </Card>
}
