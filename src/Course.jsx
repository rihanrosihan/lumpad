import { useMemo, useRef, useState } from 'react'
import { ROUTES } from './CourseMap.jsx'
import { splits, clock, runWalk, hms, mss, parseHMS, compass, segmentAt, FM } from './lib/courseplan.js'
import { RACES, RACE_BY_DATE } from './lib/season.js'
import { Card, Chip, Evidence, Screen } from './ui.jsx'

const W = 300, H = 400, PAD = 14
const STRAT = [['even', 'Even pace'], ['negative', 'Negative split'], ['runwalk', 'Run–walk']]

// Interactive map: drag to pan, wheel / buttons to zoom, km markers every km when zoomed in
function RouteMap({ R, km, setKm }) {
  const proj = useMemo(() => { const [la0, lo0, la1, lo1] = R.bbox, k = Math.cos(((la0 + la1) / 2) * Math.PI / 180), w = (lo1 - lo0) * k, h = la1 - la0, s = Math.min((W - 2 * PAD) / w, (H - 2 * PAD) / h), ox = (W - w * s) / 2, oy = (H - h * s) / 2; return ([la, lo]) => [ox + (lo - lo0) * k * s, oy + (la1 - la) * s] }, [R])
  const path = useMemo(() => R.line.map((p, i) => { const [x, y] = proj(p); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}` }).join(''), [R, proj])
  const [v, setV] = useState({ x: 0, y: 0, w: W, h: H }), drag = useRef(null), ref = useRef(null)
  const z = W / v.w
  const clamp = (n) => ({ ...n, x: Math.max(-W * 0.2, Math.min(W * 1.2 - n.w, n.x)), y: Math.max(-H * 0.2, Math.min(H * 1.2 - n.h, n.y)) })
  const zoom = (f, cx = v.x + v.w / 2, cy = v.y + v.h / 2) => setV((o) => { const w = Math.max(W / 12, Math.min(W, o.w / f)), h = w * (H / W); return clamp({ x: cx - ((cx - o.x) / o.w) * w, y: cy - ((cy - o.y) / o.h) * h, w, h }) })
  const toSvg = (e) => { const r = ref.current.getBoundingClientRect(); return [v.x + ((e.clientX - r.left) / r.width) * v.w, v.y + ((e.clientY - r.top) / r.height) * v.h] }
  const pos = useMemo(() => { const l = R.line; let i = l.findIndex((p) => p[2] >= km); if (i < 1) i = i === 0 ? 1 : l.length - 1; const a = l[i - 1], b = l[i], f = (km - a[2]) / Math.max(1e-9, b[2] - a[2]); return proj([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])]) }, [R, proj, km])
  const marks = R.marks.filter((m) => (z >= 2.2 ? true : m.km % 5 === 0)), labelEvery = z >= 3.5 ? 1 : z >= 2.2 ? 2 : 5
  const [sx, sy] = proj(R.start), [fx, fy] = proj(R.finish), r0 = 1 / Math.sqrt(z)
  return <div className="rmap">
    <svg ref={ref} viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`} role="img" aria-label="Interactive course map. Drag to move, use the buttons to zoom." style={{ touchAction: 'none' }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, v } }}
      onPointerMove={(e) => { const d = drag.current; if (!d) return; const r = ref.current.getBoundingClientRect(); setV(clamp({ ...d.v, x: d.v.x - ((e.clientX - d.x) / r.width) * d.v.w, y: d.v.y - ((e.clientY - d.y) / r.height) * d.v.h })) }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
      onWheel={(e) => { const [cx, cy] = toSvg(e); zoom(e.deltaY < 0 ? 1.25 : 0.8, cx, cy) }}>
      <path d={path} className="cm-line" style={{ strokeWidth: 3 * r0 }} />
      {R.turns.map((t) => { const [x, y] = proj(t.ll); return <circle key={t.km} cx={x} cy={y} r={4 * r0} className="cm-turn"><title>{`${t.name} · km ${t.km}`}</title></circle> })}
      {marks.map((m) => { const [x, y] = proj(m.ll); return <g key={m.km} onClick={() => setKm(m.km)} style={{ cursor: 'pointer' }}><circle cx={x} cy={y} r={8 * r0} className="cm-k" />{m.km % labelEvery === 0 && <text x={x} y={y + 3 * r0} textAnchor="middle" className="cm-kt" style={{ fontSize: 8 * r0 }}>{m.km}</text>}</g> })}
      <circle cx={sx} cy={sy} r={6 * r0} className="cm-start" /><rect x={fx - 5 * r0} y={fy - 5 * r0} width={10 * r0} height={10 * r0} className="cm-fin" />
      <circle cx={pos[0]} cy={pos[1]} r={6 * r0} className="cm-pos" style={{ strokeWidth: 3 * r0 }} />
    </svg>
    <div className="rzoom"><button onClick={() => zoom(1.6)} aria-label="Zoom in">+</button><button onClick={() => zoom(1 / 1.6)} aria-label="Zoom out">−</button><button onClick={() => setV({ x: 0, y: 0, w: W, h: H })} aria-label="Reset view">⟲</button></div>
  </div>
}

