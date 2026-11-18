// Spec visuals (docs/readiness-model.md). Inline SVG, design tokens only, every chart has a text equivalent via aria-label.
import { useState } from 'react'
import { REGIONS } from './lib/analysis.js'

const W = 340
const arc = (cx, cy, r, a0, a1) => { const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)], [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}` }
const TONE = { green: 'var(--green)', teal: 'var(--c-social)', yellow: 'var(--yellow)', red: 'var(--red)', purple: 'var(--c-tt)', none: 'var(--c-none)' }

// 0–100 radial gauge (Home hero / Readiness dial)
export function RadialGauge({ value, tone = 'none', label, size = 132, sub }) {
  const r = 52, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, v = value == null ? 0 : Math.max(0, Math.min(100, value))
  return <svg viewBox="0 0 132 132" width={size} height={size} role="img" aria-label={`${label}: ${value == null ? 'not available' : value} of 100`}>
    <path d={arc(66, 70, r, a0, a1)} className="g-track" />
    {value != null && <path d={arc(66, 70, r, a0, a0 + (a1 - a0) * (v / 100) + 0.0001)} style={{ stroke: TONE[tone] }} className="g-val" />}
    <text x="66" y="72" textAnchor="middle" className="g-num">{value ?? '—'}</text>
    <text x="66" y="92" textAnchor="middle" className="g-sub">{sub || '/ 100'}</text>
  </svg>
}
export function Ring({ value, max, label, size = 92 }) {
  const r = 36, f = max ? Math.min(1, value / max) : 0, C = 2 * Math.PI * r
  return <svg viewBox="0 0 92 92" width={size} height={size} role="img" aria-label={label}>
    <circle cx="46" cy="46" r={r} className="g-track" /><circle cx="46" cy="46" r={r} className="g-val ring" strokeDasharray={`${C * f} ${C}`} transform="rotate(-90 46 46)" />
    <text x="46" y="50" textAnchor="middle" className="g-num sm">{Math.round(f * 100)}%</text>
  </svg>
}
// 100 % stacked bar with an optional benchmark marker (70/30 intensity, sleep stages)
export function Stacked100({ parts, marker, label }) {
  return <div className="st100" role="img" aria-label={label}>
    <div className="bar3">{parts.filter((p) => p.v > 0).map((p) => <i key={p.k} style={{ width: p.v + '%', background: p.c }} />)}</div>
    {marker != null && <b className="mk" style={{ left: marker + '%' }} title={`patokan ${marker}%`} />}
    <div className="legend">{parts.map((p) => <span key={p.k}><i className="kdot" style={{ background: p.c }} />{p.k} {p.v}%</span>)}</div>
  </div>
}
// workout structure: block width = distance, height = intensity (1–4)
export function StepChart({ steps }) {
  const tot = steps.reduce((a, s) => a + s[1], 0) || 1, H = 56
  let x = 0
  return <svg viewBox={`0 0 ${W} ${H + 16}`} className="chart" role="img" aria-label={'Session structure: ' + steps.map((s) => `${s[0]} ${s[1].toFixed(1)} km`).join(', ')}>
    {steps.map((s, i) => { const w = (s[1] / tot) * W, h = (s[2] / 4) * H, el = <g key={i}><rect x={x + 0.5} y={H - h} width={Math.max(1, w - 1)} height={h} rx="2" className={'step i' + s[2]} />{w > 34 && <text x={x + w / 2} y={H + 12} className="gt" textAnchor="middle">{s[0].length > 10 ? s[0].slice(0, 9) + '…' : s[0]}</text>}</g>; x += w; return el })}
  </svg>
}
export function Sparkline({ data, w = 80, h = 22, label }) {
  const v = data.filter((d) => d != null); if (v.length < 2) return null
  const lo = Math.min(...v), hi = Math.max(...v), X = (i) => (i / (data.length - 1)) * (w - 4) + 2, Y = (d) => h - 2 - ((d - lo) / (hi - lo || 1)) * (h - 4)
  return <svg width={w} height={h} role="img" aria-label={label}><path d={data.map((d, i) => (d == null ? '' : `${i && data[i - 1] != null ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(d).toFixed(1)}`)).join(' ')} className="spk" /><circle cx={X(data.length - 1)} cy={Y(v.at(-1))} r="2.5" className="spk-d" /></svg>
}
// ACWR speedometer 0–2
export function Speedometer({ value }) {
  const MAX = 2, a = (v) => Math.PI + (Math.min(MAX, Math.max(0, v)) / MAX) * Math.PI, segs = [[0, 0.8, 'z-under'], [0.8, 1.3, 'z-sweet'], [1.3, 1.5, 'z-caution'], [1.5, 2, 'z-high']]
  const nv = value == null ? null : a(value)
  return <svg viewBox="0 0 200 118" className="speedo" role="img" aria-label={value == null ? 'ACWR not available' : `ACWR ${value}`}>
    {segs.map(([s, e, c]) => <path key={c} d={arc(100, 100, 80, a(s), a(e))} className={'seg ' + c} />)}
    {nv != null && <line x1="100" y1="100" x2={100 + 66 * Math.cos(nv)} y2={100 + 66 * Math.sin(nv)} className="needle" />}<circle cx="100" cy="100" r="6" className="hub" />
    {[0, 0.8, 1.3, 1.5, 2].map((t) => <text key={t} x={100 + 94 * Math.cos(a(t))} y={104 + 94 * Math.sin(a(t))} textAnchor="middle" className="gt">{String(t).replace('.', ',')}</text>)}
    <text x="100" y="86" textAnchor="middle" className="g-num sm">{value ?? '—'}</text>
  </svg>
}
// generic line chart with optional shaded band [lo, hi] and reference band (e.g. ACWR 0.8–1.3)
export function BandLine({ data, keys, band, refBand, height = 140, label, dots }) {
  if (data.length < 2) return <p className="muted">Not enough data.</p>
  const vals = data.flatMap((d) => [...keys.map((k) => d[k.key]), band ? d[band[0]] : null, band ? d[band[1]] : null, dots ? d[dots.key] : null]).concat(refBand || []).filter((v) => v != null)
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo || 1) * 0.1, L = 30, R = 6, T = 6, B = 18
  const X = (i) => L + (i / (data.length - 1)) * (W - L - R), Y = (v) => T + (1 - (v - lo + pad) / (hi - lo + 2 * pad)) * (height - T - B)
  const path = (k) => data.map((d, i) => (d[k] == null ? '' : `${i && data[i - 1][k] != null ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(d[k]).toFixed(1)}`)).join(' ')
  const bandPath = band ? (() => { const pts = data.map((d, i) => [i, d[band[0]], d[band[1]]]).filter((p) => p[1] != null && p[2] != null); if (pts.length < 2) return null; return 'M' + pts.map((p) => `${X(p[0])} ${Y(p[2])}`).join(' L') + ' L' + pts.reverse().map((p) => `${X(p[0])} ${Y(p[1])}`).join(' L') + ' Z' })() : null
  return <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img" aria-label={label}>
    {refBand && <rect x={L} width={W - L - R} y={Y(refBand[1])} height={Math.max(1, Y(refBand[0]) - Y(refBand[1]))} className="refband" />}
    {bandPath && <path d={bandPath} className="band" />}
    {[lo, hi].map((t, i) => <text key={i} x={L - 4} y={Y(t) + 4} className="gt" textAnchor="end">{Math.round(t * 10) / 10}</text>)}
    {[0, data.length - 1].map((i) => <text key={i} x={X(i)} y={height - 4} className="gt" textAnchor={i ? 'end' : 'start'}>{data[i].date.slice(5)}</text>)}
    {keys.map((k) => <path key={k.key} d={path(k.key)} className={'ln ' + (k.cls || '')} style={{ stroke: k.color }} />)}
    {dots && data.map((d, i) => d[dots.key] != null && <circle key={i} cx={X(i)} cy={Y(d[dots.key])} r="2.6" className={'dot ' + (dots.cls?.(d) || '')} />)}
  </svg>
}
// Performance-management chart: top pane CTL area + ATL line + daily load bars (+ dashed projection); bottom pane TSB with relative zones
export function PMCChart({ data, proj = [], label }) {
  const all = [...data, ...proj], H1 = 130, H2 = 70, L = 36, R = 6
  if (all.length < 2) return <p className="muted">Not enough load data.</p>
  const maxY = Math.max(...all.map((d) => Math.max(d.ctl || 0, d.atl || 0)), ...data.map((d) => d.load || 0)) * 1.08 || 1
  const X = (i) => L + (i / (all.length - 1)) * (W - L - R), Y = (v) => 6 + (1 - v / maxY) * (H1 - 12)
  const ctlArea = 'M' + data.map((d, i) => `${X(i)} ${Y(d.ctl)}`).join(' L') + ` L${X(data.length - 1)} ${Y(0)} L${X(0)} ${Y(0)} Z`
  const line = (arr, k, off = 0) => arr.map((d, i) => `${i ? 'L' : 'M'}${X(i + off).toFixed(1)} ${Y(d[k]).toFixed(1)}`).join(' ')
  const tp = all.map((d) => (d.ctl ? (d.tsb / d.ctl) * 100 : 0)), tmax = 50, Y2 = (v) => H1 + 14 + (1 - (Math.max(-tmax, Math.min(tmax, v)) + tmax) / (2 * tmax)) * (H2 - 8)
  const bw = (W - L - R) / all.length
  return <svg viewBox={`0 0 ${W} ${H1 + H2 + 24}`} className="chart" role="img" aria-label={label}>
    {data.map((d, i) => d.load > 0 && <rect key={i} x={X(i) - bw / 2} y={Y(d.load)} width={Math.max(1, bw - 1)} height={Y(0) - Y(d.load)} className="pmc-bar" />)}
    <path d={ctlArea} className="pmc-ctl" /><path d={line(data, 'atl')} className="ln pmc-atl" />
    {proj.length > 0 && <><path d={line([data.at(-1), ...proj], 'ctl', data.length - 1)} className="ln dash pmc-ctl-l" /><path d={line([data.at(-1), ...proj], 'atl', data.length - 1)} className="ln dash pmc-atl" /><line x1={X(data.length - 1)} x2={X(data.length - 1)} y1="4" y2={H1 + H2 + 10} className="today-l" /></>}
    <text x={L - 4} y={Y(maxY / 1.08) + 4} className="gt" textAnchor="end">{Math.round(maxY / 1.08)}</text>
    {[[25, 50, 'zb-trans'], [5, 25, 'zb-fresh'], [-10, 5, 'zb-grey'], [-30, -10, 'zb-prod'], [-50, -30, 'zb-over']].map(([a, b, c]) => <rect key={c} x={L} width={W - L - R} y={Y2(b)} height={Y2(a) - Y2(b)} className={c} />)}
    <path d={tp.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y2(v).toFixed(1)}`).join(' ')} className="ln pmc-tsb" />
    {[25, 0, -30].map((t) => <text key={t} x={L - 4} y={Y2(t) + 3} className="gt" textAnchor="end">{t > 0 ? '+' + t : t}%</text>)}
    {[0, data.length - 1].map((i) => <text key={i} x={X(i)} y={H1 + 10} className="gt" textAnchor={i ? 'end' : 'start'}>{all[i].date.slice(5)}</text>)}
  </svg>
}
export function Quadrant({ points }) {
  const S = 200, C = S / 2, sc = (v) => C + Math.max(-2.5, Math.min(2.5, v)) * (C / 2.6)
  return <svg viewBox={`0 0 ${S} ${S}`} className="quad" role="img" aria-label={'Autonomic quadrant, 7 days: ' + points.map((p) => `${p.date.slice(5)} HRV z ${p.y}, RHR z ${p.x}`).join('; ')}>
    <rect x="0" y="0" width={C} height={C} className="q-tl" /><rect x={C} y="0" width={C} height={C} className="q-tr" /><rect x="0" y={C} width={C} height={C} className="q-bl" /><rect x={C} y={C} width={C} height={C} className="q-br" />
    <text x="6" y="14" className="gt">Ready</text><text x={S - 6} y="14" className="gt" textAnchor="end">Adapting</text><text x="6" y={S - 6} className="gt">Chronic fatigue?</text><text x={S - 6} y={S - 6} className="gt" textAnchor="end">Stress/illness</text>
    <text x={C} y={S - 4} className="gt" textAnchor="middle">RHR ↑</text><text x="4" y={C - 4} className="gt">HRV ↑</text>
    {points.map((p, i) => <circle key={p.date} cx={sc(p.x)} cy={S - sc(p.y)} r={i === points.length - 1 ? 6 : 3.5} className={i === points.length - 1 ? 'qd last' : 'qd'} style={{ opacity: 0.35 + (i / Math.max(1, points.length - 1)) * 0.65 }} />)}
  </svg>
}
// sleep debt waterfall: daily surplus/deficit bars + cumulative line
export function Waterfall({ series, label }) {
  const H = 120, vals = series.flatMap((s) => [s.delta || 0, s.cum || 0]), lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), Y = (v) => 6 + (1 - (v - lo) / (hi - lo || 1)) * (H - 22), bw = (W - 30) / series.length
  return <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={label}>
    <line x1="26" x2={W} y1={Y(0)} y2={Y(0)} className="gl" />
    {series.map((s, i) => s.delta != null && <rect key={s.date} x={28 + i * bw} y={Math.min(Y(0), Y(s.delta))} width={bw - 3} height={Math.abs(Y(s.delta) - Y(0)) || 1} className={s.delta >= 0 ? 'wf-plus' : 'wf-minus'} />)}
    <path d={series.map((s, i) => `${i ? 'L' : 'M'}${(28 + i * bw + bw / 2).toFixed(1)} ${Y(s.cum).toFixed(1)}`).join(' ')} className="ln wf-cum" />
    <text x="24" y={Y(0) + 4} className="gt" textAnchor="end">0</text><text x="24" y={Y(lo) + 4} className="gt" textAnchor="end">{Math.round(lo / 60)}j</text>
    {[0, series.length - 1].map((i) => <text key={i} x={28 + i * bw + bw / 2} y={H - 3} className="gt" textAnchor="middle">{series[i].date.slice(5)}</text>)}
  </svg>
}
// lower-body map: schematic front/back figure; regions coloured by load 0–3; tap to override
const SHAPES = { // front: quads, shins; back: hams, glutes, calves, achilles, back
  quads: [[52, 100, 16, 46], [86, 100, 16, 46]], shins: [[54, 170, 12, 44], [88, 170, 12, 44]],
  back: [[192, 58, 40, 26]], glutes: [[186, 86, 24, 24], [212, 86, 24, 24]], hams: [[190, 114, 16, 42], [216, 114, 16, 42]], calves: [[190, 164, 15, 34], [217, 164, 15, 34]], achilles: [[194, 200, 8, 18], [221, 200, 8, 18]],
}
export function BodyMap({ load, overrides = {}, onTap }) {
  const lv = (k) => overrides[k] ?? load[k] ?? 0, cls = (v) => (v >= 2 ? 'bm-hi' : v >= 1 ? 'bm-mid' : v > 0.3 ? 'bm-lo' : 'bm-0')
  return <div className="bodymap"><svg viewBox="0 0 280 230" role="img" aria-label={'Muscle load: ' + REGIONS.map(([k, n]) => `${n} ${lv(k).toFixed(1)}`).join(', ')}>
    <text x="70" y="14" textAnchor="middle" className="gt">Depan</text><text x="212" y="14" textAnchor="middle" className="gt">Belakang</text>
    <ellipse cx="70" cy="40" rx="14" ry="16" className="bm-body" /><rect x="48" y="58" width="44" height="40" rx="8" className="bm-body" /><ellipse cx="212" cy="40" rx="14" ry="16" className="bm-body" />
    {Object.entries(SHAPES).map(([k, rs]) => rs.map((r, i) => <rect key={k + i} x={r[0]} y={r[1]} width={r[2]} height={r[3]} rx="6" className={'bm ' + cls(lv(k)) + (overrides[k] != null ? ' ov' : '')} onClick={() => onTap?.(k)} />))}
  </svg>
  <div className="bm-list">{REGIONS.map(([k, n]) => <button key={k} className={'bm-row ' + cls(lv(k))} onClick={() => onTap?.(k)} aria-label={`${n}: ${lv(k).toFixed(1)} of 3${overrides[k] != null ? ' (set manually)' : ''}. Tap to change.`}><i />{n}<b>{lv(k).toFixed(1)}{overrides[k] != null ? '*' : ''}</b></button>)}</div></div>
}
// multi-track lap telemetry with a shared x axis and tap/drag crosshair
export function MultiTrack({ laps, tracks }) {
  const [sel, setSel] = useState(laps.length - 1), n = laps.length, L = 6, R = 6, X = (i) => L + ((i + 0.5) / n) * (W - L - R), TH = 44
  const pick = (e) => { const r = e.currentTarget.getBoundingClientRect(); setSel(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)))) }
  return <div className="mtrack"><svg viewBox={`0 0 ${W} ${tracks.length * (TH + 14)}`} className="chart" role="img" aria-label={`Per-lap telemetry, ${n} laps`} onPointerDown={pick} onPointerMove={(e) => e.buttons && pick(e)}>
    {tracks.map((t, ti) => { const v = laps.map((l) => l[t.key]).filter((x) => x != null); if (v.length < 2) return null; const lo = Math.min(...v), hi = Math.max(...v), y0 = ti * (TH + 14) + 12, Y = (x) => y0 + (t.invert ? (x - lo) / (hi - lo || 1) : 1 - (x - lo) / (hi - lo || 1)) * (TH - 4) + 2
      return <g key={t.key}><text x="2" y={y0 - 2} className="gt">{t.label}</text><path d={laps.map((l, i) => (l[t.key] == null ? '' : `${i && laps[i - 1][t.key] != null ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(l[t.key]).toFixed(1)}`)).join(' ')} className="ln" style={{ stroke: t.color }} />
        {laps[sel]?.[t.key] != null && <circle cx={X(sel)} cy={Y(laps[sel][t.key])} r="3.5" style={{ fill: t.color }} />}</g> })}
    <line x1={X(sel)} x2={X(sel)} y1="0" y2={tracks.length * (TH + 14)} className="cross" />
  </svg>
  <p className="cross-v" aria-live="polite">Lap {laps[sel]?.idx}: {tracks.map((t) => laps[sel]?.[t.key] != null ? `${t.label} ${t.fmt ? t.fmt(laps[sel][t.key]) : laps[sel][t.key]}` : null).filter(Boolean).join(' · ')}</p></div>
}
export function Donut({ parts, label }) {
  const tot = parts.reduce((a, p) => a + p.v, 0); let a = -Math.PI / 2
  return <div className="donut"><svg viewBox="0 0 100 100" width="96" height="96" role="img" aria-label={label}>{tot ? parts.map((p, i) => { const s = a, e = a + (p.v / tot) * Math.PI * 2 - 0.0001; a = e; return <path key={i} d={arc(50, 50, 38, s, e)} className="donut-seg" style={{ stroke: p.c }} /> }) : <circle cx="50" cy="50" r="38" className="g-track" />}</svg>
    <div className="legend col">{parts.map((p) => <span key={p.k}><i className="kdot" style={{ background: p.c }} />{p.k} · {Math.round(p.v)} km</span>)}</div></div>
}
// year phase Gantt with a today marker
export function Gantt({ segs, todayFrac, label }) {
  return <div className="gantt" role="img" aria-label={label}>{segs.map((s, i) => <i key={i} className={'gs ph-' + s.cls} style={{ width: s.frac * 100 + '%' }} title={s.label}>{s.frac > 0.1 ? s.label : ''}</i>)}{todayFrac != null && <b className="gtoday" style={{ left: todayFrac * 100 + '%' }} />}</div>
}
// weekly combo: planned km (outline) vs actual km (fill) + load line; diamonds for CP / race weeks
export function Combo({ weeks, label }) {
  const H = 150, maxKm = Math.max(1, ...weeks.map((w) => Math.max(w.plan || 0, w.actual || 0))), maxL = Math.max(1, ...weeks.map((w) => w.load || 0, ...weeks.map((w) => w.ctl || 0))), bw = (W - 10) / weeks.length, Yk = (v) => H - 14 - (v / maxKm) * (H - 30), Yl = (v) => H - 14 - (v / maxL) * (H - 30)
  return <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={label}>
    {weeks.map((w, i) => { const x = 5 + i * bw; return <g key={w.id}><rect x={x + 0.5} y={Yk(w.plan || 0)} width={Math.max(1, bw - 1)} height={H - 14 - Yk(w.plan || 0)} className="cb-plan" />{w.actual > 0 && <rect x={x + 0.5} y={Yk(w.actual)} width={Math.max(1, bw - 1)} height={H - 14 - Yk(w.actual)} className="cb-act" />}
      {w.mark && <path d={`M${x + bw / 2} 4 l4 4 l-4 4 l-4 -4 Z`} className={'cb-mk ' + w.mark} />}{w.current && <line x1={x + bw / 2} x2={x + bw / 2} y1="0" y2={H - 14} className="today-l" />}</g> })}
    <path d={weeks.map((w, i) => (w.load == null ? '' : `${i && weeks[i - 1].load != null ? 'L' : 'M'}${(5 + i * bw + bw / 2).toFixed(1)} ${Yl(w.load).toFixed(1)}`)).join(' ')} className="ln cb-load" />
    <path d={weeks.map((w, i) => (w.ctl == null ? '' : `${i && weeks[i - 1].ctl != null ? 'L' : 'M'}${(5 + i * bw + bw / 2).toFixed(1)} ${Yl(w.ctl * 7).toFixed(1)}`)).join(' ')} className="ln dash cb-ctl" />
    {[0, Math.floor(weeks.length / 2), weeks.length - 1].map((i) => <text key={i} x={5 + i * bw + bw / 2} y={H - 2} className="gt" textAnchor="middle">{weeks[i].id}</text>)}
  </svg>
}
export function Bullet({ value, bands, unit = '', label }) { // horizontal bullet / thermometer
  const lo = bands[0].from, hi = bands.at(-1).to, p = (v) => ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100
  return <div className="bullet" role="img" aria-label={label}><div className="bl">{bands.map((b) => <i key={b.from} className={b.cls} style={{ left: p(b.from) + '%', width: p(b.to) - p(b.from) + '%' }} />)}</div>{value != null && <b className="mk" style={{ left: p(value) + '%' }} />}
    <div className="zl">{bands.slice(1).map((b) => <span key={b.from} style={{ left: p(b.from) + '%' }}>{b.from}{unit}</span>)}</div></div>
}
export function GroupedBars({ groups, series, label, fmt }) {
  const H = 130, max = Math.max(...groups.flatMap((g) => series.map((s) => g[s.key] || 0))) || 1, gw = (W - 10) / groups.length, bw = (gw - 8) / series.length
  return <svg viewBox={`0 0 ${W} ${H + 30}`} className="chart" role="img" aria-label={label}>{groups.map((g, gi) => <g key={g.label}>{series.map((s, si) => g[s.key] != null && <g key={s.key}><rect x={5 + gi * gw + 4 + si * bw} y={H - (g[s.key] / max) * (H - 18)} width={bw - 2} height={(g[s.key] / max) * (H - 18)} rx="2" style={{ fill: s.color }} /><text x={5 + gi * gw + 4 + si * bw + bw / 2 - 1} y={H - (g[s.key] / max) * (H - 18) - 3} className="gt tiny" textAnchor="middle">{fmt ? fmt(g[s.key], g.label) : g[s.key]}</text></g>)}<text x={5 + gi * gw + gw / 2} y={H + 14} className="gt" textAnchor="middle">{g.label}</text></g>)}</svg>
}
export const TwinBars = ({ a, b }) => <div className="twin">{[a, b].map((x) => <div key={x.label}><span>{x.label}</span><div className="tb"><i style={{ width: (x.v ?? 0) + '%' }} className={x.v == null ? '' : x.v >= 70 ? 'ok' : x.v >= 45 ? 'mid' : 'low'} /></div><b>{x.v == null ? '—' : x.v + '%'}</b></div>)}</div>
