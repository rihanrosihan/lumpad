import { useRef } from 'react'
import { ACWR_ZONES } from './lib/metrics.js'
import { useBoxW } from './useBoxW.js'

const W = 340
// Line chart: several series over dates. Colours are design tokens; the summary is exposed via aria-label (values also appear as text next to the chart).
export function LineChart({ data, lines, height = 150, label }) {
  if (!data.length) return <p className="muted">No data yet.</p>
  const vals = data.flatMap((d) => lines.map((l) => d[l.key])).filter((v) => v != null), lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo || 1) * 0.12
  const L = 30, R = 8, T = 8, B = 20, X = (i) => L + (i / Math.max(1, data.length - 1)) * (W - L - R), Y = (v) => T + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (height - T - B)
  const ticks = [lo, (lo + hi) / 2, hi].map((v) => Math.round(v))
  const path = (k) => data.map((d, i) => (d[k] == null ? null : `${i && data[i - 1][k] != null ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(d[k]).toFixed(1)}`)).filter(Boolean).join(' ')
  return <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img" aria-label={label}>
    {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} className="gl" /><text x={L - 5} y={Y(t) + 4} className="gt" textAnchor="end">{t}</text></g>)}
    {[0, Math.floor((data.length - 1) / 2), data.length - 1].map((i) => <text key={i} x={X(i)} y={height - 5} className="gt" textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}>{data[i].date.slice(5)}</text>)}
    {lines.map((l) => <g key={l.key}><path d={path(l.key)} className={'ln ' + (l.cls || '')} style={{ stroke: l.color }} />
      {(() => { let i = data.length - 1; while (i >= 0 && data[i][l.key] == null) i--; return i >= 0 && <circle cx={X(i)} cy={Y(data[i][l.key])} r="4" style={{ fill: l.color }} /> })()}</g>)}
  </svg>
}
export function Legend({ items }) { return <div className="legend">{items.map((l) => <span key={l.label}><i className="ll" style={{ borderColor: l.color, borderTopStyle: l.dashed ? 'dashed' : 'solid' }} />{l.label}</span>)}</div> }

// Bars (daily load, weekly km). Today/last bar highlighted; optional plan marker per bar.
export function BarChart({ data, height = 110, label, unit = '', mark }) {
  const ref = useRef(null), W = useBoxW(ref, 340, 100)
  const max = Math.max(1, ...data.map((d) => Math.max(d.value || 0, d.plan || 0))), bw = (W - 8) / data.length
  return <svg ref={ref} data-fit viewBox={`0 0 ${W} ${height + 18}`} className="chart" role="img" aria-label={label}>
    {data.map((d, i) => { const h = ((d.value || 0) / max) * (height - 6), x = 4 + i * bw
      return <g key={d.date + i}><rect x={x + 1} y={height - h} width={Math.max(2, bw - 3)} height={Math.max(h, d.value ? 2 : 0)} rx="2" className={'bar-r ' + (i === data.length - 1 ? 'cur' : '')} />
        {d.plan != null && <line x1={x} x2={x + bw - 1} y1={height - (d.plan / max) * (height - 6)} y2={height - (d.plan / max) * (height - 6)} className="plan-l" />}
        {d.tick && <text x={x + bw / 2} y={height + 13} className="gt" textAnchor="middle">{d.tick}</text>}</g> })}
  </svg>
}
// ACWR zone bar 0–2.0 with a marker
export function ZoneBar({ value }) {
  const MAX = 2, pc = (v) => Math.min(100, (v / MAX) * 100), cuts = [0, 0.8, 1.3, 1.5, 2], marker = value == null ? null : pc(value)
  return <div className="zonebar" role="img" aria-label={value == null ? 'ACWR not available' : `ACWR ${value}`}>
    <div className="zones">{ACWR_ZONES.map((z, i) => <i key={z.id} className={'z-' + z.id} style={{ width: pc(cuts[i + 1]) - pc(cuts[i]) + '%' }} />)}</div>
    {marker != null && <b className="mk" style={{ left: marker + '%' }} />}
    <div className="zl"><span>0</span><span style={{ left: pc(0.8) + '%' }}>0,8</span><span style={{ left: pc(1.3) + '%' }}>1,3</span><span style={{ left: pc(1.5) + '%' }}>1,5</span></div>
  </div>
}
// Sleep stage split
export function StageBar({ deep, rem, light, awake }) {
  const parts = [['deep', 'Deep', deep], ['rem', 'REM', rem], ['light', 'Light', light], ['awake', 'Terjaga', awake]].filter((p) => p[2] != null)
  return <div><div className="stages" role="img" aria-label={parts.map((p) => `${p[1]} ${p[2]}%`).join(', ')}>{parts.map((p) => <i key={p[0]} className={'sg-' + p[0]} style={{ width: p[2] + '%' }} />)}</div>
    <div className="legend">{parts.map((p) => <span key={p[0]}><i className={'kdot sgd-' + p[0]} />{p[1]} {p[2]}%</span>)}</div></div>
}
// HRV: normal range with today's value and the baseline tick
export function RangeBar({ lo, hi, value, baseline }) {
  if (lo == null || hi == null) return null
  const a = Math.max(0, lo - (hi - lo) * 0.4), b = hi + (hi - lo) * 0.4, p = (v) => Math.min(100, Math.max(0, ((v - a) / (b - a)) * 100))
  return <div className="rangebar" role="img" aria-label={`HRV ${value} ms, normal range ${lo} to ${hi}`}><i className="rg" style={{ left: p(lo) + '%', width: p(hi) - p(lo) + '%' }} />{baseline != null && <u style={{ left: p(baseline) + '%' }} title={`baseline ${baseline}`} />}<b className="mk" style={{ left: p(value) + '%' }} /></div>
}