export default function Course({ go }) {
  const R = ROUTES.jakim, race = RACES.find((r) => r.route === 'jakim'), goalSec = 4 * 3600 + 59 * 60
  const [km, setKm] = useState(0), [strategy, setStrategy] = useState('even'), [target, setTarget] = useState(hms(goalSec)), [runMin, setRunMin] = useState(4), [walkMin, setWalkMin] = useState(1), [all, setAll] = useState(false)
  const total = parseHMS(target), ok = total != null && total >= 2 * 3600 && total <= 9 * 3600
  const plan = useMemo(() => { if (!ok) return null; const sp = splits(total, strategy === 'negative' ? 'negative' : 'even'), cl = clock(sp); return { sp, cl, rw: strategy === 'runwalk' ? runWalk(total / FM, runMin, walkMin) : null } }, [ok, total, strategy, runMin, walkMin])
  const seg = segmentAt(R.segments, km)
  const clockAt = plan ? (() => { const i = Math.floor(km); const base = i ? plan.cl[i - 1] : 0, part = (km - i) * (plan.sp[i] || 0) / (i < 42 ? 1 : (FM - 42)); return base + part })() : null
  const csv = () => { const lines = ['km,split_s_per_km,clock,segment', ...plan.sp.map((s, i) => `${i < 42 ? i + 1 : 42.195},${Math.round(i < 42 ? s : s / (FM - 42))},${hms(plan.cl[i])},"${segmentAt(R.segments, i + 0.5).what}"`)]; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = `jakim-splits-${target.replace(/:/g, '')}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000) }
  const rows = plan ? plan.sp.map((s, i) => ({ k: i < 42 ? i + 1 : 42.195, split: i < 42 ? s : s / (FM - 42), clock: plan.cl[i], seg: segmentAt(R.segments, i < 42 ? i + 0.5 : 42.1), dir: compass(R.kmHeadings[i] ?? 0) })) : []
  const shown = all ? rows : rows.filter((r) => r.k % 5 === 0 || r.k === 42.195 || Math.abs(r.k - 21) < 0.5)
  return <Screen title="Jakim course" sub={`${R.name} · ${race ? RACE_BY_DATE[race.date].cls + '-race · target ' + (race.target || '—') : ''}`}>
    <div className="wmeta wk4"><div><small>Distance</small><b>{FM}</b><em>km</em></div><div><small>Turnarounds</small><b>{R.turns.length}</b><em>U-turns</em></div><div><small>Corners</small><b>{R.corners.length}</b><em>≥ 55°</em></div><div><small>Elevation</small><b>flat</b><em>no data in GPX</em></div></div>
    <Card title="Map">
      <RouteMap R={R} km={km} setKm={setKm} />
      <label className="fld"><span>Distance: <b>km {km.toFixed(1)}</b>{plan ? <> · clock <b>{hms(clockAt)}</b></> : null}</span><input type="range" min="0" max={FM} step="0.1" value={km} onChange={(e) => setKm(+e.target.value)} aria-label="Move along the course" /></label>
      <p><b>{seg.what}</b> · heading {compass(R.kmHeadings[Math.min(42, Math.floor(km))] ?? 0)}</p>
      <p className="muted">Drag to move, + / − to zoom, tap a km marker to jump to it. Yellow dots = U-turns.</p>
    </Card>
    <Card title="Pacing plan" right={<Chip>{ok ? hms(total) : 'enter h:mm:ss'}</Chip>}>
      <div className="seg3 wrap" role="group" aria-label="Strategy">{STRAT.map(([k, l]) => <button key={k} className={strategy === k ? 'on' : ''} aria-pressed={strategy === k} onClick={() => setStrategy(k)}>{l}</button>)}</div>
      <div className="form two"><label className="fld"><span>Finish time (h:mm:ss)</span><input inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} aria-invalid={!ok} /></label>
        {strategy === 'runwalk' && <div className="form two"><label className="fld"><span>Run (min)</span><input inputMode="numeric" type="number" min="1" max="30" value={runMin} onChange={(e) => setRunMin(Math.max(1, +e.target.value || 1))} /></label><label className="fld"><span>Walk (min)</span><input inputMode="numeric" type="number" min="1" max="10" value={walkMin} onChange={(e) => setWalkMin(Math.max(1, +e.target.value || 1))} /></label></div>}</div>
      {!ok && <p className="err" role="alert">Enter a finish time between 2:00:00 and 9:00:00.</p>}
      {plan && <p><b>{mss(total / FM)}/km</b> average{strategy === 'negative' ? <> · first half {mss(plan.sp[0])}, second half {mss(plan.sp[41])}/km</> : null}{plan.rw ? <> · run <b>{mss(plan.rw.runPace)}/km</b> for {runMin}′, walk {walkMin}′ at {mss(plan.rw.walkPace)}/km ({plan.rw.cycleKm.toFixed(2)} km per cycle)</> : null}{strategy === 'runwalk' && !plan.rw ? <span className="err"> That walk is too long for this goal.</span> : null}</p>}
      {plan && <><div className="scroll" tabIndex={0} role="region" aria-label="Kilometre splits"><table className="zm"><thead><tr><th>km</th><th>Split</th><th>Clock</th><th>Where</th></tr></thead><tbody>
        {shown.map((r) => <tr key={r.k}><td><b>{r.k === 42.195 ? '42.2' : r.k}</b></td><td>{mss(r.split)}</td><td>{hms(r.clock)}</td><td>{r.seg.what.split(',')[0]} <small className="muted">{r.dir}</small></td></tr>)}</tbody></table></div>
        <button className="btn sm" onClick={() => setAll(!all)}>{all ? 'Show every 5 km' : 'Show every km'}</button> <button className="btn sm" onClick={csv}>Download splits (.csv)</button></>}
      <Evidence>Splits add up exactly to the finish time on the certified 42.195 km. Negative split = first half 1.5% slower than average. Run–walk walks at {mss(630)}/km. Heat, aid stations and crowding are not modelled.</Evidence>
    </Card>
    <Card title="Turn by turn" right={<Chip>{R.corners.length} corners</Chip>}>
      <ol className="cm-segs">{R.corners.map((c, i) => <li key={i}><button onClick={() => setKm(Math.max(0, c.km))}><b>km {c.km.toFixed(1)}</b><span>{c.deg >= 140 ? 'U-turn' : c.deg >= 100 ? 'Sharp' : 'Turn'} {c.dir === 'L' ? 'left' : 'right'} · {c.deg}°{R.turns.find((t) => Math.abs(t.km - c.km) < 0.6 && c.deg >= 140) ? ` · ${R.turns.find((t) => Math.abs(t.km - c.km) < 0.6).name}` : ''}</span></button></li>)}</ol>
      <Evidence>Corners are computed from the official GPX geometry (heading change over 120 m), so left/right and angle are reliable; street names are only given where the official map shows them.</Evidence>
    </Card>
    <Card title="Course files">
      <a className="btn sm full" href={R.gpx} download>Download the official GPX</a>
      <p className="muted">{R.source} Track as drawn: {R.trackKm} km, scaled to 42.195 km. The file has no elevation, so there is no elevation profile; Jakarta is flat.</p>
      <button className="btn sm full" onClick={() => go('race')}>Back to Races</button>
    </Card>
  </Screen>
}
